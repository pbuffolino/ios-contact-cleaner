# Agent shipping instructions

Read [CLAUDE.md](CLAUDE.md) and [README.md](README.md). Run the existing `npm test`
and `npm run lint` with declared dev tooling; use synthetic vCards, never real
contacts, for regression checks. Keep zero runtime dependencies and client-only
privacy boundaries. Pages serves the `main` branch root with no build: reviewed
merge publishes source. Verify the actual published UI without uploading contacts;
local tests alone do not establish Pages or phone import acceptance.

## Local validation, Codex review and shipping

Run the repository's local checks on the exact candidate revision. Record the
commit/tree, commands, tool versions, platform, results and coverage limits in
the PR. Missing dependencies, skipped platforms and unrun checks remain explicit
limitations. A source check does not authorize live provider or device actions.

Use independent native Codex reviewers; the implementer cannot review its own
change. Scale review to risk, with separate code and security reviews for release,
authorization, privacy or security boundaries. Fix blocking findings and refresh
affected evidence after changes. Do not use an unconfigured hosted review bot.

Save source on a task branch and open a PR. Recheck its exact head and applicable
protections before merging; verify the merged tree matches the reviewed tree.
After merge, follow the established deployment/installation procedure where one
exists and the task authorizes it, then verify the actual installed or served
revision and live behavior. If no target is established, say so rather than
inventing one. Keep source, merge, deployment and live acceptance distinct.

This guide grants no new credential, provider, account, scheduler, messaging,
spending, physical-device or system-change authority. Preserve existing privacy,
leases and ownership rules. Do not install hooks, runners or new automation as
part of local validation.
