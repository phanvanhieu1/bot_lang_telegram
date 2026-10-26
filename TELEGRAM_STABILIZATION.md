# Telegram Bot — Stabilization Branch

Branch: `feature/telegram-stabilization` (based on `feature/shared-api-monitoring`).

## Compact translation controls (new)

- Only the primary TRANSLATION field is copied or spoken; BACK_TRANSLATION, VOCABULARY and PRONUNCIATION are separate display sections.
- New translation messages have one horizontal icon row: 📋 Copy (up to 256 characters), 💾 Save vocabulary (when available), and 🔊 Generate speech.
- No automatic voice on each translation; the "Giọng đọc AI BẬT/TẮT" setting has been removed. Tap 🔊 to speak the specific saved sentence with the currently selected voice/speed.
- Save vocabulary preserves the Copy and Speaker buttons. Speech requests are guarded against duplicate rapid taps and cached by sentence/voice/speed.
- The existing Bản dịch / Phiên âm / Từ vựng display controls remain; previously generated Telegram messages need a fresh translation to show the new buttons.

## Copy button and web PRO voice parity

- Replaced unavailable `Markup.button.copyText()` with the Telegram Bot API's raw `copy_text: { text }` inline button payload; results longer than 256 characters do not show a Copy button.
- Telegram now offers the same four ElevenLabs voices as web PRO: female 1 (`ByhETIclHirOlWnWKhHc`), male 1 (`D9bZgM9Er0PhIxuW9Jqa`), male 2 (`2I36mEahS1u7ZnTKUoaB`), and female 2 (`BqljjWyTnrioXPCNkCd4`).
- Older Telegram voice choices automatically migrate to female 1. Fresh sessions default to female 1.
- Speech uses the same default ElevenLabs model `eleven_flash_v2_5` and MP3 output as the PRO web TTS. No web source changes.
- The test bot still needs an explicitly configured `TELEGRAM_TEST_ELEVENLABS_API_KEY` to make live speech requests; selecting voices in `/settings` does not by itself consume credits.

## Fixed in this branch

- Translation content is sent as plain text in bounded chunks, avoiding broken Markdown and 4096-character sendMessage failures.
- Copy buttons are only generated when the translated text fits the Telegram 256-character limit. Longer content remains visible in the message.
- Per-message vocabulary snapshot tokens: pressing Save on an earlier translation no longer saves the latest translation's vocabulary. Old `save_vocab` buttons ask the user to translate again rather than silently saving incorrect data.
- `/export` now generates UTF-8 CSV with real Front/Back columns and escaped values for Anki import.
- A `/clearcache` command for the master admin removes only cached voice files. This does not delete the shared website's translation cache.
- Voice downloads have a 20-MB cap and use unique temporary directories, removed whether Whisper succeeds or fails.
- OpenAI translation and Whisper failover now shuffle *distinct* configured keys and never log their prefixes.
- ElevenLabs MP3 is sent with a matching file name.
- Speech synthesis failure does not hide a successful text translation.
- Settings callbacks reject invalid choices. Speed selection labels handle both `1` and `1.0`.
- `/newchat` resets recent conversation history for a clean translation.
- User settings from older `database.json` files receive missing defaults.
- Exceptions are handled centrally; rate-limit errors no longer claim this bot uses Gemini.
- The bot starts polling only when running `node bot.js`, not when imported as a module.

## Local tests

```bash
git fetch origin
git switch -c feature/telegram-stabilization --track origin/feature/telegram-stabilization
npm ci
node --test tests/telegram-stability.test.js tests/telegram-voice.test.js
node --test tests/*.test.js
```

The tests are offline, and do not require Telegram or paid API calls.

## Test with Telegram

**Do not start two polling processes using the same Telegram token.**
If the bot is already running under PM2 on a VPS, either stop that process temporarily before local polling, or configure a separate test bot token locally.

Required variables in the local `.env`:

- `TELEGRAM_BOT_TOKEN` — test bot token for local testing
- `MASTER_ADMIN` — Telegram numeric admin id
- `OPENAI_API_KEYS` — comma-separated OpenAI keys (for translating/transcribing)
- `ELEVENLABS_API_KEY` — optional if voice synthesis is disabled

Run `node bot.js` to start the Telegram bot. `npm start` starts the web server, not the Telegram bot.

Manual regression flow:

1. Send `/settings`; change language, speed, voice and display flags.
2. Send a Chinese phrase containing `_`, `*` and `[`; confirm the translation replies.
3. Translate two different phrases with vocabulary enabled. Press **Save** on the first response, then `/export`. Verify the exported item belongs to the first response.
4. Send a long paragraph; confirm it is split without errors. For translations >256 characters, the Copy button is intentionally absent.
5. Send a voice memo; check that transcription and text translation work. Test a Whisper failure and confirm the temporary recording is deleted.
6. Enable voice synthesis and verify MP3 voice playback. Simulate a TTS outage and confirm text results still appear.
7. Try `/newchat` to reset the dialog. As admin, `/clearcache` should remove cached audio only.

Only after testing should you deploy the code to your VPS. Use `pm2 list` to find the actual bot process name, then `pm2 restart <bot-process-name>`. Do not replace `.env`, `database.json`, `whitelist.json`, or `vocabulary.json` with repository examples.

## Not yet validated

Live end-to-end Telegram polling, Whisper, OpenAI and ElevenLabs responses have not been exercised with your credentials. Full regression suite and production PM2 restart must be run in your environment.
