import getpass
import sys
import uuid

try:
    from .app import PASSWORD_HASHER
    from .database import SessionLocal, User, initialize_database
except ImportError:
    from app import PASSWORD_HASHER
    from database import SessionLocal, User, initialize_database


def main():
    initialize_database()
    email = input("Admin email: ").strip().lower()
    full_name = input("Admin full name: ").strip()
    password = getpass.getpass("Admin password (10+ characters): ")
    if len(password) < 10:
        raise SystemExit("Mật khẩu cần ít nhất 10 ký tự.")
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one_or_none()
        if user:
            user.full_name = full_name
            user.role = "admin"
            user.active = True
            user.password_hash = PASSWORD_HASHER.hash(password)
            print("Đã cập nhật tài khoản admin.")
        else:
            db.add(User(id=str(uuid.uuid4()), email=email, full_name=full_name, password_hash=PASSWORD_HASHER.hash(password), role="admin"))
            print("Đã tạo tài khoản admin.")
        db.commit()


if __name__ == "__main__":
    main()
