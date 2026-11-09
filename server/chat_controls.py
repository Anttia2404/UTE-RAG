"""Process-safe answer cache and database-backed daily LLM quotas."""

import hashlib
import json
import os
import re
import threading
import time
import unicodedata
from collections import OrderedDict, defaultdict, deque
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import update

try:
    from .database import UsageCounter
except ImportError:
    from database import UsageCounter

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
_CACHE_TTL = max(30, int(os.getenv("ANSWER_CACHE_TTL_SECONDS", "600")))
_cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_cache_lock = threading.Lock()
_rate_lock = threading.Lock()
_recent_requests: dict[str, deque[float]] = defaultdict(deque)


def _fold(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text.casefold())
    plain = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"\W+", " ", plain, flags=re.UNICODE).strip()


def make_cache_key(question: str, history: list[dict], chunks: list[dict]) -> str:
    evidence = [
        (item.get("sourceId"), item.get("documentId"), item.get("section"), item.get("text", ""))
        for item in chunks
    ]
    stable_history = [(item.get("role"), _fold(item.get("content", ""))) for item in history[-6:]]
    payload = json.dumps({"q": _fold(question), "history": stable_history, "evidence": evidence}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def get_cached_answer(key: str) -> dict | None:
    now = time.monotonic()
    with _cache_lock:
        item = _cache.get(key)
        if item is None:
            return None
        expires_at, answer = item
        if expires_at <= now:
            _cache.pop(key, None)
            return None
        _cache.move_to_end(key)
        return dict(answer)


def cache_answer(key: str, answer: dict, question: str) -> None:
    ttl = _CACHE_TTL
    if any(word in _fold(question) for word in ("han nop", "thoi han", "ngay dong", "den ngay")):
        now = datetime.now(VN_TZ)
        seconds_to_midnight = ((now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0) - now).total_seconds()
        ttl = max(1, min(ttl, int(seconds_to_midnight) - 60))
    with _cache_lock:
        _cache[key] = (time.monotonic() + ttl, dict(answer))
        _cache.move_to_end(key)
        while len(_cache) > 1500:
            _cache.popitem(last=False)


def _day_key() -> date:
    return datetime.now(VN_TZ).date()


def _counter_incr(db, subject: str, day, amount: int = 1) -> int:
    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    elif dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        raise RuntimeError(f"Daily quotas are not supported for database dialect {dialect}.")

    statement = insert(UsageCounter).values(subject=subject, day=day, count=amount)
    statement = statement.on_conflict_do_update(
        index_elements=[UsageCounter.subject, UsageCounter.day],
        set_={"count": UsageCounter.count + amount},
    ).returning(UsageCounter.count)
    count = int(db.execute(statement).scalar_one())
    db.commit()
    return count


def _counter_decr(db, subject: str, day) -> None:
    db.execute(
        update(UsageCounter)
        .where(UsageCounter.subject == subject, UsageCounter.day == day)
        .values(count=UsageCounter.count - 1)
    )
    db.commit()


class ChatLimitError(Exception):
    def __init__(self, status_code: int, code: str, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.retry_after = retry_after


def reserve_llm_call(db, user) -> bool:
    """Reserve a model call; return whether a student quota should be refunded on provider failure."""
    if user.role in {"staff", "admin"}:
        _counter_incr(db, "global:staff", _day_key())
        return False

    per_minute = max(1, int(os.getenv("STUDENT_LLM_PER_MINUTE_LIMIT", "5")))
    now_mono = time.monotonic()
    with _rate_lock:
        requests = _recent_requests[user.id]
        while requests and now_mono - requests[0] >= 60:
            requests.popleft()
        if len(requests) >= per_minute:
            retry_after = max(1, int(60 - (now_mono - requests[0])))
            raise ChatLimitError(429, "RATE_LIMITED", "Bạn đã gửi nhiều câu hỏi trong thời gian ngắn. Vui lòng thử lại sau.", retry_after)
        requests.append(now_mono)

    day = _day_key()
    student_limit = max(1, int(os.getenv("STUDENT_LLM_DAILY_LIMIT", "30")))
    subject = f"student:{user.id}"
    used = _counter_incr(db, subject, day)
    if used > student_limit:
        _counter_decr(db, subject, day)
        raise ChatLimitError(429, "DAILY_QUOTA_EXCEEDED", "Bạn đã dùng hết lượt hỏi hôm nay. Hạn mức sẽ được đặt lại vào 0 giờ.")

    system_cap = max(1, int(os.getenv("LLM_DAILY_CAP", "800")))
    total = _counter_incr(db, "global:llm", day)
    if total > system_cap:
        _counter_decr(db, subject, day)
        _counter_decr(db, "global:llm", day)
        raise ChatLimitError(503, "DAILY_CAP_REACHED", "Hệ thống đã tạm hết lượt trả lời AI hôm nay. Các câu hỏi sẽ dùng lại được vào ngày mai.")
    return True


def refund_student_call(db, user, counted: bool) -> None:
    if counted:
        _counter_decr(db, f"student:{user.id}", _day_key())
