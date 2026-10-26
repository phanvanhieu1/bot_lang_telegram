# Telegram & Web PRO — Pre-merge Code Audit

**Source:** `feature/telegram-stabilization` (the Mac-tested integration)
**Candidate:** `feature/telegram-premerge-cleanup`
**State:** Code changes pushed for review; **not merged into main or deployed to the VPS**.

## Findings addressed

| Area | Problem observed | Fix |
| --- | --- | --- |
| Telegram cache | Unused JSON text/web/free cache implementation coexisted with authoritative MongoDB cache | Removed obsolete code from `cache.js`; retained offline Telegram MP3 only. Legacy cache_index.json stays on disk. |
| Telegram session | Legacy history, lastVocab, and obsolete automatic voice toggles were initialized despite not being used | Removed initialization and writer code. Old JSON keys are read without migration or data deletion. |
| JSON durability | Direct writes could truncate a live session or whitelist file on process interruption | Write to a temporary file then atomically rename. |
| MongoDB load | Preferences were upserted after almost every command, translation and callback | Insert on first use; subsequently write only when values change, with per-user serialization. |
| Privacy | `/export` and `/exportlocal` could send personal CSV to groups | Export allowed only in private chats. |
| Voice | Unsupported language code could reach Chinese TTS | Respond with a supported-language warning. |
| Legacy command | `/newchat` pretended to clear conversational history, while translation is stateless | Retain a backward-compatible informative response; remove from menu. |
| Mongoose deprecation | Deprecated `new:true` remained in vocabulary resolver/queue/routes | Replaced with `returnDocument:'after'`. |
| Unused UI helpers | Old multi-message formatter and optional inline-vocabulary path were no longer called | Removed; vocabulary remains in its own Telegram message. |
| Tests | Test assertions described deleted functions and previous message layout; `npm test` was a failing placeholder | Updated assertions and made `npm test` run the full test suite. |
| Repository | `modules/history/history.model.js` was an empty placeholder | Deleted that empty file. |

## Validation performed

- JavaScript syntax checks on edited critical modules and regression files.
- 5 premerge mocked checks: MongoDB preference writes, serialized callbacks, atomic session writes, private exports, cache ownership.
- 4 Telegram main menu/settings checks with mocked Telegraf.
- 7 shared-cache/link/vocabulary checks with mocked MongoDB/web translator.
- 9 Telegram translation/action checks with mocked bot modules.
- **No full `npm test` run and no new end-to-end Atlas/ElevenLabs/Telegram run in the audit environment.** The actual Mac tests are mandatory before merging.

## Mandatory before merging

1. **Back up** production `.env`, `database.json`, `whitelist.json`, `vocabulary.json` and PM2 configuration. Never paste secrets into issues or chats.
2. On Mac: `git fetch origin`, switch/track `feature/telegram-premerge-cleanup`, run `npm ci`, `npm test` and `npm run test:telegram`.
3. Run the isolated Telegram test bot; verify `/settings`, `/link`, translation, separate vocabulary message, 💾, 📋, 🔊, `/export`, `/exportlocal`; test repeated/parallel messages.
4. Validate live website: PRO translation, MongoDB shared translation/audio cache, account linking, and vocabulary review.
5. Review the merge base: this branch inherits all outstanding Web PRO, API Monitoring and Telegram commits not yet in `main`. Don't force merge or deploy only a subset of related modules.
6. After a clean local and staging run, merge through a reviewed PR, deploy on VPS with its own configuration and confirm PM2 logs.

## Known follow-up risk not silently changed

The repository **still tracks** sample/legacy `whitelist.json` and `vocabulary.json`. Removing a tracked file in a future pull can delete the working-tree file on a machine that relies on it. This audit therefore **did not delete those data files**. Before untracking them, migrate production data to an external `TELEGRAM_DATA_DIR` and back it up. Adding only a `.gitignore` entry is insufficient for files already tracked by Git.

Do not use `git clean -fdx` or destructive reset commands on the VPS; those could remove private runtime data.
