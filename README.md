# Trợ lý học phí

Chatbot web dùng React và Vite. Giao diện được viết bằng component React; CSS quản lý phần trình bày.

## Chạy local

Từ thư mục này, cài dependencies:

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Sao chép `.env.example` thành `.env.local`, điền `GOOGLE_API_KEY` và `GEMINI_MODEL`, rồi chạy cả frontend lẫn backend:

```powershell
Copy-Item .env.example .env.local
npm run dev:full
```

Mở URL Vite in ra (thường là `http://localhost:5173`). Backend chạy ở `127.0.0.1:8787`; Vite chuyển tiếp `/api` tới backend.

Thêm `?demo=1` để mở câu trả lời mẫu từ Quyết định 2807 và xem cách hiển thị trích dẫn.

## Backend và Gemini SDK

Backend Python nằm ở `server/google_api.py`, dùng trực tiếp package `google-generativeai` với `GenerativeModel.generate_content()` và nhận `POST /api/chat`. Điền cấu hình trong `.env.local`:

```env
GOOGLE_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
PORT=8787
```

Không đặt key vào biến `VITE_*` hay mã React. Backend truy hồi 5 chunk liên quan, gửi chúng làm căn cứ cho Gemini, rồi trả lời theo cấu trúc:

```js
{ answer: "...", citations: [{ sourceId: "2807", label: "..." }], suggestions: ["..."] }
```

`GET /api/health` cho biết backend đang chạy và đã thấy API key chưa. Node truy hồi các vector hiện có, còn Python gọi Gemini SDK trực tiếp. Google đã đánh dấu `google-generativeai` là SDK legacy và khuyến nghị [google-genai](https://ai.google.dev/gemini-api/docs/libraries); project đang giữ package bạn yêu cầu.

Danh mục nguồn nằm trong `src/sources.js`; các bản Markdown được phục vụ từ `public/sources/`.
Các trích dẫn mở trang đọc tài liệu đã render Markdown trong app để giữ dấu tiếng Việt, bảng và danh sách dễ đọc.

## Chunk và embedding tài liệu

Lịch sử hội thoại được lưu trong `localStorage` của trình duyệt hiện tại. Người dùng có thể tìm trong câu hỏi và câu trả lời, mở lại hoặc xóa từng cuộc trò chuyện. Dữ liệu không đồng bộ giữa các thiết bị.

Bốn file Markdown ở thư mục gốc là nguồn dữ liệu gốc. Chúng được chia thành các đoạn khoảng 1.100 ký tự với 160 ký tự chồng lấn. Chạy lệnh sau để đồng bộ bản hiển thị, chia chunk và tạo lại embedding sau khi sửa tài liệu:

```powershell
npm run kb:build
```

Lần đầu chạy, Transformers.js tải model embedding đa ngôn ngữ về cache máy người dùng; lệnh không cần API key. Kết quả chunk kèm vector 384 chiều được ghi vào `public/kb/chunks.json`.

Thử tìm các đoạn liên quan bằng embedding kết hợp từ khóa:

```powershell
npm run kb:search -- "Học kỳ I năm học 2026-2027 thu học phí đến ngày nào?"
```

Backend gọi `retrieveRelevantChunks(query)` từ `src/knowledge-base.node.js` để lấy chunk xếp hạng cao nhất. Query phải embed cùng model đã tạo index; nếu đổi model embedding thì chạy lại `npm run kb:build`.
