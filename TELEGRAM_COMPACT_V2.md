# Telegram compact translation and Vietnamese voice update

This update keeps the bot test account isolated from the production VPS bot.

## Telegram output (new messages)

Each translated result is shown as a single compact message:

```
📖 今晚喝点什么吗，兄弟？
🔤 jīn wǎn hē diǎn shén me ma，xiōng dì？
🔁 Tối nay uống chút gì không, anh em?
```

Directly below it appears one action row: 📋 Copy, 💾 Save vocabulary (when generated), 🔊 Generate audio.

- Copy and 🔊 use **only** the main TRANSLATION, never Pinyin/back translation/vocabulary.
- Mandarin Pinyin is calculated locally using pinyin-pro. For Chinese input use the original Chinese sentence; for Vietnamese input use the Chinese translation.
- Vietnamese -> Chinese and Chinese -> Vietnamese both request a BACK_TRANSLATION from AI.
- When vocabulary is ON, the analyzed WORD/PHRASE/PATTERN lines appear below the three main fields inside the same Telegram message (unless Telegram's message-length limit requires splitting). Tapping 💾 saves the analyzed lines to `vocabulary.json` under the running bot's data directory.
- Telegram test bot: `.telegram-test-data/vocabulary.json`. Production bot: repository-local `vocabulary.json`. These vocabularies are **not synchronized** to the MongoDB PRO web vocabulary engine.
- `/export` creates an Anki-compatible CSV of saved vocabulary; `/clearvocab` clears the current Telegram user's saved vocabulary. Saving avoids duplicate identical lines.
- Long translations may still be split to satisfy Telegram's 4096-character message limit.

## ElevenLabs voices

Chinese speech: any of the four PRO web voices selected in Telegram settings.

Vietnamese speech: fixed ElevenLabs voice `CQAD6iKxS73fEAGjSwt5`, in BOTH Telegram and web PRO.

- Telegram speaker callbacks remember which language is being spoken and operate on the sentence from the original translated message.
- The web uses authenticated `POST /api/tts/vietnamese` with server-side PRO permissions, input/length validation and a 30-day MongoDB audio cache. Non-PRO users can continue using browser Vietnamese speech if available.
- Both web and Telegram now use the shared `tts-shared.js` request contract. Vietnamese TTS explicitly sends `language_code: 'vi'` using `eleven_flash_v2_5`, even if a different default model is configured. Speech cache keys distinguish language, actual voice ID and model to avoid replaying old incorrectly pronounced audio.
- The Chinese endpoint and all four Chinese voice selections remain unchanged.
- Voice ID does not prove the external provider currently allows the account to use it: a live test with the configured ElevenLabs API key is still necessary.

## Test on Mac

```bash
git switch feature/telegram-stabilization
git pull --ff-only origin feature/telegram-stabilization
npm ci
npm run test:telegram
npm run bot:test
```

Restart the Mac test bot after pulling. The existing VPS bot should remain unchanged.
In `.env.telegram-test`, provide the test token/admin and optional development OpenAI/ElevenLabs keys. Never share tokens in chat.

Try both:
- Vietnamese: `Tối nay uống chút gì không anh em?`
- Mandarin: `今晚喝点什么吗，兄弟？`

Both should return one three-line message. For Chinese output 🔊 uses the chosen Mandarin voice; for Vietnamese output 🔊 uses the new fixed Vietnamese voice.

The new `tests/telegram-compact-vi.test.js` covers compact formatting, source/target Pinyin, Telegram prompt isolation and Vietnamese TTS mapping without making paid calls.
