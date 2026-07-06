const { app, BrowserWindow, globalShortcut } = require("electron");
const { openDatabase } = require("./electron/database.cjs");
const secretStore = require("./electron/secretStore.cjs");
const { createMainWindow } = require("./electron/windowManager.cjs");
const { registerIpcHandlers } = require("./electron/ipcHandlers.cjs");
const { createTray } = require("./electron/tray.cjs");

app.whenReady().then(() => {
  const userDataDir = app.getPath("userData");
  openDatabase(userDataDir);
  secretStore.init(userDataDir);

  const mainWindow = createMainWindow();
  registerIpcHandlers(mainWindow);
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
