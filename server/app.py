import os
import re
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal

import jwt
import google.generativeai as genai
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from dotenv import load_dotenv
from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

try:
    from .database import Announcement, ChatMessage, ChatSession, Document, Feedback, KnowledgeNode, SessionLocal, User, initialize_database, utcnow
    from .google_api import api_key, build_prompt, model_name, parse_model_response
    from .search import ensure_index, index_knowledge_nodes, is_available, search_for_chat, search_for_student
except ImportError:
    from database import Announcement, ChatMessage, ChatSession, Document, Feedback, KnowledgeNode, SessionLocal, User, initialize_database, utcnow
    from google_api import api_key, build_prompt, model_name, parse_model_response
    from search import ensure_index, index_knowledge_nodes, is_available, search_for_chat, search_for_student


ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local", override=False)
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
JWT_SECRET = os.getenv("APP_SECRET_KEY", "").strip()
if not JWT_SECRET:
    secret_file = DATA_DIR / ".app-secret"
    if secret_file.exists():
        JWT_SECRET = secret_file.read_text(encoding="utf-8").strip()
    else:
        JWT_SECRET = secrets.token_urlsafe(48)
        secret_file.write_text(JWT_SECRET, encoding="utf-8")
PASSWORD_HASHER = PasswordHasher()
COOKIE_NAME = "tuition_session"
COOKIE_SECURE = os.getenv("APP_ENV", "development") == "production"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
ALLOWED_EXTENSIONS = {".docx", ".pdf", ".md", ".txt"}

@asynccontextmanager
async def lifespan(_app):
    initialize_database()
    index_static_chunks()
    yield


