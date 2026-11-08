import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local", override=False)
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(DATA_DIR / 'tuition-assistant.db').as_posix()}")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite:") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


if DATABASE_URL.startswith("sqlite:"):
    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def utcnow():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160))
    student_code: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="student", index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    sessions: Mapped[list["ChatSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    feedback: Mapped[list["Feedback"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Announcement(Base):
    __tablename__ = "announcements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(300), index=True)
    content: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(80), default="Học phí")
    cohort: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    major: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    semester: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    academic_year: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    fee_type: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="published", index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    documents: Mapped[list["Document"]] = relationship(back_populates="announcement", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    announcement_id: Mapped[str | None] = mapped_column(ForeignKey("announcements.id", ondelete="CASCADE"), nullable=True, index=True)
    original_name: Mapped[str] = mapped_column(String(255))
    stored_name: Mapped[str] = mapped_column(String(255), unique=True)
    media_type: Mapped[str] = mapped_column(String(120))
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="indexed", index=True)
    uploaded_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    announcement: Mapped[Announcement | None] = relationship(back_populates="documents")
    nodes: Mapped[list["KnowledgeNode"]] = relationship(back_populates="document", cascade="all, delete-orphan")


class KnowledgeNode(Base):
    __tablename__ = "knowledge_nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300), default="")
    section: Mapped[str] = mapped_column(String(300), default="Toàn văn")
    content: Mapped[str] = mapped_column(Text)
    cohort: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    major: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    semester: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    academic_year: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    fee_type: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    source_label: Mapped[str] = mapped_column(String(300), default="")
    search_status: Mapped[str] = mapped_column(String(20), default="pending", index=True)

    document: Mapped[Document] = relationship(back_populates="nodes")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300), default="Cuộc trò chuyện mới")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, index=True)

    user: Mapped[User] = relationship(back_populates="sessions")
    messages: Mapped[list["ChatMessage"]] = relationship(back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.created_at")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    citations: Mapped[list] = mapped_column(JSON, default=list)
    suggestions: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    session: Mapped[ChatSession] = relationship(back_populates="messages")
    feedback: Mapped[list["Feedback"]] = relationship(back_populates="message", cascade="all, delete-orphan")


class Feedback(Base):
    __tablename__ = "feedback"
    __table_args__ = (UniqueConstraint("user_id", "message_id", name="uq_feedback_user_message"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[str] = mapped_column(ForeignKey("chat_messages.id", ondelete="CASCADE"), index=True)
    rating: Mapped[str] = mapped_column(String(20))
    comment: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="new", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="feedback")
    message: Mapped[ChatMessage] = relationship(back_populates="feedback")


def initialize_database():
    Base.metadata.create_all(engine)


def get_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
