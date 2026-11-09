# Trợ lý học phí UTE

Ứng dụng RAG dùng React/Vite, FastAPI, SQLAlchemy, Elasticsearch và Google Generative AI SDK (`google-generativeai`). Tài khoản sinh viên tra cứu thông báo, đặt câu hỏi có trích dẫn, chuyển câu hỏi cho cán bộ và xem lịch sử riêng; nhân viên/quản trị viên nạp tài liệu, rà soát thông báo, trả lời yêu cầu hỗ trợ, theo dõi phản hồi và quản lý tài khoản.

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
- `POST/GET /api/tickets`, `POST /api/tickets/{id}/reply`, `POST /api/tickets/{id}/close`
- `POST /api/feedback`, `GET /api/admin/overview`, `GET /api/admin/feedback`
- `GET /api/health`

LLM gọi trực tiếp `google-generativeai` và dùng `GOOGLE_API_KEY` phía server; không gửi key tới trình duyệt. Prompt yêu cầu chỉ căn cứ các trích đoạn truy hồi, hỏi làm rõ khi thiếu khóa/ngành/học kỳ/năm học/loại học phí, và trả citation theo nguồn được phép.

Trước khi gửi câu hỏi cho Gemini, backend che email, số điện thoại và chuỗi 8 chữ số có dạng mã sinh viên. Sau khi nhận kết quả, bộ kiểm tra xác định đối chiếu số tiền, phần trăm và ngày trong câu trả lời với các chunk đã truy hồi; nếu thấy dữ kiện số chưa được nguồn hỗ trợ, ứng dụng thay câu trả lời bằng thông báo an toàn. Sinh viên mặc định có tối đa 30 lượt gọi Gemini mỗi ngày và 5 lượt/phút; toàn hệ thống có trần 800 lượt/ngày. Nhân viên và quản trị viên không bị áp dụng hạn mức này. Câu trả lời được cache trong RAM 10 phút, khóa cache bao gồm lịch sử ngắn và dấu vân tay nội dung nguồn; cache mất khi backend khởi động lại.

Sinh viên có thể chọn **Hỏi cán bộ** dưới câu trả lời. Nhân viên xem và trả lời yêu cầu trong mục **Quản lý → Yêu cầu cần trả lời**; phản hồi cũng được thêm vào lịch sử chat của sinh viên. Người học xem trạng thái hoặc đóng yêu cầu ở mục **Hỗ trợ**.

## Kiểm tra

```powershell
npm run build
.\.venv\Scripts\python.exe -m compileall -q server
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

`GET /api/health` báo trạng thái cấu hình Gemini, database, knowledge base và Elasticsearch.
