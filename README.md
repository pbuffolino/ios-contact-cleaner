# 📇 iOS Contact Cleaner

**De-dupe, merge, and tidy your iPhone contacts — 100% in your browser. Nothing is ever uploaded.**

[![Status: prototype](https://img.shields.io/badge/status-prototype%20%C2%B7%20untested-red.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime dependencies: 0](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)](#under-the-hood)
[![Works offline](https://img.shields.io/badge/works-offline-success.svg)](#privacy)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-orange.svg)](#contributing)

> ⚠️ **Prototype, untested.** This is an early prototype and has not been tested
> end to end. Treat it as experimental. Do not rely on it as the only copy of your
> contacts. Always keep your original export (or the in-app backup) until you have
> checked the result yourself.

A tiny, open-source web app that cleans up a vCard (`.vcf`) export from your iPhone: it finds and merges duplicate contacts, tidies up names and spacing, and hands you a cleaned `.vcf` to import back. Everything happens locally on your device — there's **no server, no account, and no network request with your data**. You can verify that yourself: open your browser's DevTools and watch the Network tab stay empty after the page loads, or just read the code.

### 👉 [**Open the app**](https://pbuffolino.github.io/ios-contact-cleaner/)

---

## Why does this exist?

Phone contact lists rot over time: the same person shows up three times, names are `IN ALL CAPS`, numbers are stored in five different formats. The usual "fix it" tools want you to hand over your entire address book to a cloud service — which, for your most personal data, is a lot to ask.

This tool takes the opposite approach. Your contacts never leave your phone. The catch is that browsers **can't** read iOS contacts directly (the web Contact Picker API is hidden behind an experimental flag in iOS Safari and off by default), so the workflow is: export a vCard → clean it here → import it back. A little more manual, but completely private.

## Features

- 🔒 **100% on-device** — your contacts are read and processed in memory; nothing is uploaded, ever.
- 🧹 **Smart de-duplication** — automatically merges obvious duplicates (same phone or email + matching name) and asks you about the ambiguous ones.
- 🔀 **Lossless merging** — combines all phones, emails, and addresses, keeps the most complete details, and preserves fields it doesn't recognize.
- ✨ **Formatting fixes** — fixes `ALL CAPS` / `all lowercase` names, trims stray spaces, and tidies phone spacing. Every fix is optional and previewed.
- 🔍 **Dry-run preview** — a "here's exactly what would happen" screen shows every merge and fix **before** anything is produced.
- 💾 **One-tap backup** — save your original contacts untouched before you change anything.
- 📲 **Installable & offline** — add it to your home screen and it works with no connection.

## How to use it

### 1. Export your contacts as a `.vcf`

**On your iPhone (no computer needed):**

1. Open the **Contacts** app and tap **Lists** (top-left).
2. Press and hold **All Contacts**, then tap **Export**.
3. Choose **Select All Fields** (this keeps photos, notes, and birthdays).
4. **Save to Files**.

**Or on any computer:** sign in at **iCloud.com → Contacts**, click the gear icon → **Select All** → **Export vCard**.

### 2. Clean them

Open the app and choose your `.vcf`. It will offer a **backup** of your original file, then walk you through:

- **Auto-merged duplicates** — already combined for you (you'll see exactly which).
- **Possible duplicates** — you confirm each one and pick the name to keep.
- **Formatting fixes** — toggle any you don't want.
- **Preview** — review everything that's about to change, then create your cleaned `contacts-cleaned.vcf`.

### 3. Import the cleaned file back

> ⚠️ **Importing _adds_ contacts — it doesn't replace them.** If you import on top of your existing contacts, you'll just recreate the duplicates.

To fully replace your contacts:

1. Delete the old ones first — easiest at **iCloud.com → Contacts → Select All → Delete**.
2. Open the downloaded `.vcf` (from the Files app, or iCloud.com → Import vCard).
3. Confirm **Add All Contacts**.

Keep your original export (or the in-app **backup**) until you're happy with the result.

## Privacy

- **No uploads.** Your file is read with the browser's `FileReader` and processed entirely in memory.
- **No network.** The only things fetched are the app's own HTML/CSS/JS and icons. After load, the Network tab stays empty — check it yourself.
- **No tracking, no analytics, no cookies, no third-party scripts.**
- **Works offline** once loaded, and installs to your home screen as a PWA.

## FAQ

**Is my data safe?**
Yes — it never leaves your device. There's no backend to send it to. The app is static files served from GitHub Pages.

**Why can't it just read my contacts directly?**
iOS Safari doesn't expose a contacts API to web pages (it's flag-gated and off by default). A vCard export is the only way to do this privately, without an app that asks for full address-book access.

**Will it mess up my contacts?**
It only ever produces a _new_ file — it can't touch your phone's contacts on its own. Take the backup, review the dry-run preview, and you stay in control of every change.

**Does it keep photos, notes, and birthdays?**
Yes, as long as you chose **Select All Fields** when exporting. The app preserves any field present in your file, even ones it doesn't specifically understand.

**Why did importing create duplicates again?**
iOS _adds_ contacts on import rather than replacing them. To truly replace, delete the originals first (see step 3).

## Under the hood

No build step, no framework, no runtime dependencies — just static files you can read top to bottom.

| File                             | Purpose                                                                  |
| -------------------------------- | ------------------------------------------------------------------------ |
| `index.html` / `css/styles.css`  | App shell and styles                                                     |
| `js/app.js`                      | UI flow: load → summary (+backup) → review → preview (dry-run) → export  |
| `js/vcard.js`                    | Round-trip-safe vCard parsing & serialization (preserves unknown fields) |
| `js/dedupe.js`                   | Normalization, duplicate detection, classification, and merging          |
| `js/format.js`                   | Conservative, reviewable formatting fixes                                |
| `sw.js` / `manifest.webmanifest` | Offline support + installable PWA                                        |

**Duplicate detection in brief:** contacts that share a normalized phone (compared on the last 10 digits) or email are treated as strong matches and auto-merged — unless the names clearly disagree or birthdays conflict, in which case they're sent to manual review. Same/similar names without shared contact info are only ever _suggested_, never merged for you.

## Development

```bash
npm install
npm test          # node --test — unit tests for vcard / dedupe / format
npm run lint      # eslint + prettier check
npm run format    # auto-fix formatting

node scripts/generate-icons.mjs   # regenerate the PNG app icons
```

Run it locally over HTTP (a service worker needs `http(s)`, not `file://`):

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Deploying to GitHub Pages

It's plain static files, so there's no build. In the repo's **Settings → Pages**, set the source to the `main` branch, root folder. Done.

## Contributing

Issues and PRs are welcome! This project is intentionally small and dependency-free — please keep contributions lightweight and readable.

## License

[MIT](LICENSE) — free to use, modify, and share.
