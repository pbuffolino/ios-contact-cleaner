# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What this is

**iOS Contact Cleaner** — a 100% client-side web app that de-dupes, merges, and tidies
iPhone contacts from a vCard (`.vcf`) export. It is **public, open source (MIT)**, and
deployed to GitHub Pages at <https://pbuffolino.github.io/ios-contact-cleaner/>.

Vanilla HTML/CSS/JS, **no build step**, **zero runtime dependencies**. Dev tooling
(ESLint, Prettier, `node:test`) is the only thing in `package.json`.

## Non-negotiable invariants

These are the whole point of the project. Do not break them, and reject changes that would:

1. **Nothing leaves the device.** No `fetch`/`XMLHttpRequest`/WebSocket/beacon that sends
   contact data anywhere. No analytics, telemetry, cookies, trackers, or third-party
   scripts. The only network activity allowed is the service worker fetching the app's
   **own** static assets (same-origin) — see `sw.js`, which already ignores cross-origin
   requests. A user must be able to load the app, go offline, and have everything still work.
2. **No external/CDN dependencies at runtime.** Everything is served from this origin so the
   app is fully auditable and offline-capable. Do not add `<script src="https://...">`,
   import from a CDN, or pull an npm package into the shipped code. Keep runtime deps at zero.
3. **No secrets, ever.** This is a public repo. No API keys, tokens, credentials, or private
   endpoints — there is no backend to hold them. There is nothing to authenticate against.
4. **Never commit real contact data.** `*.vcf` is gitignored except `tests/fixtures/*.vcf`,
   which are small, synthetic, and contain no real people. Keep it that way.
5. **vCard round-trip safety.** Parsing then serializing an untouched contact must not lose
   data. Unknown/exotic properties are preserved verbatim (`js/vcard.js`). Formatting fixes
   are conservative and user-reviewable; never silently mutate a contact.

If a requested change conflicts with the above, stop and flag it rather than implementing it.

## Commands

```bash
npm test          # node --test — unit tests for vcard / dedupe / format
npm run lint      # eslint + prettier --check
npm run format    # prettier --write

node scripts/generate-icons.mjs   # regenerate PNG app icons (zero-dep encoder)

python -m http.server 8000        # serve locally; a service worker needs http(s), not file://
```

Run `npm test` and `npm run lint` before committing. Keep the test suite green and growing.

## Architecture

Pure-logic modules are framework-free ES modules — the same files the browser loads are
imported directly by `node:test`, so keep them DOM-free and unit-tested.

| File                             | Role                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.html` / `css/styles.css`  | App shell + screens (landing → summary → review → preview → export)                                                                              |
| `js/app.js`                      | **Only DOM-coupled file.** UI orchestration, screen flow, file load (`FileReader`), `Blob` download, backup, service-worker registration.        |
| `js/vcard.js`                    | Round-trip-safe vCard parse/serialize (line folding, 2.1 quoted-printable, base64 PHOTO passthrough, unknown-property preservation).             |
| `js/dedupe.js`                   | Normalization, duplicate detection/classification, `mergeCards`, and `buildPlan` (the single grouping primitive; `applyMerges` delegates to it). |
| `js/format.js`                   | Conservative, toggleable formatting fixes with before/after previews.                                                                            |
| `sw.js` / `manifest.webmanifest` | Offline app-shell cache + installable PWA.                                                                                                       |
| `tests/`                         | `node:test` suites + synthetic `.vcf` fixtures.                                                                                                  |

Keep new pure logic in `vcard`/`dedupe`/`format` (testable); keep DOM work in `app.js`.

## Conventions

- ES modules, browser + Node compatible (no Node-only APIs in the shared logic).
- Prettier (`.prettierrc`: 2-space, double quotes, semicolons, width 100) and the flat
  ESLint config are authoritative — run `npm run format`.
- No framework, no bundler, no transpile. If you reach for a build step, reconsider.
- Match the existing style: small focused functions, comments that explain _why_.

## Deploy

GitHub Pages, `main` branch, root folder — no build. Pushing to `main` publishes.
If you add a top-level file that Jekyll would ignore (none currently start with `_`),
add a `.nojekyll`.
