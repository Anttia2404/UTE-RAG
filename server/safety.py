"""Small deterministic guards for tuition answers and student identifiers."""

import re


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?<![\d.])(?:\+?84|0)(?:[\s.-]?\d){9}(?!\d|[.,]\d)")
STUDENT_CODE_RE = re.compile(r"(?<![\d.,])\d{8}(?!\d|[.,]\d)")
DATE_FULL_RE = re.compile(r"(?<![\d/])(\d{1,2})/(\d{1,2})/(\d{4})(?![\d/])")
DATE_ISO_RE = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")
DATE_DAY_MONTH_RE = re.compile(r"(?<![\d/])(\d{1,2})/(\d{1,2})(?![\d/])")
DATE_WORD_RE = re.compile(r"ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{4}))?", re.I)
PERCENT_RE = re.compile(r"(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(?:%|phần trăm)", re.I)
MONEY_WORD_RE = re.compile(r"(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(triệu|tr|nghìn|ngàn|ngan|nghin)(?![\wÀ-ỹ])", re.I)
MONEY_GROUPED_RE = re.compile(r"(?<![\d.,])\d{1,3}(?:[.]\d{3})+(?!\d)|(?<![\d.,])\d{1,3}(?:,\d{3}){2,}(?!\d)")
MONEY_SUFFIX_RE = re.compile(r"(?<![\d.,])(\d{5,})\s*(?:đ|đồng|vnd|vnđ)", re.I)


def redact_text(text: str) -> str:
    """Mask email, Vietnamese phone numbers and 8 digit student codes."""
    text = EMAIL_RE.sub("[EMAIL]", text)
    text = PHONE_RE.sub("[SĐT]", text)
    return STUDENT_CODE_RE.sub("[MSSV]", text)


def _facts(text: str) -> dict[str, set]:
    facts = {"money": set(), "percent": set(), "date_full": set(), "date_md": set()}
    occupied: list[tuple[int, int]] = []

    def available(match: re.Match) -> bool:
        start, end = match.span()
        return all(end <= left or start >= right for left, right in occupied)

    def mark(match: re.Match) -> None:
        occupied.append(match.span())

    for pattern in (DATE_FULL_RE, DATE_ISO_RE, DATE_WORD_RE):
        for match in pattern.finditer(text):
            if pattern is DATE_ISO_RE:
                year, month, day = map(int, match.groups())
            elif pattern is DATE_WORD_RE:
                day, month = map(int, match.groups()[:2])
                year = int(match.group(3)) if match.group(3) else None
            else:
                day, month, year = map(int, match.groups())
            if 1 <= day <= 31 and 1 <= month <= 12:
                facts["date_full" if year else "date_md"].add((year, month, day) if year else (month, day))
                mark(match)
    for match in DATE_DAY_MONTH_RE.finditer(text):
        if available(match):
            day, month = map(int, match.groups())
            if 1 <= day <= 31 and 1 <= month <= 12:
                facts["date_md"].add((month, day))
                mark(match)
    for match in PERCENT_RE.finditer(text):
        if available(match):
            facts["percent"].add(round(float(match.group(1).replace(",", ".")), 4))
            mark(match)
    for match in MONEY_WORD_RE.finditer(text):
        if available(match):
            number = float(match.group(1).replace(",", "."))
            multiplier = 1_000_000 if match.group(2).lower() in {"triệu", "tr"} else 1_000
            facts["money"].add(round(number * multiplier))
            mark(match)
    for pattern in (MONEY_GROUPED_RE, MONEY_SUFFIX_RE):
        for match in pattern.finditer(text):
            if available(match):
                raw = match.group(0) if pattern is MONEY_GROUPED_RE else match.group(1)
                facts["money"].add(int(re.sub(r"[.,]", "", raw)))
                mark(match)
    return facts


def ungrounded_facts(answer: str, context: str) -> list[str]:
    """Return money, percentages and dates in the answer that are absent from evidence."""
    evidence, claim = _facts(context), _facts(answer)
    full_dates_as_month_day = {(month, day) for _year, month, day in evidence["date_full"]}
    unsupported: list[str] = []
    for amount in sorted(claim["money"] - evidence["money"]):
        unsupported.append(f"{amount:,}".replace(",", ".") + " đ")
    unsupported.extend(f"{value:g}%" for value in sorted(claim["percent"] - evidence["percent"]))
    for year, month, day in sorted(claim["date_full"]):
        if (year, month, day) not in evidence["date_full"] and (month, day) not in evidence["date_md"]:
            unsupported.append(f"{day:02d}/{month:02d}/{year}")
    for month, day in sorted(claim["date_md"]):
        if (month, day) not in evidence["date_md"] and (month, day) not in full_dates_as_month_day:
            unsupported.append(f"{day:02d}/{month:02d}")
    return unsupported
