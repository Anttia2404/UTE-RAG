# Design

- **Sản phẩm:** chatbot tra cứu quy định và thông báo học phí từ tài liệu trong workspace.
- **Người dùng:** người cần tìm câu trả lời và căn cứ trong các văn bản học phí.
- **Việc chính:** đặt câu hỏi, đọc câu trả lời, mở tài liệu được trích dẫn.
- **Nền tảng:** web, máy tính và điện thoại.
- **Điểm khác biệt:** mỗi câu trả lời gắn với tài liệu nguồn cụ thể.
- **Bộ mặt:** Clean, Flat, header nội dung, Inter; một cột chat tập trung theo wireframe A. UI triển khai bằng React + Vite, style ở `src/styles.css`.
- **Màu nhấn:** xanh dương `#2563eb` (giáo dục); chỉ chế độ sáng.
- **Logo:** dấu chữ T dựng bằng hình khối; favicon dùng cùng dấu.
- **Màn đã dựng:** chat tập trung, trích dẫn mở Markdown nguồn, gợi ý mở đầu và hỏi tiếp. Khung mở đầu là chat mới; `?demo=1` hiển thị câu trả lời mẫu có căn cứ trong Quyết định 2807.
- **Nguồn hiện có:** bốn tài liệu Markdown tại thư mục gốc; mỗi tài liệu có một bản `.docx` tương ứng.
- **LLM:** backend Python gọi Google Generative AI SDK tại `server/google_api.py`; key/model lấy từ `.env.local`.
