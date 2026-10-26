# Telegram persistent main menu — V1

The translation bot now exposes a **Reply Keyboard** below the Telegram input field.
It coexists with the compact **Inline Keyboard** beneath each translated message.

## Main menu

```
[ 📖 Dịch thuật (success) ] [ 📚 Từ vựng (primary) ]
[ 🔊 Giọng đọc ] [ 📝 Luyện tập ] [ ⚙️ Cài đặt ]
[ 📊 Thống kê (primary) ]
```

- **📖 Dịch thuật**: prompts you to send text, a screenshot or voice to translate.
- **🔊 Giọng đọc**: opens the existing voice selection (Mandarin PRO voices). The 🔊 button underneath an individual translation **still generates audio** for that particular translation.
- **⚙️ Cài đặt**: opens the existing inline settings panel (language, Chinese voice, speaking speed and vocabulary analysis).
- **📚 Từ vựng, 📝 Luyện tập, 📊 Thống kê**: placeholders; each shows a descriptive message, no database operations or unfinished features. Existing 💾 /export /clearvocab commands continue working.

Reply keyboard colors are standard Telegram Bot API `style`: `success`, `danger`, `primary`. App versions/themes determine whether they are displayed exactly like the example screenshot. The keyboard is persistent, resizable and not one-time.

## Settings fixes

- `toggle_vocab` is the only active display-toggle callback. Legacy `toggle_trans` and `toggle_pron` buttons no longer modify session state.
- Callback data for setting voice, language and speed has a strict full-string match.
- Settings opening from the reply keyboard now sends a fresh editable inline panel. When a previously shown panel is too old to edit, the bot sends a new panel rather than silently failing.
- When vocabulary analysis is toggled, text-cache keys include its state; reusing a translation cannot silently reuse the wrong set of vocabulary fields.
- The six reply keyboard labels are handled before the generic text translator and additionally ignored by its fallback.

## Mac test bot

```bash
git switch feature/telegram-stabilization
git pull --ff-only origin feature/telegram-stabilization
npm ci
npm run test:telegram
npm run bot:test
```

After restart, issue `/start` or `/menu` to attach the persistent keyboard.
Confirm that:
1. Each reply keyboard item performs its corresponding navigation/placeholder function.
2. In ⚙️ Cài đặt, choose language, each of four voices and each speed, then revisit the menu; selected markers should persist.
3. In the display options, toggle vocabulary once and ensure BẬT/TẮT updates correctly. Translation/Pinyin/back translation remain visible.
4. Translate a sentence and check that 📋 💾 🔊 under that message still work.
5. The local test bot continues to use its own token and data folder; no need to stop the VPS production bot.

The above automated tests use mocks; **real Telegram client display must still be verified**. Test bot credentials remain local in `.env.telegram-test`.
