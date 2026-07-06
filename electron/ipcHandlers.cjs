const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ipcMain, globalShortcut, nativeTheme, shell, dialog } = require("electron");
const { dbSelect, dbExecute } = require("./database.cjs");
const { runAgent, pauseAgent } = require("./agentRunner.cjs");
const { callLlmApi } = require("./llmChat.cjs");
const secretStore = require("./secretStore.cjs");
const google = require("./googleCalendarManager.cjs");
const { startLocalRedirectListener } = require("./authRedirect.cjs");
const { openCaptureWindow } = require("./windowManager.cjs");

function registerIpcHandlers(mainWindow) {
  // --- db ---
  ipcMain.handle("db:select", (_e, sql, params) => dbSelect(sql, params));
  ipcMain.handle("db:execute", (_e, sql, params) => dbExecute(sql, params));

  // --- window controls ---
  ipcMain.handle("window:minimize", (e) => require("electron").BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.handle("window:maximizeToggle", (e) => {
    const win = require("electron").BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.handle("window:close", (e) => require("electron").BrowserWindow.fromWebContents(e.sender)?.close());

  // --- theme ---
  ipcMain.handle("theme:set", (_e, source) => {
    nativeTheme.themeSource = source;
  });

  // --- agent runner ---
  ipcMain.handle("run_agent", (_e, args) => runAgent(mainWindow, args));
  ipcMain.handle("pause_agent", (_e, { taskId }) => pauseAgent(taskId));

  // --- llm chat (BYOK) ---
  ipcMain.handle("call_llm_api", (_e, args) => callLlmApi(mainWindow, args));

  // --- BYOK secret keys ---
  ipcMain.handle("save_api_key", (_e, { provider, key }) => secretStore.setSecret(`byok_${provider}`, key));
  ipcMain.handle("get_api_key", (_e, { provider }) => secretStore.getSecret(`byok_${provider}`));
  ipcMain.handle("delete_api_key", (_e, { provider }) => secretStore.deleteSecret(`byok_${provider}`));

  // --- Google OAuth + Calendar ---
  ipcMain.handle("google_auth_start", (_e, args) => google.googleAuthStart(mainWindow, args));
  ipcMain.handle("google_auth_status", () => google.googleAuthStatus());
  ipcMain.handle("google_auth_sign_out", () => google.googleAuthSignOut());
  ipcMain.handle("google_calendar_ensure", (_e, args) => google.googleCalendarEnsure(args));
  ipcMain.handle("google_calendar_upsert_event", (_e, args) => google.googleCalendarUpsertEvent(args));
  ipcMain.handle("google_calendar_delete_event", (_e, args) => google.googleCalendarDeleteEvent(args));
  ipcMain.handle("google_calendar_list_events", (_e, args) => google.googleCalendarListEvents(args));

  // --- Supabase magic-link loopback ---
  ipcMain.handle("start_local_redirect_listener", () => startLocalRedirectListener(mainWindow));

  // --- Obsidian vault ---
  ipcMain.handle("detect_obsidian_vault", (_e, { vaultPath }) => fs.existsSync(path.join(vaultPath, ".obsidian")));
  ipcMain.handle("write_vault_note", (_e, { vaultPath, folder, filename, content }) => {
    const dir = path.join(vaultPath, folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), content);
  });
  ipcMain.handle("select_folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });

  // --- misc app commands ---
  ipcMain.handle("open_settings", () => {
    mainWindow.webContents.send("navigate-to", { payload: "settings" });
  });
  ipcMain.handle("open_capture", () => openCaptureWindow());
  ipcMain.handle("open_external", (_e, url) => shell.openExternal(url));

  // Opens a real terminal window running the resume command — "copy command" made you
  // paste it yourself; this launches it directly, in the task's own project directory.
  ipcMain.handle("open_terminal", (_e, { command, cwd }) => {
    const options = { cwd: cwd || undefined, detached: true, stdio: "ignore" };
    let child;
    if (process.platform === "win32") {
      child = spawn("cmd.exe", ["/c", "start", '""', "cmd.exe", "/k", command], options);
    } else if (process.platform === "darwin") {
      child = spawn("osascript", ["-e", `tell application "Terminal" to do script "${command.replace(/"/g, '\\"')}"`], options);
    } else {
      child = spawn("x-terminal-emulator", ["-e", `bash -c "${command.replace(/"/g, '\\"')}; exec bash"`], options);
    }
    child.unref();
  });

  // global capture shortcut (Ctrl+Alt+N), same binding as lib.rs's capture_shortcut
  globalShortcut.register("Control+Alt+N", () => openCaptureWindow());
}

module.exports = { registerIpcHandlers };
