# Vocabulary Engine V1 — PRO/Admin

Kho từ vựng, cụm từ và mẫu câu **riêng từng tài khoản**. Mặc định **tắt**, người dùng PRO/Admin phải bật "Tự động thu thập khi dịch" trong **Kho học tập**.

## Luồng xử lý

1. Website dịch văn bản (Trung/Anh) hoặc ảnh hội thoại như trước, không đợi engine từ điển.
2. Server kiểm tra preference `VocabularySetting`. Nếu bật, `extractor.js` dùng `Intl.Segmenter`, từ điển cục bộ (`rules.js`) và mẫu ngữ pháp để nhận diện từ/cụm/cấu trúc. Nếu AI dịch PRO đã cung cấp `VOCABULARY`, tận dụng nghĩa sẵn có sau khi kiểm tra từ có trong văn bản nguồn ngoại ngữ.
3. Chỉ lưu **ứng viên đã qua lọc** vào `VocabularyJob`, không lưu toàn bộ nội dung chat hoặc ảnh trong engine.
4. Worker nhận tối đa 6 job cùng user/ngôn ngữ một lần; tra `VocabularyEntry`, bỏ từ bị xóa (`VocabularyMuted`), bỏ những từ đã biết.
5. Nếu có mục mới chưa được code phân loại, gửi **tối đa 16 mục trong một lần** đến `gpt-4o-mini` (không gửi full chat). Mỗi user có giới hạn **12 lời gọi AI2/ngày UTC**; vượt hạn mức thì hoãn job sang hôm sau.
6. MongoDB transaction ghi `VocabularyOccurrence` (chống đếm trùng) và cập nhật `VocabularyEntry` (`$inc` lượt gặp/lần xuất hiện), sau đó đánh dấu job hoàn thành. Các mục chưa phân tích được có thể chỉnh sửa tay; lỗi AI được thử lại có giới hạn.

## Collection cá nhân

- `VocabularySetting`: bật/tắt theo user, mặc định false.
- `VocabularyEntry`: userId + language + type + normalized key (unique), nghĩa, Pinyin, chủ đề, đếm lượt gặp, học thuộc.
- `VocabularyJob`: hàng đợi bền vững, chỉ chứa ứng viên, job đã xử lý tự hết hạn.
- `VocabularyOccurrence`: ledger có unique index, TTL 60 ngày, chống đếm trùng khi retry.
- `VocabularyMuted`: từ người dùng đã xóa sẽ không tự tạo lại.
- `VocabularyAiQuota`: số lần gọi bộ phân loại AI2/ngày, tự hết hạn.

Tất cả API `/api/vocabulary` dùng `requireRole('pro','admin')`; PRO hết hạn không truy cập được nhưng dữ liệu giữ nguyên. Không sử dụng dữ liệu của user khác.

## API

- `GET /api/vocabulary/settings`, `PUT /api/vocabulary/settings` (`{enabled:true|false}`).
- `GET /api/vocabulary?language=zh|en&category=all|work|daily_life&sort=frequent|recent&... `.
- `GET /api/vocabulary/stats?language=zh|en`.
- `PATCH /api/vocabulary/:id` để sửa nghĩa/chủ đề/mức độ học.
- `DELETE /api/vocabulary/:id` xóa khỏi thư viện và không tự lưu lại mục đó.

## Kiểm thử cục bộ

```bash
npm install
node --test tests/vocabulary-engine.test.js
npm run dev
```

Đăng nhập PRO/Admin, mở **Kho học tập**, bật tự động thu thập; dịch ví dụ:
- `麻烦你确认一下，这个问题解决了吗？`
- `下班以后，我去超市买菜。`
- `Please confirm the payment. Let me check.`

Chờ khoảng 35–60 giây để worker xử lý, mở lại Kho học tập và kiểm tra: từ, chủ đề, đếm, tìm kiếm, thay đổi nghĩa, xóa và lọc. Thử dịch lại một câu để kiểm tra bộ đếm tăng thay vì tạo từ trùng.

Chú ý: tính năng xác định ngôn ngữ ở phiên bản này dùng luồng ngôn ngữ đang chọn của website. Với văn bản đa ngôn ngữ hoặc cực ngắn, một số mục có thể chờ xử lý/chỉnh sửa. Phân tích AI2 là hỗ trợ từ điển, không bảo đảm mọi thuật ngữ kỹ thuật đều chính xác.

### Quyền riêng tư

Không gửi chat/ảnh nguyên gốc đến AI2; chỉ gửi các ứng viên từ vựng đã được kiểm tra và loại bớt URL, email, số và mã nhận dạng. Việc loại bỏ thông tin nhạy cảm dựa trên quy tắc **không tuyệt đối**; người dùng nên tránh bật chế độ thu thập khi dịch các bí mật nội bộ. Dịch thuật chính vẫn sử dụng các dịch vụ hiện có của website.

### Vận hành

Worker chạy cùng tiến trình `translator-web` và chỉ khởi động sau MongoDB. Ghi nhận tần suất chính xác khi retry sử dụng **MongoDB transactions**, vì vậy MongoDB phải là replica set / Atlas. Không dùng Redis và không thay đổi file Telegram bot.

**Không merge vào main hoặc triển khai VPS trước khi kiểm thử localhost.**
