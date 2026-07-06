const { contextBridge, ipcRenderer } = require("electron");

/** `window.api` bridge — one method per Tauri `invoke("cmd", args)` call site found in the
 * renderer, plus the db and event surfaces consumed by src/lib/db.ts and src/lib/event.ts. */
contextBridge.exposeInMainWorld("api", {
  db: {
    select: (sql, params) => ipcRenderer.invoke("db:select", sql, params),
    execute: (sql, params) => ipcRenderer.invoke("db:execute", sql, params),
  },
  events: {
    on: (channel, cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximizeToggle: () => ipcRenderer.invoke("window:maximizeToggle"),
    close: () => ipcRenderer.invoke("window:close"),
  },
  theme: {
    set: (source) => ipcRenderer.invoke("theme:set", source),
  },
  runAgent: (args) => ipcRenderer.invoke("run_agent", args),
  pauseAgent: (taskId) => ipcRenderer.invoke("pause_agent", { taskId }),
  callLlmApi: (args) => ipcRenderer.invoke("call_llm_api", args),
  saveApiKey: (provider, key) => ipcRenderer.invoke("save_api_key", { provider, key }),
  getApiKey: (provider) => ipcRenderer.invoke("get_api_key", { provider }),
  deleteApiKey: (provider) => ipcRenderer.invoke("delete_api_key", { provider }),
  googleAuthStart: (clientId, clientSecret) => ipcRenderer.invoke("google_auth_start", { clientId, clientSecret }),
  googleAuthStatus: () => ipcRenderer.invoke("google_auth_status"),
  googleAuthSignOut: () => ipcRenderer.invoke("google_auth_sign_out"),
  googleCalendarEnsure: (args) => ipcRenderer.invoke("google_calendar_ensure", args),
  googleCalendarUpsertEvent: (args) => ipcRenderer.invoke("google_calendar_upsert_event", args),
  googleCalendarDeleteEvent: (args) => ipcRenderer.invoke("google_calendar_delete_event", args),
  googleCalendarListEvents: (args) => ipcRenderer.invoke("google_calendar_list_events", args),
  startLocalRedirectListener: () => ipcRenderer.invoke("start_local_redirect_listener"),
  detectObsidianVault: (vaultPath) => ipcRenderer.invoke("detect_obsidian_vault", { vaultPath }),
  writeVaultNote: (args) => ipcRenderer.invoke("write_vault_note", args),
  selectFolder: () => ipcRenderer.invoke("select_folder"),
  openSettings: () => ipcRenderer.invoke("open_settings"),
  openCapture: () => ipcRenderer.invoke("open_capture"),
  openExternal: (url) => ipcRenderer.invoke("open_external", url),
  openTerminal: (command, cwd) => ipcRenderer.invoke("open_terminal", { command, cwd }),
});
