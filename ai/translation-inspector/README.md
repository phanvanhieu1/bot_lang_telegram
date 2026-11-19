# Translation Inspector

Các route dịch văn bản web đang hoạt động trả `processingSummary` và `traceId`. Summary mô tả lượt dịch hiện tại. Inspector chỉ gọi `GET /api/translation-inspector/:id` khi bấm **Xem JSON**. Endpoint đọc lại bản ghi đã thu trong lượt dịch, không gọi AI, chạy Resolver hay đọc lại hồ sơ.

Trace thuộc chủ tài khoản, được giữ trong RAM của tiến trình tối đa 5 phút, với giới hạn 160 KiB mỗi trace, 4 MiB tổng cộng và 200 lượt. Khởi động lại, đổi tiến trình hoặc vượt dung lượng có thể làm trace hết khả dụng sớm. Response dùng `private, no-store`. Quyền admin được xác minh lại khi tải. Raw provider chỉ được ghi nếu admin bật tùy chọn khi dịch. Cache, lịch sử và bookmark không lưu trace.