app = FastAPI(title="Trợ lý học phí API", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def new_id():
    return str(uuid.uuid4())


def make_token(user: User):
    return jwt.encode(
        {"sub": user.id, "role": user.role, "exp": datetime.now(timezone.utc) + timedelta(hours=12)},
        JWT_SECRET,
        algorithm="HS256",
    )


def get_current_user(
    token: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
    db: Session = Depends(get_db),
):
    if not token:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập để tiếp tục.")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user_id = payload.get("sub")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
    user = db.get(User, user_id) if user_id else None
    if not user or not user.active:
        raise HTTPException(status_code=401, detail="Tài khoản không còn hoạt động.")
    return user


def require_roles(*roles):
    def dependency(user: User = Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Bạn không có quyền thực hiện thao tác này.")
        return user
    return dependency


def public_user(user: User):
    return {"id": user.id, "email": user.email, "fullName": user.full_name, "studentCode": user.student_code, "role": user.role, "active": user.active}


class RegisterPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    fullName: str = Field(min_length=2, max_length=160)
    studentCode: str | None = Field(default=None, max_length=40)


class LoginPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserPayload(BaseModel):
    email: EmailStr
    fullName: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=10, max_length=128)
    role: Literal["student", "staff", "admin"] = "student"
    studentCode: str | None = Field(default=None, max_length=40)


class UserUpdatePayload(BaseModel):
    fullName: str | None = Field(default=None, min_length=2, max_length=160)
    role: Literal["student", "staff", "admin"] | None = None
    active: bool | None = None


class AnnouncementPayload(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    content: str = Field(default="", max_length=100_000)
    category: str = Field(default="Học phí", max_length=80)
    cohort: str | None = Field(default=None, max_length=80)
    major: str | None = Field(default=None, max_length=160)
    semester: str | None = Field(default=None, max_length=80)
    academicYear: str | None = Field(default=None, max_length=30)
    feeType: str | None = Field(default=None, max_length=100)
    status: Literal["draft", "published"] = "published"


class ChatPayload(BaseModel):
    messages: list[dict] = Field(min_length=1, max_length=24)
    sourceIds: list[str] | None = None
    sessionId: str | None = None
    filters: dict[str, str | None] = Field(default_factory=dict)


class ChatImportPayload(BaseModel):
    conversations: list[dict] = Field(max_length=100)


class FeedbackPayload(BaseModel):
    messageId: str
    rating: Literal["helpful", "not_helpful"]
    comment: str = Field(default="", max_length=2000)


def announcement_dict(item: Announcement, include_content=True):
    result = {
        "id": item.id, "title": item.title, "category": item.category, "cohort": item.cohort,
        "major": item.major, "semester": item.semester, "academicYear": item.academic_year,
        "feeType": item.fee_type, "status": item.status, "createdAt": item.created_at,
        "updatedAt": item.updated_at,
    }
    if include_content:
        result["content"] = item.content
        result["documents"] = [{"id": doc.id, "name": doc.original_name, "status": doc.status} for doc in item.documents]
    return result


def session_dict(item: ChatSession, include_messages=False):
    result = {"id": item.id, "title": item.title, "createdAt": item.created_at, "updatedAt": item.updated_at}
    if include_messages:
        result["messages"] = [
            {"id": message.id, "role": message.role, "content": message.content, "citations": message.citations or [], "suggestions": message.suggestions or [], "createdAt": message.created_at}
            for message in item.messages
        ]
    return result


def clean_metadata(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def extract_document_text(filename, data):
    suffix = Path(filename).suffix.lower()
    if suffix == ".docx":
        from docx import Document as WordDocument
        word = WordDocument(__import__("io").BytesIO(data))
        parts = [paragraph.text for paragraph in word.paragraphs if paragraph.text.strip()]
        for table in word.tables:
            parts.extend(" | ".join(cell.text.strip() for cell in row.cells) for row in table.rows)
        return "\n\n".join(parts)
    if suffix == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(__import__("io").BytesIO(data))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages).strip()
    return data.decode("utf-8-sig", errors="replace")


def split_into_nodes(text, max_chars=1100, overlap=160):
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text.replace("\r", "")) if part.strip()]
    nodes = []
    current = ""
    for paragraph in paragraphs:
        while len(paragraph) > max_chars:
            split_at = paragraph.rfind(" ", 0, max_chars)
            if split_at < max_chars // 2:
                split_at = max_chars
            piece, paragraph = paragraph[:split_at].strip(), paragraph[split_at:].strip()
            if current:
                nodes.append(current)
                current = current[-overlap:] + "\n" + piece
            else:
                nodes.append(piece)
        candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
        if len(candidate) > max_chars and current:
            nodes.append(current)
            current = f"{current[-overlap:]}\n{paragraph}".strip()
        else:
            current = candidate
    if current:
        nodes.append(current)
    return nodes


def index_static_chunks():
    try:
        return ensure_index()
    except Exception as error:
        print(f"Elasticsearch initialization failed: {type(error).__name__}")
        return False


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    return {"ok": True, "llmConfigured": bool(api_key()), "knowledgeBaseReady": (ROOT / "public" / "kb" / "chunks.json").is_file(), "databaseReady": True, "searchReady": is_available()}


@app.post("/api/auth/register")
def register(payload: RegisterPayload, response: Response, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email này đã được đăng ký.")
    if payload.studentCode and db.scalar(select(User.id).where(User.student_code == payload.studentCode.strip())):
        raise HTTPException(status_code=409, detail="Mã sinh viên này đã được đăng ký.")
    user = User(id=new_id(), email=email, full_name=payload.fullName.strip(), student_code=clean_metadata(payload.studentCode), password_hash=PASSWORD_HASHER.hash(payload.password), role="student")
    db.add(user)
    db.commit()
    response.set_cookie(COOKIE_NAME, make_token(user), httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=12 * 60 * 60, path="/")
    return {"user": public_user(user)}


@app.post("/api/auth/login")
def login(payload: LoginPayload, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower().strip()))
    if not user or not user.active:
        raise HTTPException(status_code=401, detail="Email hoặc mật khẩu chưa đúng.")
    try:
        PASSWORD_HASHER.verify(user.password_hash, payload.password)
    except VerifyMismatchError:
        raise HTTPException(status_code=401, detail="Email hoặc mật khẩu chưa đúng.")
    if PASSWORD_HASHER.check_needs_rehash(user.password_hash):
        user.password_hash = PASSWORD_HASHER.hash(payload.password)
        db.commit()
    response.set_cookie(COOKIE_NAME, make_token(user), httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=12 * 60 * 60, path="/")
    return {"user": public_user(user)}


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: User = Depends(get_current_user)):
    return {"user": public_user(user)}


