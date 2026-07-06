# Dispatch

Dispatch is a desktop app for turning sticky-note style tasks into runs of a real coding
agent — spawn Claude Code or Codex against a note, or chat with a bring-your-own-key
(BYOK) LLM provider, and watch it work from a console panel docked next to your notes.

Built with Electron, React 19, Tailwind v4, and SQLite (`better-sqlite3`).

## Features

- **Sticky-note tasks** grouped into nested folders, with due dates, done/undone
  toggling, and per-note color tags.
- **Run any CLI agent** (Claude Code, Codex, or a custom command you register) against a
  note — streams live output, detects genuine task completion (vs. a mid-conversation
  pause) via a completion-instruction sentinel, and supports follow-up turns that resume
  the same session.
- **BYOK chat** — talk to any OpenAI-compatible or Anthropic-compatible provider directly
  from the same panel, using your own API key (stored via OS-level encryption, never in
  the database).
- **Sessions view** — a global history of every agent run, with the resumable session ID,
  a button to open a real terminal running the resume command in the task's project
  directory, and a "copy command" fallback.
- **Google Calendar sync** — push task due-dates to a dedicated calendar via OAuth (PKCE,
  loopback redirect), no manual client-id entry required if the maintainer has configured
  embedded app credentials (see [Configuration](#configuration)).
- **Obsidian export** — completed/paused runs get written as a markdown note into your
  vault, with frontmatter (status, agent, duration, project).
- **Cross-device sync** — optional Supabase-backed sync for tasks/groups/agent runs
  across machines, with machine-id binding so concurrent runs don't collide.
- **Apple-glass-inspired UI** — translucent chrome (Mica on Windows 11, vibrancy on
  macOS), a cool neutral palette with a single blue accent, and spring-driven motion.

## Project layout

```
main.cjs                 Electron entry point
preload.cjs              contextBridge surface exposed to the renderer as window.api
electron/
  agentRunner.cjs         spawns/streams/kills CLI agent processes
  llmChat.cjs             BYOK provider streaming (OpenAI/Anthropic-compatible)
  googleCalendarManager.cjs  OAuth PKCE flow + Calendar API calls
  authRedirect.cjs        loopback listener for Supabase magic-link/OAuth redirects
  secretStore.cjs         OS-encrypted (safeStorage) API key storage
  database.cjs            better-sqlite3 + idempotent migration runner
  windowManager.cjs       BrowserWindow creation (main/sticky/capture windows)
  ipcHandlers.cjs         all ipcMain.handle registrations
  migrations/*.sql        schema migrations, applied once via PRAGMA user_version
src/
  App.tsx                 shell + all major view components
  hooks/                  useTasks, useGroups, useMessages, useChat, useSessions
  lib/                    db client, event listener shim, agent/session helpers,
                          Google Calendar, Obsidian, Supabase sync, theme, motion
  components/ui/          shadcn-style Radix wrapper components
```

## Getting started

```bash
npm install
npm run dev          # Vite dev server + electron:dev for the desktop shell
```

To run the packaged desktop app directly:

```bash
npm run build         # tsc + vite build -> dist/
npx electron .         # launches main.cjs against dist/
```

### Configuration

Copy `.env.example` to `.env` and fill in your own credentials — these are **app-level**
(maintainer-provided) credentials, not per-user secrets, so end users of a built app
never need to create their own OAuth app or Supabase project:

- `VITE_GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_SECRET` — a Google Cloud OAuth 2.0
  Desktop App client (Calendar API scope), used for the Calendar sync PKCE flow.
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — a Supabase project for cross-device
  sync and magic-link/OAuth sign-in. Run `supabase/sync_schema.sql` in the SQL editor to
  create the required tables + RLS policies.

None of these are required to use local-only features (running CLI agents, notes,
Obsidian export) — the app runs fully offline without them.

### Registering an agent CLI

Agent CLIs are rows in the `agent_clis` table (Settings → Agents), each with a JSON-array
argv template using `{prompt}`/`{resume_id}` placeholders, e.g.:

```json
["-p", "{prompt}", "--output-format", "stream-json"]
```

Claude Code and Codex ship as built-ins; add your own by pointing at any CLI that accepts
a prompt argument and streams JSON-lines output.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run electron:dev` | Build once, then launch Electron against it |
| `npm run dist` | Build + package for the current platform (`electron-builder`) |
| `npm run build:win` / `build:mac` / `build:linux` | Platform-specific packaged builds |

## Roadmap / future features

- Code-sign and notarize macOS/Windows builds so packaged installers are distributable
  off-machine (currently unsigned).
- Split `src/App.tsx` into per-component files — it currently holds every major view and
  has grown large.
- Code-split the renderer bundle (currently a single ~700KB chunk).
- Richer agent activity parsing (`describeAgentActivity`) — surface more tool-specific
  statuses as new CLIs are added, rather than falling back to generic "Working…" for
  unrecognized event shapes.
- Linux Mica/vibrancy-equivalent — currently falls back to an opaque surface since
  neither Electron nor the OS compositor offers a native blur material there.
- Multi-agent delegation (Task-type tool calls spawning sub-agents) surfaced in the UI
  as a nested run tree, instead of a single flat message list.
- Conflict resolution UI for Supabase sync (currently last-write-wins by `updated_at`).

## License

Not yet decided — treat as all-rights-reserved until a LICENSE file is added.
