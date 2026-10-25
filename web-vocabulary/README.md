# Vocabulary Engine V1.1 — PRO/Admin (draft branch)

## Core behavior

The existing PRO **Từ vựng** switch is the sole collection control, default ON.
- ON: AI1 produces a translation plus words / phrases / grammar patterns; JavaScript reconciles selected items against the user's MongoDB entries and returns rich cards.
- OFF: no AI1 lexical output, no dictionary read/write/counters, no cards. The study library remains available for reading/editing existing entries.
- The former **Tự động thu thập khi dịch** switch inside the study library is removed.
- FREE text translations, Telegram bot and VPS production are not changed. Image translation no longer auto-collects without an explicit vocabulary toggle.

## AI1 fields and cache

AI1 Mandarin and English PRO prompts now request explicitly tagged items, including Vietnamese meanings:
- [WORD] 工资 : tiền lương
- [PHRASE] 一年的工资 : lương của một năm
- [PATTERN] A 不如 B : A không bằng B

The PRO translation cache stores vocabularyVersion=2; legacy cached translations keep the original main translation and upgrade the old lexical portion when required.

## Reconciliation and data safety

The ai-items.js parser uses only the lexical items explicitly provided by AI1 and checks they belong to the source language text. It does not invent new words or store full messages.

The resolver.js module finds existing entries before writing:
1. Use saved MongoDB meanings first, including user-edited values.
2. Check a per-user, per-language SHA-256 fingerprint, valid for five minutes.
3. For a new encounter, use a MongoDB transaction and occurrence ledger to save previously unknown AI1 entries and increment existing counters. The same input within five minutes does not increase counters, even if its translation was cached.
4. Return authoritative MongoDB item information with isNew, encounterCount, saved meaning, pinyin and category. Disabled collection never modifies dictionary data.

If personal dictionary storage fails, the main successful translation is preserved and a secondary vocabularyError is returned.

## AI2 is CATEGORY-ONLY

A separate background worker and category-classifier run on new, unclassified saved items only. Groq FREE is the first provider; OpenRouter FREE is fallback. AI2 outputs only work, daily_life, both or unclassified; it must NOT generate new terms, translations or meanings. DeepL is not used for category classification. No artificial 12-calls-per-day cap is imposed, but providers have their own rate limits. Provider errors or uncertainty leave category unclassified with backoff and retries.

The read-only lookup endpoint supports frontend polling to show category updates without increasing encounter counters.

## UI

Translation detail cards are grouped into Từ vựng / Cụm từ / Mẫu câu. Each card contains a New / Already existed badge (based on DB state *before* this translation), actual encounter count, stored meaning/Pinyin/category and a colored left border:
- 1–2: green; 3–9: blue; 10–29: amber; 30+: purple.
Frequency color is independent of the manual learned/not learned state.

The study library continues using the same data source and supports its previous filters, editing and deletion.

## Legacy modules and QA

The old V1.0 queue and meaning-classifier remain only for historic test/source compatibility; server.js no longer imports them or creates those jobs. The active runtime uses resolver.js, worker.js and category-classifier.js. Existing personal entries remain intact.

Before any merge/deployment:
1. Pull feature/pro-personal-vocabulary-engine on your Mac and run node --test tests/*.test.js.
2. Start the local server with MongoDB Atlas, log in as PRO/Admin.
3. Translate 我一年的工资可能还不如他的起薪。 with Vocabulary ON. Check typed cards, meanings, isNew and counters.
4. Translate the same sentence again within five minutes: counters unchanged.
5. Translate a different sentence with 工资: existing count increases once.
6. Turn Vocabulary OFF: no cards and no storage; study library remains viewable.
7. Edit a meaning in the library and translate again: saved meaning wins.
8. Test English PRO and FREE to detect regression, plus Groq/OpenRouter failures.
9. Check mobile card layout and eventual category update.

Requires MongoDB Atlas/replica set transactions. Do not merge or deploy without localhost QA.
