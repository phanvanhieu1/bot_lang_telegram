# V1 Translation Pipeline

Cài đặt Hybrid Context Resolver được lưu trên tài khoản và mặc định tắt. Web PRO dùng cài đặt đã xác thực ở server. Telegram dùng cài đặt của tài khoản đã liên kết khi dịch trong chat riêng. FREE tiếp tục dùng provider FREE và bảo vệ văn bản bằng cùng bộ tiền xử lý.

- OFF → tiền xử lý → V1 → kiểm tra và khôi phục các phần cố định.
- ON → cùng tiền xử lý → xét bằng chứng từ khóa hoặc ví dụ → đưa ngữ cảnh có liên quan vào user payload V1 → cùng bước kiểm tra và khôi phục.
- Resolver dùng từ khóa khớp trong phần văn bản tự nhiên, yêu cầu ít nhất hai điểm bằng chứng và để nguyên trường hợp đồng điểm hoặc ít bằng chứng. Profile nghề nghiệp và chủ đề chỉ là dữ liệu tài khoản. Từ điển đã duyệt đi theo cơ chế V1 hiện có.
- Phiên hội thoại phải thuộc đúng tài khoản/kênh và đang mở. Tối đa hai lượt có liên quan được gửi nguyên vẹn. Lượt dài hoặc chứa thành phần được bảo vệ được bỏ qua. Không gọi LLM để chọn context.
- Cache PRO tách chế độ và tài khoản khi ON, kèm chữ ký payload, phiên bản hồ sơ và glossary. Các bản dịch dùng lịch sử hội thoại bỏ qua cache. FREE có namespace mới với khóa giữ khoảng trắng bên trong. Dữ liệu cache cũ vẫn nằm trong MongoDB.
- Mã bảo vệ được kiểm tra thứ tự, số lượng và nội dung trước khi khôi phục. Với đúng một URL làm địa điểm và một mã ID, tiếng Trung có thể đưa địa điểm lên trước nếu cấu trúc đích xác nhận rõ vai trò của URL. GPT V1 thử lại tối đa một lần nếu kết quả vi phạm quy tắc mã. Kết quả vẫn sai sẽ bị từ chối và không được lưu. Ảnh web đi qua bước kiểm tra định dạng và kích thước. Văn bản chỉ xuất hiện trong ảnh được OCR và dịch trong cùng lời gọi ảnh, nên không có văn bản trước GPT để thay bằng mã bảo vệ.
- Trang web ngừng định tuyến V2, giữ source và các bài kiểm thử V2 cho lần bật lại sau. Inspector chỉ hiển thị payload thực tế và giữ nguyên quyền xem admin hiện có.
