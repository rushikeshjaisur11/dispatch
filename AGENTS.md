# AGENTS.md

Instructions and hard-won gotchas for coding agents working in this repository.

## What this is

Dispatch is an Electron desktop app (migrated from an original Tauri/Rust prototype —
`src-tauri/` may still exist in history but is dead code once Electron parity is
confirmed; delete it rather than maintaining two backends). Renderer is React 19 +
Tailwind v4 + shadcn/Radix; persistence is SQLite via `better-sqlite3` in the main
process, exposed to the renderer over `contextBridge` as `window.api`.

Read `README.md` first for the feature/architecture overview. This file is about *how to
work in the codebase correctly*, not what it does.

## Testing changes — do this, not that

- **Always launch via `npx electron .` from the repo root**, never
  `npx electron some-script.cjs`. Passing a bare script file skips loading
  `package.json`, so `app.getName()` falls back to `"Electron"` instead of `"agentpad"`,
  which changes `app.getPath('userData')` to a completely different folder — you'll be
  reading/writing the wrong SQLite database and drawing wrong conclusions about bugs.
- **Rebuild before relaunching**: `npx vite build` (renderer) — the Electron main
  process reads from `dist/` in production mode (no `VITE_DEV_SERVER_URL` env var), so a
  stale `dist/` means your changes silently don't show up.
- **Drive the real running app via Chrome DevTools Protocol**, not unit-test guesses,
  when verifying UI/IPC behavior: launch with `--remote-debugging-port=<port>`, then use
  Node's built-in `WebSocket`/`fetch` to call `Runtime.evaluate` / `Page.captureScreenshot`
  against `http://127.0.0.1:<port>/json`. This is the only reliable way to confirm a fix
  actually works end-to-end (a real CLI agent spawned, a real dialog rendered).
- The SQLite DB lives at `%APPDATA%/agentpad/agentpad.db` (Windows) — inspect it directly
  with `sqlite3`/Python's `sqlite3` module when the app is closed (it's WAL-mode and
  locked while running). Never edit it with a bare `node -e` script using
  `better-sqlite3` — that module is a native addon built against Electron's ABI, not
  Node's; it'll throw on load from plain Node.

## Renderer ↔ main process conventions

- `window.api.db.select/execute` takes SQL with **Postgres-style `$1/$2` placeholders**
  bound from a **positional array**. The main-process handler (`electron/database.cjs`)
  converts this to better-sqlite3's named-parameter form — don't "simplify" this to `?`
  placeholders, and note that a query can reuse the same `$N` more than once (e.g. an
  `INSERT ... ON CONFLICT DO UPDATE`), which the conversion already handles.
- `window.api.events`/`src/lib/event.ts`'s `listen(channel, cb)` delivers `{ payload }` —
  main-process `webContents.send(channel, { payload })` must wrap the value; every
  consumer reads `e.payload`, not `e` directly.
- Every new main-process capability needs three touch points: an `ipcMain.handle` in
  `electron/ipcHandlers.cjs`, a bridge method in `preload.cjs`, and a type in
  `src/lib/window.d.ts`. Missing the type declaration won't fail at runtime, only at
  `tsc` — always run `npx tsc --noEmit` after adding one.

## Known platform gotchas

- **`window.prompt()`/`confirm()` throw in Electron's renderer** instead of showing a
  dialog (`Script failed to execute`). Use the `Dialog` components in
  `src/components/ui/dialog.tsx`, never a browser-only prompt.
- **`child_process.spawn(..., { shell: true })` on Windows reconstructs the command line
  via `cmd.exe`**, which mangles arguments containing parentheses, quotes, or embedded
  newlines — exactly what the completion-instruction prompt text contains. Don't add
  `shell: true` to `electron/agentRunner.cjs` without solving that escaping problem first;
  it silently breaks real CLI agent invocations that work fine without it.
- **A missing/deleted `cwd` makes `spawn()` report `ENOENT` for the command itself** on
  Windows, not a "directory not found" error — don't assume ENOENT means the binary isn't
  installed; check the `cwd` (the task's `project_dir`) exists first if that's ambiguous.
- **Tailwind v4's `--radius-*`/`--spacing-*` are reserved internal namespaces**, not free
  variable names — declaring your own `@theme { --spacing-md: ... }` silently overrides
  `.max-w-md`/`.min-w-*` (which resolve through the same namespace), unrelated to your
  intent. Grep the compiled CSS (`dist/assets/*.css`) for a utility class if a token
  override seems to have unintended side effects.
- **`clip-path` (used by the `.squircle` utility in `App.css`) clips absolutely-positioned
  children in the corner region**, unlike plain `border-radius` which never clips
  overflow by itself. Don't apply `.squircle` to a container with an absolutely
  positioned corner element (e.g. a dialog close button) unless its inset comfortably
  clears the corner radius — prefer plain `rounded-xl` for those.
- **Never change `package.json`'s `"name"` field** without a deliberate migration plan —
  it drives `app.getName()`'s default and therefore `app.getPath('userData')`. The app is
  branded "Dispatch" (window title, titlebar, tray) but `package.json`'s internal `name`
  stays `"agentpad"` on purpose, so the existing userData folder (and everyone's local
  database) isn't orphaned by a rename.

## Task completion semantics

A CLI turn finishing is **not** the same as the user's request being done — a
mid-conversation reply ("sure, want me to also update the tests?") shouldn't flip a
task's status to `done`. `src/lib/agentIntegrations.ts`'s `withCompletionInstruction` /
`COMPLETION_SYSTEM_PROMPT` asks the agent to end its final reply with a sentinel
(`<<TASK_COMPLETE>>`) only when the whole request is genuinely satisfied;
`extractCompletion` strips it before display. Everything else pauses, ready for a
follow-up. Preserve this distinction in any code path that sets task status.

## Security

- Never commit `.env` (already gitignored) — it holds real Google OAuth and Supabase
  credentials. Use `.env.example` as the template for required variable names.
- Never print secret values (API keys, OAuth client secrets, tokens) to logs or terminal
  output, even for debugging — check presence/length only.
- BYOK provider API keys are stored via `electron/secretStore.cjs` (`safeStorage`,
  OS-level encryption), never written to the SQLite database in plaintext.

## Style

- Follow the existing "surgical diff" pattern seen throughout `App.tsx`/hooks: touch only
  what a task requires, no speculative abstractions, no defensive error handling for
  states that can't occur. Comments explain *why* (a workaround, a non-obvious
  constraint), never *what* the code does.
