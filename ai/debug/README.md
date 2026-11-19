# Translation Debug Inspector

Mở **Chi tiết xử lý** bên dưới bản dịch web. Bảng có năm tab và sao chép JSON. Với tài khoản quản trị, chọn **Kèm payload AI** trước khi dịch để xem request/response đã được lọc. Các tài khoản khác nhận metadata stage và quyết định glossary của lượt dịch thuộc chính họ. API truyền dữ liệu qua trường `debug`, kèm `Cache-Control: private, no-store`.

- Personal Context Resolver chưa nối vào V1/V2. Debug báo `not_implemented`, hồ sơ chưa được truy xuất và không có context được chọn/gửi. `requestAudience` là lựa chọn người nghe trong yêu cầu dịch.
- Phiên hội thoại ghi lượt dịch mới sau khi hoàn thành. Claude và GPT chưa đọc hoặc nhận lịch sử của phiên. ID của client chỉ xuất hiện khi việc lưu vào phiên đúng chủ sở hữu thành công.
- Glossary ghi các mapping được truy xuất, khớp câu, chọn và loại theo domain/độ ưu tiên. Mục có điều kiện của V1 là gợi ý, và nghĩa xuất hiện trong đầu ra chỉ là bằng chứng văn bản. Cache hit có thể vẫn chạy stage bổ sung hoặc kiểm chứng.
- Admin nhận request body đã lọc tại điểm gọi provider và phần văn bản đầu ra công khai. Có giới hạn 48 KB cho từng request/response, tổng 120 KB và tối đa 24 lời gọi. Các field vượt giới hạn có trạng thái `size_limit`. Việc thử lại bên trong SDK được tính trong một lời gọi SDK. Debug không được lưu vào cache, lịch sử hay bookmark. Các transcript đã lưu từ phiên bản trước được lọc khi đọc qua API.
- Không cần gọi lại AI để mở tab. Nếu chủ động bấm nút chạy mới trên bản dịch cache, đó là một lượt dịch mới theo cơ chế đã có.

Chạy `SHOW_TRANSLATION_DEBUG_FIXTURES=1 node --test tests/translation-debug.test.js` để in trace V1/V2 từ request thực sự được tạo bởi pipeline với provider và dữ liệu giả. Bài V2 kèm Claude Analyzer và GPT Repair.
