# Trợ lý học phí UTE

Ứng dụng RAG dùng React/Vite, FastAPI, SQLAlchemy, Elasticsearch và Google Generative AI SDK (`google-generativeai`). Tài khoản sinh viên tra cứu thông báo, đặt câu hỏi có trích dẫn và xem lịch sử riêng; nhân viên/quản trị viên nạp tài liệu, rà soát thông báo, theo dõi phản hồi và quản lý tài khoản.

## Chạy local

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env.local
```

Điền `GOOGLE_API_KEY` và `GEMINI_MODEL` trong `.env.local`, sau đó chạy frontend và backend:

```powershell
npm run dev:full
```

Mở `http://localhost:5173`. Backend FastAPI chạy ở `127.0.0.1:8788`; Vite chuyển tiếp `/api`. `.env.local` và database được loại khỏi Git.

Mặc định database là SQLite tại `data/tuition-assistant.db`, phù hợp phát triển và thử nghiệm trên một máy. Có thể bật PostgreSQL cùng Elasticsearch bằng Docker:

```powershell
docker compose up -d
```

Sau khi PostgreSQL sẵn sàng, thêm vào `.env.local` để dùng nó thay SQLite:

```env
DATABASE_URL=postgresql+psycopg://ute_rag:local_dev_only_change_me@127.0.0.1:5433/ute_rag
ELASTICSEARCH_URL=http://127.0.0.1:9200
```

Khởi động lại backend sau khi đổi database. Compose chỉ dành cho local development; đổi mật khẩu mặc định nếu đưa các dịch vụ ra khỏi máy cá nhân. Nếu Elasticsearch chưa chạy, chat tài liệu tĩnh vẫn dùng bộ truy hồi hiện có; tìm kiếm trong giao diện dùng fallback database và knowledge base tĩnh.

## Tài khoản và phân quyền

Sinh viên có thể tự đăng ký; tài khoản đăng ký công khai luôn có quyền `student`. Tạo tài khoản quản trị ban đầu bằng lệnh tương tác (mật khẩu không hiện trên màn hình):

```powershell
python -m server.create_admin
```

Quản trị viên tạo nhân viên/quản trị viên khác trong mục **Quản lý**. Phiên đăng nhập dùng cookie HttpOnly; mật khẩu được băm Argon2. Ở môi trường triển khai, đặt `APP_ENV=production` và `APP_SECRET_KEY` thành giá trị ngẫu nhiên riêng, giữ HTTPS bật để cookie Secure hoạt động.

## Tài liệu và knowledge base

Bốn file Markdown gốc nằm ở thư mục gốc và được phục vụ dưới `public/sources/`. Chạy lại bước chunk và tạo embedding khi sửa các tài liệu này:

```powershell
npm run kb:build
```

Các vector 384 chiều được lưu tại `public/kb/chunks.json`; truy hồi local kết hợp độ tương đồng ngữ nghĩa và từ khóa. Elasticsearch lập chỉ mục từ khóa cho bộ tài liệu tĩnh và các tài liệu tải lên. Nhân viên có thể tải `.docx`, `.pdf`, `.md`, `.txt` (tối đa 25 MB); backend trích xuất văn bản, chia đoạn có overlap, lưu metadata và lập chỉ mục. PDF dạng ảnh cần OCR trước khi tải lên.

Tài liệu mới tạo một thông báo bản nháp. Nhân viên rà soát rồi chọn **Công bố** để sinh viên có thể xem nội dung và mở trích dẫn. Dữ liệu tải lên nằm trong `data/uploads/`, được loại khỏi Git.

## Lịch sử, đánh giá và API

Chat và đánh giá được lưu trong database, gắn với tài khoản; người dùng chỉ truy cập lịch sử của chính mình. Lịch sử cũ từ `localStorage` được chuyển lên máy chủ sau lần đăng nhập tiếp theo và chỉ xóa bản trình duyệt sau khi API xác nhận nhận dữ liệu.

Các endpoint chính:

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET/POST/PATCH/DELETE /api/announcements`
- `POST /api/documents/upload`, `GET /api/documents/{id}`
- `GET /api/search`, `POST /api/chat`, `GET/DELETE /api/chats`
- `POST /api/feedback`, `GET /api/admin/overview`, `GET /api/admin/feedback`
- `GET /api/health`

LLM gọi trực tiếp `google-generativeai` và dùng `GOOGLE_API_KEY` phía server; không gửi key tới trình duyệt. Prompt yêu cầu chỉ căn cứ các trích đoạn truy hồi, hỏi làm rõ khi thiếu khóa/ngành/học kỳ/năm học/loại học phí, và trả citation theo nguồn được phép.

## Kiểm tra

```powershell
npm run build
.\.venv\Scripts\python.exe -m compileall -q server
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

`GET /api/health` báo trạng thái cấu hình Gemini, database, knowledge base và Elasticsearch.
