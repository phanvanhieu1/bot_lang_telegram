# Telegram Test Bot (không ảnh hưởng bot VPS)

Telegram chỉ tạo tài khoản bot thông qua **@BotFather**. Source code này đã có launcher riêng:
`bot-test.js`. Bot production vẫn chạy bình thường trên VPS bằng token cũ.

## 1. Tạo bot riêng trên Telegram

1. Mở https://t.me/BotFather và gửi `/newbot`.
2. Tên gợi ý: `Language Translator TEST`.
3. Username gợi ý: `language_translator_hi_test_bot` (nếu chưa có người dùng; phải kết thúc bằng `bot`).
4. Copy **token mới** vào file riêng ở máy của bạn. **Không gửi token qua chat và không push lên GitHub.**
5. Telegram user ID admin của bạn là số trong biến `MASTER_ADMIN` của bot cũ. Chỉ copy ID, không copy production bot token.

## 2. Lấy code về Mac

```bash
git fetch origin
git switch feature/telegram-stabilization
git pull --ff-only
npm ci
cp .env.telegram-test.example .env.telegram-test
```

Nếu bạn chưa có nhánh local, thay lệnh `git switch` bằng:

```bash
git switch -c feature/telegram-stabilization --track origin/feature/telegram-stabilization
```

Chỉnh file `.env.telegram-test` ở máy local:

```dotenv
TELEGRAM_TEST_BOT_TOKEN=<TOKEN_MỚI_TỪ_BOTFATHER>
TELEGRAM_TEST_MASTER_ADMIN=<TELEGRAM_USER_ID_CỦA_BẠN>
TELEGRAM_TEST_OPENAI_API_KEYS=
TELEGRAM_TEST_ELEVENLABS_API_KEY=
```

Các dòng API key cho phiên bản TEST có thể để trống để kiểm tra menu trước; khi test dịch/Whisper hãy cung cấp một API key thử nghiệm và khi test TTS hãy cung cấp key ElevenLabs thử nghiệm. Các API key này sẽ có thể phát sinh phí/hạn mức từ chính tài khoản nhà cung cấp đã chọn.

## 3. Chạy

```bash
npm run bot:test
```

Mở bot mới trong Telegram, chọn Start và gửi `/settings` để kiểm tra menu.

Sau khi dịch một câu mới, dưới kết quả sẽ xuất hiện các biểu tượng trên một hàng: **📋 Copy bản dịch chính**, **💾 lưu từ vựng** (nếu có), **🔊 tạo âm thanh khi bấm**. Nút Giọng đọc AI bật/tắt trong menu đã được bỏ. Muốn nghe thử, hãy cấu hình `TELEGRAM_TEST_ELEVENLABS_API_KEY`. Tin nhắn cũ sẽ không tự có nút mới.
Cần test dịch thì điền `TELEGRAM_TEST_OPENAI_API_KEYS` ở trên rồi khởi động lại.

Dừng bot local bằng `Ctrl+C`. Không cần stop/restart PM2 trên VPS.

## 4. Cách thức cô lập

- TEST bắt buộc có `TELEGRAM_TEST_BOT_TOKEN` riêng; nếu trùng `TELEGRAM_BOT_TOKEN` trong `.env`, tiến trình từ chối khởi động.
- TEST chỉ cho phép admin do `TELEGRAM_TEST_MASTER_ADMIN` cấu hình và whitelist riêng.
- TEST lưu lịch sử, whitelist, từ vựng, cache vào `.telegram-test-data/`, không chạm các file production.
- TEST không tự tái sử dụng OpenAI và ElevenLabs key từ `.env`; phải cấp các key đó rõ ràng bằng biến môi trường TEST.
- TEST không ghi sự kiện OpenAI vào hệ thống API Monitoring production.
- `.env.telegram-test` và thư mục dữ liệu TEST được .gitignore bảo vệ.
- Đăng nhập bot riêng bằng token mới **không xung đột** bot production đang polling trên VPS.

**Lưu ý:** ChatGPT không có quyền truy cập BotFather của bạn để đăng ký tài khoản bot hoặc lấy token. Chỉ cần tạo bot bằng `/newbot` rồi điền token ở file local; toàn bộ code test đã sẵn sàng.

## 5. Kiểm thử offline

```bash
npm run test:telegram
npm run test:all
```

Ghi chú: `npm start` là web server, `npm run bot:test` mới là bot Telegram test.
