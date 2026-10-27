# Đồng bộ Telegram ↔ Web PRO qua MongoDB

**Trạng thái:** code đã có trên `feature/telegram-stabilization`. Cần chạy cả web lẫn Telegram với code mới và cùng MongoDB URI để đồng bộ hoạt động. Chưa chạy end-to-end thật bằng Atlas/Telegram credentials.

## 1. Có gì được chia sẻ?

| Dữ liệu | Collection/Module | Ghi chú |
| --- | --- | --- |
| Bản dịch PRO | `web_translation_cache` (`web-cache.js`) | Cùng khóa với web cho câu văn bản độc lập, context `auto`, mode PRO. Ảnh và hội thoại có ngữ cảnh không dùng chung. |
| Âm thanh PRO | `web_audio_cache` (`web-tts.js`) | Cùng model, ngôn ngữ, voice ID, speed. |
| Từ vựng người dùng | `VocabularyEntry` (`web-vocabulary/resolver.js`) | Sau liên kết, 💾 lưu vào tài khoản web thật (PRO/admin). Lọc từ không có trong câu, loại trùng, lịch sử lượt gặp, nghĩa sửa tay. |
| Cài đặt bot | `TelegramPreferences` | Đồng bộ riêng theo Telegram ID, có namespace `test` và `production`; không lẫn cài đặt thử nghiệm. |
| Liên kết tài khoản | `TelegramLinkCode`, `TelegramAccount` | Mã một lần, SHA-256, 10 phút, PRO/admin web. |

Dữ liệu tạm như callback tokens, lịch sử hội thoại và whitelist của Telegram vẫn dùng JSON riêng, để không chuyển toàn bộ dữ liệu chat sang server web hoặc làm hỏng dữ liệu bot cũ. Dữ liệu từ vựng được lưu trong MongoDB khi **người dùng bấm 💾**, không tự động thu thập mỗi lần dịch.

## 2. Cấu hình website

Web dùng `MONGODB_URI` trong `.env` như trước. Chạy code nhánh mới:

```bash
git switch feature/telegram-stabilization
git pull --ff-only origin feature/telegram-stabilization
npm ci
npm start
```

Trang liên kết: **`http://localhost:3000/telegram/connect`** khi chạy local (đăng nhập bằng tài khoản PRO hoặc admin).

Không cần thay đổi Google login, mật khẩu hay session.

## 3. Cấu hình bot TEST trên Mac

Bot test **không** tự động dùng Mongo URI production. Trong file local `.env.telegram-test`, ngoài token và admin ID test, thêm:

```dotenv
TELEGRAM_TEST_MONGODB_URI=mongodb+srv://<USER>:<PASSWORD>@<HOST>/<DATABASE>?retryWrites=true&w=majority
```

Quan trọng: URI phải trỏ đúng **cùng database MongoDB** mà web đang sử dụng (bao gồm tên database). Biến này chủ động cho phép bot test đọc/ghi dữ liệu web thật. Không bao giờ commit file này hoặc gửi credentials lên chat.

Khởi động lại:

```bash
npm run test:telegram
npm run bot:test
```

Nếu kết nối thất bại, MongoDB Atlas IP allowlist, mạng hoặc URI có thể là nguyên nhân. Test bot có thể chạy menu không cần Mongo, nhưng tính năng liên kết/lưu/chia sẻ cache sẽ không hoạt động.

## 4. Liên kết tài khoản

1. Đăng nhập website bằng **tài khoản PRO/admin** của bạn.
2. Mở `/telegram/connect` (có liên kết trong menu tài khoản).
3. Bấm **Tạo mã liên kết (10 phút)**.
4. Copy lệnh `/link <mã 24 ký tự>`; gửi trong **private chat** với bot TEST.
5. Bot báo liên kết thành công. Giờ mỗi lần bấm 💾, từ vựng được lưu qua `resolveTranslationVocabulary` vào kho học tập web.
6. Mở website và vào kho Từ vựng, kiểm tra mục vừa lưu. Trang liên kết còn hỗ trợ **Ngắt liên kết**, không xóa từ vựng.

Lưu ý: tài khoản PRO/admin phải còn hiệu lực; một tài khoản web chỉ liên kết một Telegram ID và ngược lại. Bot TEST và bot production có thể dùng cùng Telegram ID nếu bạn cố ý cấu hình, nhưng không cần thay đổi bot production trên VPS để test.

## 5. Giao diện và lệnh Telegram

Khi bật Từ vựng, tin nhắn chính gọn ba dòng và **một tin nhắn riêng** chứa WORD / PHRASE / PATTERN:

```
📖 你好，今天忙不忙？
🔤 nǐ hǎo, jīn tiān máng bu máng?
🔁 Xin chào, hôm nay có bận không?
[📋] [💾] [🔊]

📝 Từ vựng:
- [WORD] 你好: xin chào
...
```

- `/link`: kiểm tra liên kết hoặc hướng dẫn lấy mã. `/link <mã>`: liên kết.
- `/export`: xuất kho từ vựng MongoDB đã liên kết (tối đa 5.000 mục mỗi file).
- `/exportlocal`: xuất dữ liệu từ file `vocabulary.json` cũ, không thay đổi MongoDB.
- `/clearvocab`: không xóa kho chung; chỉ có thể xóa mục từ vựng trên giao diện website.

Nút 💾 không tự đánh dấu thành công khi chưa liên kết, chưa có MongoDB hoặc không có mục hợp lệ.

## 6. Bảo toàn cache Web PRO

Web PRO chỉ tạo BACK_TRANSLATION theo hướng Việt → Trung. Telegram yêu cầu cả hai chiều:
- Việt → Trung: dùng `backTranslation` chung với web.
- Trung → Việt: dùng trường `telegramBackTranslation` trong cùng `WebTranslationCache`, tránh ảnh hưởng cách web hiển thị.

Nếu cache có bản dịch chính nhưng thiếu phần phụ, bot bổ sung phần thiếu bằng prompt chung. Bản dịch chính đã cache không bị ghi đè.

Đối với MP3, cả web và Telegram dùng `web_audio_cache` khi MongoDB hoạt động. Nếu không kết nối database, bot vẫn có file cache audio riêng để thử tính năng cơ bản.

## 7. Kiểm thử cần làm

```bash
npm run test:telegram
node --test tests/*.test.js
```

Kiểm tra thực tế web PRO & bot:
1. Dịch `今天下班了` trên web, sau đó gửi cùng câu trên Telegram. Quan sát cache hit và số lượt gọi API.
2. Bật từ vựng trên bot, xác nhận hai tin nhắn và nút 💾 dưới bản dịch chính.
3. Liên kết tài khoản, nhấn 💾, kiểm tra mục mới trong kho học tập web.
4. Thử nhấn 💾 lần hai, thử lại cùng câu trong 5 phút, và thử `/export`.
5. Phát 🔊 trên web trước, sau đó Telegram cùng câu và giọng/tốc độ; kiểm tra dùng lại MP3.
6. Thử ngắt liên kết; bot không được ghi thêm từ vào tài khoản web.
7. Kiểm tra bot VPS production vẫn không thay đổi.

**Không có migration tự động** từ từ vựng JSON cũ sang MongoDB vì thiếu ngữ cảnh gốc để xác minh một số từ. Xuất bằng `/exportlocal` trước khi chuyển hẳn.
