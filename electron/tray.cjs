const { Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const { windows, openStickyWindow } = require("./windowManager.cjs");

let tray = null;

function showMain() {
  const win = windows.main;
  if (win) {
    win.show();
    win.focus();
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "public", "tauri.svg"));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  const menu = Menu.buildFromTemplate([
    { label: "Show Board", click: showMain },
    { label: "New Sticky Note", click: () => openStickyWindow("default") },
    {
      label: "Settings",
      click: () => {
        showMain();
        windows.main?.webContents.send("navigate-to", { payload: "settings" });
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => require("electron").app.exit(0) },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip("Dispatch");
  tray.on("click", showMain);
  return tray;
}

module.exports = { createTray };
