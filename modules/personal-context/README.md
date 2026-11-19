# Hồ sơ dịch thuật và phiên hội thoại

Trang `/personal` dùng xác thực Google/session và middleware `requireAuth` hiện có. Tài khoản cũ có trạng thái `pending` cho đến khi lưu thiết lập. Nghề nghiệp và chủ đề đã chọn được gửi tới OpenAI để sinh context. Văn phong, cách xưng hô và ngôn ngữ ưu tiên được lưu làm metadata.

Trang dịch kiểm tra hồ sơ sau khi xác thực. Modal tự mở cho hồ sơ `pending` hoặc `skipped` từ phiên bản trước. Nút Bỏ qua lưu trạng thái nhắc trong phiên đăng nhập hiện tại. Người dùng có thể mở lại từ **Cài đặt → Hồ sơ dịch thuật** và chọn **Quản lý ngữ cảnh** để xem các context đã sinh.

## MongoDB

- `userprofiles` dùng chỉ mục duy nhất trên `userId`. Một document lưu metadata và tối đa 60 context, trong đó tối đa 12 chủ đề đang chọn. Mỗi context có UUID, `version` của nội dung/trạng thái và `generationVersion` của các lần sinh. ID chủ đề được chuẩn hóa ổn định theo tên.
- Cập nhật hồ sơ và context ghi nguyên tử theo `userId` và `revision`. Một yêu cầu cũ nhận HTTP 409. Khi đổi chủ đề, context giữ nguyên nội dung và ID nếu không bị ảnh hưởng, được vô hiệu hóa khi bỏ chọn, và được khôi phục khi chọn lại. Các mục đã tắt thủ công giữ trạng thái tắt. Đổi nghề nghiệp chỉ sinh lại context theo chủ đề còn được chọn, đang bật và chưa chỉnh tay. Xóa một context được quản lý cũng bỏ chọn chủ đề tương ứng.
- `conversationsessions` có chỉ mục tra cứu theo chủ sở hữu, kênh và ngày bắt đầu, chỉ mục duy nhất từng phần cho phiên đang mở theo chủ sở hữu và kênh, cùng chỉ mục TTL. Mỗi phiên giữ tối đa 100 lượt trong 30 ngày kể từ khi mở hoặc từ lượt lưu gần nhất. Thứ tự là thứ tự ghi vào MongoDB. Mỗi lượt chỉ có nguồn, bản dịch, ngôn ngữ, thời gian, số thứ tự và cờ rút gọn. Giới hạn 8.000 ký tự cho mỗi trường văn bản. Ký hiệu `und` thể hiện chiều dịch Telegram chưa thể xác định chắc chắn từ văn bản.
- Lịch sử dịch và bookmark hiện có vẫn được sử dụng cho xem lại bản dịch. Snapshot hội thoại chỉ được tạo khi mở phiên, có thể hết hạn hoặc bị xóa độc lập với lịch sử dịch. Snapshot không chứa inspector, prompt, khóa API hoặc thông tin xác thực.
- Web lưu các lượt dịch văn bản FREE/V1/V2 có header `X-Conversation-Session`. Phản hồi có `X-Conversation-Turn: saved` hoặc `not-saved` khi đã yêu cầu ghi. Telegram lưu tin nhắn văn bản và bản chép lời trong chat riêng đã liên kết tài khoản PRO/admin qua flow hiện có. Dịch ảnh giữ nguyên chính sách hiện tại.

## API web

Tất cả các đường dẫn dưới đây có tiền tố `/api/personal`. Chủ sở hữu lấy từ phiên đăng nhập. Các thao tác ghi hồ sơ/context nhận `revision` trong JSON body.

| Phương thức      | Đường dẫn                  | Tác dụng                                                                                               |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET, PUT         | `/profile`                 | Đọc hoặc lưu hồ sơ và đồng bộ context. PUT hỗ trợ `skip: true`.                                        |
| POST             | `/profile/dismiss`         | Ẩn lời nhắc thiết lập trong phiên đăng nhập hiện tại.                                                  |
| GET, POST        | `/contexts`                | Liệt kê hoặc thêm context thủ công.                                                                    |
| GET, PUT, DELETE | `/contexts/:id`            | Đọc, sửa hoặc xóa context.                                                                             |
| PATCH            | `/contexts/:id/status`     | Đặt `status` thành `active` hoặc `inactive`.                                                           |
| POST             | `/contexts/:id/regenerate` | Sinh lại riêng một context. Nội dung tự tạo/chỉnh sửa chỉ được thay thế khi gửi `replaceCustom: true`. |
| GET, POST        | `/conversations`           | Liệt kê tối đa 50 phiên web mới nhất hoặc mở phiên web mới.                                            |
| GET, DELETE      | `/conversations/:id`       | Đọc 1–3 lượt gần nhất với `?limit=` hoặc xóa phiên.                                                    |
| POST             | `/conversations/:id/end`   | Kết thúc phiên web đang mở.                                                                            |

Telegram có `/conversation`, `/endconversation`, `/conversations`, `/recentconversation [mã phiên]` và `/clearconversation <mã phiên>`. Các lệnh dùng dữ liệu riêng của kênh Telegram.

## Điểm tích hợp cho Context Resolver

- `service.js` cung cấp `getActiveContexts(userId)`, `getUserMetadata(userId)` và `getContextById(userId, contextId)`.
- `conversations.js` cung cấp `getConversationContext(userId, sessionId, limit = 3, channel)`. Kết quả chứa metadata phiên và các lượt theo thứ tự tăng dần.

Generator chạy khi đồng bộ chủ đề hoặc khi được yêu cầu sinh lại. Nó tái sử dụng OpenAI provider và Structured Outputs, xác thực kết quả ở backend, dùng mẫu riêng cho từng chủ đề khi lỗi và không tạo glossary. Các hàm truy xuất ở trên chưa được gọi từ pipeline dịch.

## Kiểm thử

Chạy `npm test` để chạy kiểm thử thông thường. Để chạy cả bài tích hợp lưu trữ, đặt `PERSONAL_CONTEXT_TEST_MONGO=mongodb://127.0.0.1:<port>` trỏ tới MongoDB kiểm thử. Bài test tự tạo và xóa một database có tên ngẫu nhiên. AI, phiên đăng nhập đầu vào và kết quả dịch được mô phỏng, còn HTTP middleware, Mongoose và các chỉ mục dùng thật.
