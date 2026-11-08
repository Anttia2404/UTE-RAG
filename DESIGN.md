# Design

- **Sản phẩm:** chatbot tra cứu quy định và thông báo học phí từ tài liệu trong workspace.
- **Người dùng:** người cần tìm câu trả lời và căn cứ trong các văn bản học phí.
- **Việc chính:** đặt câu hỏi, đọc câu trả lời, mở tài liệu được trích dẫn.
- **Nền tảng:** web, máy tính và điện thoại.
- **Điểm khác biệt:** mỗi câu trả lời gắn với tài liệu nguồn cụ thể.
- **Bộ mặt:** Clean, Flat, header nội dung, Inter; sidebar lịch sử bên trái và cột chat tập trung theo wireframe A, chuyển thành ngăn trượt trên mobile. UI triển khai bằng React + Vite, style ở `src/styles.css`.
- **Màu nhấn:** xanh dương `#2563eb` (giáo dục); chỉ chế độ sáng.
- **Logo:** dấu chữ T dựng bằng hình khối; favicon dùng cùng dấu.
- **Màn đã dựng:** khung chat có sidebar lịch sử luôn hiện trên desktop; sidebar có tìm kiếm theo câu hỏi và nội dung trả lời, nhóm theo thời gian, tạo chat mới, mở lại và xóa cuộc trò chuyện. Trên mobile, lịch sử mở trong ngăn trượt.
- **Lưu trữ chat:** `localStorage` trên trình duyệt hiện tại; tiêu đề lấy từ câu hỏi gần nhất. Không đồng bộ giữa thiết bị vì dự án chưa có tài khoản người dùng.
- **Trích dẫn và trả lời:** trích dẫn mở Markdown nguồn đã render; có gợi ý mở đầu, câu hỏi hỏi tiếp, sao chép và tạo lại câu trả lời. Khung mở đầu là chat mới; `?demo=1` hiển thị câu trả lời mẫu có căn cứ trong Quyết định 2807.
- **Nguồn hiện có:** bốn tài liệu Markdown tại thư mục gốc; mỗi tài liệu có một bản `.docx` tương ứng.
- **LLM:** backend Python gọi Google Generative AI SDK tại `server/google_api.py`; key/model lấy từ `.env.local`.