@app.get("/api/users")
def list_users(
    role: str | None = None,
    q: str = "",
    _admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    stmt = select(User).order_by(User.created_at.desc()).limit(500)
    if role in {"student", "staff", "admin"}:
        stmt = stmt.where(User.role == role)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.email.ilike(like), User.full_name.ilike(like), User.student_code.ilike(like)))
    return [public_user(user) | {"createdAt": user.created_at} for user in db.scalars(stmt)]


@app.post("/api/users", status_code=201)
def create_user(payload: UserPayload, _admin: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    email = payload.email.lower().strip()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email này đã tồn tại.")
    user = User(id=new_id(), email=email, full_name=payload.fullName.strip(), student_code=clean_metadata(payload.studentCode), password_hash=PASSWORD_HASHER.hash(payload.password), role=payload.role)
    db.add(user)
    db.commit()
    return public_user(user)


@app.patch("/api/users/{user_id}")
def update_user(user_id: str, payload: UserUpdatePayload, admin: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.")
    changes = payload.model_dump(exclude_unset=True)
    if user.id == admin.id and changes.get("active") is False:
        raise HTTPException(status_code=400, detail="Không thể tự khóa tài khoản đang đăng nhập.")
    if "fullName" in changes:
        user.full_name = changes["fullName"].strip()
    if "role" in changes:
        user.role = changes["role"]
    if "active" in changes:
        user.active = changes["active"]
    db.commit()
    return public_user(user)


@app.get("/api/announcements")
def list_announcements(
    q: str = "", cohort: str | None = None, major: str | None = None, semester: str | None = None,
    academicYear: str | None = None, feeType: str | None = None, category: str | None = None,
    _user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    stmt = select(Announcement).options(joinedload(Announcement.documents)).order_by(Announcement.updated_at.desc()).limit(500)
    if _user.role == "student":
        stmt = stmt.where(Announcement.status == "published")
    for field, value in ((Announcement.cohort, cohort), (Announcement.major, major), (Announcement.semester, semester), (Announcement.academic_year, academicYear), (Announcement.fee_type, feeType), (Announcement.category, category)):
        if value:
            stmt = stmt.where(field == value)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Announcement.title.ilike(like), Announcement.content.ilike(like)))
    return [announcement_dict(item) for item in db.scalars(stmt).unique()]


@app.post("/api/announcements", status_code=201)
def create_announcement(payload: AnnouncementPayload, user: User = Depends(require_roles("staff", "admin")), db: Session = Depends(get_db)):
    item = Announcement(
        id=new_id(), title=payload.title.strip(), content=payload.content.strip(), category=payload.category.strip(),
        cohort=clean_metadata(payload.cohort), major=clean_metadata(payload.major), semester=clean_metadata(payload.semester),
        academic_year=clean_metadata(payload.academicYear), fee_type=clean_metadata(payload.feeType), status=payload.status,
        created_by=user.id,
    )
    db.add(item)
    db.commit()
    return announcement_dict(item)


@app.patch("/api/announcements/{announcement_id}")
def update_announcement(announcement_id: str, payload: AnnouncementPayload, _user: User = Depends(require_roles("staff", "admin")), db: Session = Depends(get_db)):
    item = db.get(Announcement, announcement_id)
    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy thông báo.")
    item.title, item.content, item.category, item.cohort = payload.title.strip(), payload.content.strip(), payload.category.strip(), clean_metadata(payload.cohort)
    item.major, item.semester, item.academic_year = clean_metadata(payload.major), clean_metadata(payload.semester), clean_metadata(payload.academicYear)
    item.fee_type, item.status, item.updated_at = clean_metadata(payload.feeType), payload.status, utcnow()
    db.commit()
    return announcement_dict(item)


@app.delete("/api/announcements/{announcement_id}")
def delete_announcement(announcement_id: str, _user: User = Depends(require_roles("staff", "admin")), db: Session = Depends(get_db)):
    item = db.get(Announcement, announcement_id)
    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy thông báo.")
    document_paths = [UPLOAD_DIR / document.stored_name for document in item.documents]
    try:
        from .search import client, INDEX_NAME
    except ImportError:
        from search import client, INDEX_NAME
    try:
        if is_available():
            client().delete_by_query(index=INDEX_NAME, query={"term": {"announcementId": announcement_id}}, conflicts="proceed", refresh=True)
    except Exception:
        pass
    db.delete(item)
    db.commit()
    for path in document_paths:
        path.unlink(missing_ok=True)
    return {"ok": True}


@app.post("/api/documents/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(...), title: str = Query(..., min_length=3, max_length=300),
    category: str = Query("Học phí", max_length=80), cohort: str | None = None, major: str | None = None,
    semester: str | None = None, academicYear: str | None = None, feeType: str | None = None,
    announcementId: str | None = None, user: User = Depends(require_roles("staff", "admin")), db: Session = Depends(get_db),
):
    original_name = Path(file.filename or "").name
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Chỉ hỗ trợ .docx, .pdf, .md và .txt.")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Tệp tối đa 25 MB.")
    try:
        text = extract_document_text(original_name, data)
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Không trích xuất được nội dung tệp: {type(error).__name__}.")
    if len(text.strip()) < 20:
        raise HTTPException(status_code=422, detail="Không tìm thấy đủ văn bản để lập chỉ mục.")
    is_new_announcement = not announcementId
    announcement = db.get(Announcement, announcementId) if announcementId else Announcement(
        id=new_id(), title=title.strip(), content=text[:100_000], category=category.strip(), cohort=clean_metadata(cohort),
        major=clean_metadata(major), semester=clean_metadata(semester), academic_year=clean_metadata(academicYear),
        fee_type=clean_metadata(feeType), status="draft", created_by=user.id,
    )
    if announcementId and not announcement:
        raise HTTPException(status_code=404, detail="Không tìm thấy thông báo cần đính kèm.")
    if announcementId:
        announcement.title = title.strip()
        announcement.content = text[:100_000]
        announcement.category = category.strip()
        announcement.cohort, announcement.major = clean_metadata(cohort), clean_metadata(major)
        announcement.semester, announcement.academic_year = clean_metadata(semester), clean_metadata(academicYear)
        announcement.fee_type = clean_metadata(feeType)
    stored_name = f"{new_id()}{suffix}"
    (UPLOAD_DIR / stored_name).write_bytes(data)
    document = Document(id=new_id(), original_name=original_name, stored_name=stored_name, media_type=file.content_type or "application/octet-stream", extracted_text=text, uploaded_by=user.id)
    if is_new_announcement:
        db.add(announcement)
    document.announcement = announcement
    nodes = [KnowledgeNode(
        id=new_id(), document=document, title=announcement.title, section=f"Phần {index + 1}", content=part,
        cohort=announcement.cohort, major=announcement.major, semester=announcement.semester,
        academic_year=announcement.academic_year, fee_type=announcement.fee_type,
        source_label=announcement.title, search_status="pending",
    ) for index, part in enumerate(split_into_nodes(text))]
    db.add(document)
    db.add_all(nodes)
    db.commit()
    try:
        indexed = index_knowledge_nodes(document, nodes, announcement)
    except Exception:
        indexed = False
    document.status = "indexed" if indexed else "pending"
    for node in nodes:
        node.search_status = document.status
    db.commit()
    return {"document": {"id": document.id, "name": original_name, "status": document.status, "nodeCount": len(nodes)}, "announcement": announcement_dict(announcement)}


