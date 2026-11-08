import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from server import app as app_module
from server.database import Base


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{(tmp_path / 'test.db').as_posix()}", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def test_database():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app_module.app.dependency_overrides[app_module.get_db] = test_database
    monkeypatch.setattr(app_module, "is_available", lambda: False)
    monkeypatch.setattr(app_module, "index_knowledge_nodes", lambda *args, **kwargs: False)
    monkeypatch.setattr(app_module, "UPLOAD_DIR", tmp_path / "uploads")
    app_module.UPLOAD_DIR.mkdir()
    test_client = TestClient(app_module.app)
    test_client.test_db_factory = TestingSession
    yield test_client
    app_module.app.dependency_overrides.clear()
    engine.dispose()


def test_student_can_register_and_cannot_open_staff_dashboard(client):
    response = client.post("/api/auth/register", json={
        "email": "student@example.edu", "password": "a-long-test-password",
        "fullName": "Sinh viên thử nghiệm", "studentCode": "SV0001",
    })
    assert response.status_code == 200
    assert response.json()["user"]["role"] == "student"
    assert client.get("/api/auth/me").json()["user"]["email"] == "student@example.edu"
    assert client.get("/api/admin/overview").status_code == 403


def test_announcement_filters_only_return_published_for_students(client):
    client.post("/api/auth/register", json={
        "email": "student@example.edu", "password": "a-long-test-password", "fullName": "Sinh viên",
    })
    assert client.get("/api/announcements?academicYear=2026-2027").json() == []


def test_student_cannot_see_draft_announcement(client):
    client.post("/api/auth/register", json={
        "email": "writer@example.edu", "password": "a-long-test-password", "fullName": "Nhân viên",
    })
    with client.test_db_factory() as db:
        from server.database import User
        writer = db.query(User).filter_by(email="writer@example.edu").one()
        writer.role = "staff"
        db.commit()
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"email": "writer@example.edu", "password": "a-long-test-password"})
    draft = client.post("/api/announcements", json={
        "title": "Bản nháp học phí học kỳ I", "content": "Thông báo nội bộ chưa công bố.", "status": "draft",
    })
    assert draft.status_code == 201
    client.post("/api/auth/logout")
    client.post("/api/auth/register", json={
        "email": "student@example.edu", "password": "a-long-test-password", "fullName": "Sinh viên",
    })
    response = client.get("/api/announcements")
    assert response.status_code == 200
    assert response.json() == []


def test_document_upload_extracts_text_and_starts_as_draft(client):
    client.post("/api/auth/register", json={
        "email": "staff@example.edu", "password": "a-long-test-password", "fullName": "Nhân viên",
    })
    with client.test_db_factory() as db:
        from server.database import User
        staff = db.query(User).filter_by(email="staff@example.edu").one()
        staff.role = "staff"
        db.commit()
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"email": "staff@example.edu", "password": "a-long-test-password"})
    response = client.post("/api/documents/upload?title=Quy+định+học+phí&academicYear=2026-2027", files={
        "file": ("quy-dinh.txt", "Nội dung quy định về thời hạn đóng học phí của sinh viên.", "text/plain"),
    })
    assert response.status_code == 201
    assert response.json()["document"]["nodeCount"] == 1
    assert response.json()["announcement"]["status"] == "draft"


def test_chat_uses_grounded_context_and_persists_messages(client, monkeypatch):
    client.post("/api/auth/register", json={
        "email": "student@example.edu", "password": "a-long-test-password", "fullName": "Sinh viên",
    })
    monkeypatch.setattr(app_module, "api_key", lambda: "test-key")
    monkeypatch.setattr(app_module, "search_for_chat", lambda *args, **kwargs: [{
        "sourceId": "2807", "sourceTitle": "Quy định thu học phí", "section": "Thời gian thu", "text": "Nội dung quy định làm căn cứ trả lời.",
    }])
    monkeypatch.setattr(app_module.genai, "configure", lambda **kwargs: None)

    class FakeModel:
        def __init__(self, **kwargs):
            pass

        def generate_content(self, _history, **kwargs):
            class Result:
                text = '{"answer":"Theo quy định của trường.","citations":["2807"],"suggestions":[]}'
            return Result()

    monkeypatch.setattr(app_module.genai, "GenerativeModel", FakeModel)
    response = client.post("/api/chat", json={"messages": [{"role": "user", "content": "Khi nào đóng học phí?"}]})
    assert response.status_code == 200
    assert response.json()["citations"][0]["sourceId"] == "2807"
    detail = client.get(f"/api/chats/{response.json()['sessionId']}").json()
    assert [message["role"] for message in detail["messages"]] == ["user", "assistant"]


def test_logout_clears_authenticated_session(client):
    client.post("/api/auth/register", json={
        "email": "student@example.edu", "password": "a-long-test-password", "fullName": "Sinh viên",
    })
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401
