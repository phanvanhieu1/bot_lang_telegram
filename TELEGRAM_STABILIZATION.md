# Telegram Bot — Stabilization Branch

Branch: `feature/telegram-stabilization` (based on `feature/shared-api-monitoring`).

## Fixed in this branch

- Translation content is sent as plain text in bounded chunks, avoiding broken Markdown and 4096-character sendMessage failures.
- Copy buttons are only generated when the translated text fits the Telegram 256-character limit. Longer content remains visible in the message.
- Per-message vocabulary snapshot tokens: pressing Save on an earlier translation no longer saves the latest translation's vocabulary. Old `save_vocab` buttons ask the user to translate again rather than silently saving incorrect data.
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
node --test tests/telegram-stability.test.js
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