@app.get("/api/documents/{document_id}")
def get_document(document_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    document = db.scalar(select(Document).options(joinedload(Document.announcement)).where(Document.id == document_id))
    if not document:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu.")
    if user.role == "student" and (not document.announcement or document.announcement.status != "published"):
        raise HTTPException(status_code=403, detail="Tài liệu chưa được công bố.")
    return {"id": document.id, "name": document.original_name, "title": document.announcement.title if document.announcement else document.original_name, "text": document.extracted_text}


@app.get("/api/documents/{document_id}/file")
def download_document(document_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    document = db.scalar(select(Document).options(joinedload(Document.announcement)).where(Document.id == document_id))
    if not document:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu.")
    if user.role == "student" and (not document.announcement or document.announcement.status != "published"):
        raise HTTPException(status_code=403, detail="Tài liệu chưa được công bố.")
    return FileResponse(UPLOAD_DIR / document.stored_name, filename=document.original_name, media_type=document.media_type)


@app.get("/api/search")
def search_student(
    q: str = Query(min_length=2, max_length=500), cohort: str | None = None, major: str | None = None,
    semester: str | None = None, academicYear: str | None = None, feeType: str | None = None,
    _user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    filters = {"cohort": cohort, "major": major, "semester": semester, "academicYear": academicYear, "feeType": feeType}
    hits = search_for_student(q, filters=filters, limit=30)
    if hits is None:
        stmt = select(KnowledgeNode).join(Document).outerjoin(Announcement).where(or_(KnowledgeNode.content.ilike(f"%{q}%"), KnowledgeNode.title.ilike(f"%{q}%")))
        stmt = stmt.where(Announcement.status == "published")
        for field, value in ((KnowledgeNode.cohort, cohort), (KnowledgeNode.major, major), (KnowledgeNode.semester, semester), (KnowledgeNode.academic_year, academicYear), (KnowledgeNode.fee_type, feeType)):
            if value:
                stmt = stmt.where(field == value)
        hits = [{"text": node.content, "section": node.section, "sourceTitle": node.source_label, "documentId": node.document_id, "announcementId": node.document.announcement_id} for node in db.scalars(stmt.limit(30))]
        if not any((cohort, major, semester, academicYear, feeType)):
            try:
                from .search import fallback_static_chunks
            except ImportError:
                from search import fallback_static_chunks
                hits.extend(fallback_static_chunks(q))
    else:
        published_ids = set(db.scalars(select(Announcement.id).where(Announcement.status == "published")))
        hits = [hit for hit in hits if not hit.get("announcementId") or hit.get("announcementId") in published_ids]
    return {"results": hits, "engine": "elasticsearch" if is_available() else "database-fallback"}


@app.get("/api/chats")
def list_chats(q: str = "", user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(ChatSession).where(ChatSession.user_id == user.id).order_by(ChatSession.updated_at.desc()).limit(500)
    if q.strip():
        like = f"%{q.strip()}%"
        matching_ids = select(ChatMessage.session_id).where(ChatMessage.content.ilike(like)).distinct()
        stmt = stmt.where(or_(ChatSession.title.ilike(like), ChatSession.id.in_(matching_ids)))
    sessions = db.scalars(stmt)
    return [session_dict(item) for item in sessions]


@app.post("/api/chats/import")
def import_local_chats(payload: ChatImportPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    imported = 0
    for item in payload.conversations:
        if not isinstance(item, dict) or not isinstance(item.get("messages"), list):
            continue
        messages = [m for m in item["messages"] if isinstance(m, dict) and m.get("role") in {"user", "assistant"} and isinstance(m.get("content"), str) and m["content"].strip()]
        if not messages:
            continue
        session = ChatSession(id=new_id(), user_id=user.id, title=str(item.get("title") or messages[-1]["content"])[:300])
        db.add(session)
        for message in messages[:200]:
            db.add(ChatMessage(id=new_id(), session_id=session.id, role=message["role"], content=message["content"][:8000], citations=message.get("citations") if isinstance(message.get("citations"), list) else [], suggestions=message.get("suggestions") if isinstance(message.get("suggestions"), list) else []))
        imported += 1
    db.commit()
    return {"imported": imported}


@app.get("/api/chats/{session_id}")
def get_chat(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.scalar(select(ChatSession).options(joinedload(ChatSession.messages)).where(ChatSession.id == session_id, ChatSession.user_id == user.id))
    if not session:
        raise HTTPException(status_code=404, detail="Không tìm thấy cuộc trò chuyện.")
    return session_dict(session, include_messages=True)


@app.delete("/api/chats/{session_id}")
def delete_chat(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.scalar(select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user.id))
    if not session:
        raise HTTPException(status_code=404, detail="Không tìm thấy cuộc trò chuyện.")
    db.delete(session)
    db.commit()
    return {"ok": True}


@app.post("/api/chat")
def chat(payload: ChatPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    messages = [message for message in payload.messages if isinstance(message, dict) and message.get("role") in {"user", "assistant"} and isinstance(message.get("content"), str) and not message.get("status")]
    if not messages or messages[-1]["role"] != "user" or not messages[-1]["content"].strip():
        raise HTTPException(status_code=400, detail="Hãy nhập câu hỏi trước khi gửi.")
    if not api_key():
        raise HTTPException(status_code=503, detail="Chưa cấu hình GOOGLE_API_KEY trong .env.local.")
    question = messages[-1]["content"].strip()[:8000]
    session = db.get(ChatSession, payload.sessionId) if payload.sessionId else None
    if session and session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy cuộc trò chuyện.")
    if not session:
        session = ChatSession(id=new_id(), user_id=user.id, title=question[:54])
        db.add(session)
    existing_last = db.scalar(select(ChatMessage).where(ChatMessage.session_id == session.id).order_by(ChatMessage.created_at.desc()).limit(1))
    if not existing_last or existing_last.role != "user" or existing_last.content != question:
        db.add(ChatMessage(id=new_id(), session_id=session.id, role="user", content=question))
    session.title = question[:54]
    session.updated_at = utcnow()
    db.commit()
    try:
        chunks = search_for_chat(question, filters=payload.filters, source_ids=payload.sourceIds, limit=5)
        if user.role == "student":
            document_ids = {chunk.get("documentId") for chunk in chunks if chunk.get("documentId")}
            if document_ids:
                visible_ids = set(db.scalars(select(Document.id).join(Announcement).where(Document.id.in_(document_ids), Announcement.status == "published")))
                chunks = [chunk for chunk in chunks if not chunk.get("documentId") or chunk.get("documentId") in visible_ids]
        prompt, allowed_sources = build_prompt(chunks)
        genai.configure(api_key=api_key())
        model = genai.GenerativeModel(model_name=model_name(), system_instruction=prompt, generation_config={"temperature": 0.2, "max_output_tokens": 900})
        history = [
            {"role": "model" if item["role"] == "assistant" else "user", "parts": [item["content"][:8000]]}
            for item in messages[-12:]
        ]
        result = model.generate_content(history, request_options={"timeout": 60})
        answer = parse_model_response(result.text, allowed_sources)
        assistant_message = ChatMessage(id=new_id(), session_id=session.id, role="assistant", content=answer["answer"], citations=answer["citations"], suggestions=answer["suggestions"])
        db.add(assistant_message)
        session.updated_at = utcnow()
        db.commit()
        return answer | {"sessionId": session.id, "messageId": assistant_message.id}
    except Exception as error:
        db.rollback()
        print(f"Gemini request failed: {type(error).__name__}")
        raise HTTPException(status_code=502, detail="Gemini chưa xử lý được yêu cầu. Kiểm tra GEMINI_MODEL và API key.", headers={"X-Session-Id": session.id})


@app.post("/api/feedback", status_code=201)
def submit_feedback(payload: FeedbackPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    message = db.get(ChatMessage, payload.messageId)
    if not message or message.role != "assistant":
        raise HTTPException(status_code=404, detail="Không tìm thấy câu trả lời cần đánh giá.")
    chat_session = db.get(ChatSession, message.session_id)
    if not chat_session or chat_session.user_id != user.id:
        raise HTTPException(status_code=403, detail="Bạn chỉ có thể đánh giá câu trả lời của mình.")
    feedback = db.scalar(select(Feedback).where(Feedback.user_id == user.id, Feedback.message_id == message.id))
    if feedback:
        feedback.rating, feedback.comment, feedback.status = payload.rating, payload.comment.strip(), "new"
    else:
        feedback = Feedback(id=new_id(), user_id=user.id, message_id=message.id, rating=payload.rating, comment=payload.comment.strip())
        db.add(feedback)
    db.commit()
    return {"id": feedback.id, "rating": feedback.rating, "status": feedback.status}


@app.get("/api/admin/overview")
def admin_overview(_admin: User = Depends(require_roles("admin", "staff")), db: Session = Depends(get_db)):
    return {
        "students": db.scalar(select(func.count()).select_from(User).where(User.role == "student")) or 0,
        "staff": db.scalar(select(func.count()).select_from(User).where(User.role == "staff")) or 0,
        "announcements": db.scalar(select(func.count()).select_from(Announcement)) or 0,
        "publishedAnnouncements": db.scalar(select(func.count()).select_from(Announcement).where(Announcement.status == "published")) or 0,
        "documents": db.scalar(select(func.count()).select_from(Document)) or 0,
        "pendingDocuments": db.scalar(select(func.count()).select_from(Document).where(Document.status == "pending")) or 0,
        "chatSessions": db.scalar(select(func.count()).select_from(ChatSession)) or 0,
        "newFeedback": db.scalar(select(func.count()).select_from(Feedback).where(Feedback.status == "new")) or 0,
        "searchReady": is_available(),
    }


@app.get("/api/admin/feedback")
def admin_feedback(_admin: User = Depends(require_roles("admin", "staff")), db: Session = Depends(get_db)):
    stmt = select(Feedback).options(joinedload(Feedback.user), joinedload(Feedback.message)).order_by(Feedback.created_at.desc()).limit(300)
    return [{"id": item.id, "rating": item.rating, "comment": item.comment, "status": item.status, "createdAt": item.created_at, "user": item.user.full_name, "answer": item.message.content} for item in db.scalars(stmt).unique()]


@app.patch("/api/admin/feedback/{feedback_id}")
def update_feedback(feedback_id: str, status_value: Literal["new", "reviewing", "resolved"] = Query(alias="status"), _admin: User = Depends(require_roles("admin", "staff")), db: Session = Depends(get_db)):
    feedback = db.get(Feedback, feedback_id)
    if not feedback:
        raise HTTPException(status_code=404, detail="Không tìm thấy phản hồi.")
    feedback.status = status_value
    db.commit()
    return {"id": feedback.id, "status": feedback.status}


@app.post("/api/admin/reindex")
def reindex(_admin: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    try:
        ensure_index()
        documents = db.scalars(select(Document).options(joinedload(Document.announcement), joinedload(Document.nodes)))
        count = 0
        for document in documents:
            if index_knowledge_nodes(document, document.nodes, document.announcement):
                document.status = "indexed"
                for node in document.nodes:
                    node.search_status = "indexed"
                count += len(document.nodes)
        db.commit()
        return {"ok": True, "indexedNodes": count}
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Elasticsearch chưa sẵn sàng: {type(error).__name__}.")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("API_PORT", "8788")), reload=False)
