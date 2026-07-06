const path = require("path");
const { BrowserWindow } = require("electron");

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:1420";

const windows = { main: null, sticky: new Map(), capture: null };

function loadApp(win, search) {
  if (isDev) {
    win.loadURL(search ? `${DEV_URL}/?${search}` : DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"), search ? { search } : undefined);
  }
}

/** Frameless main window. Windows 11 gets native Mica, macOS gets vibrancy, Linux stays
 * opaque (neither framework blurs there) — same per-platform split as Tauri's
 * window-vibrancy path, just simpler because Electron supports Mica natively. */
function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: false,
    // Mica/vibrancy need a transparent backgroundColor — an opaque one blocks the
    // native material even with backgroundMaterial/vibrancy set (Electron docs).
    backgroundColor: "#00000000",
    ...(process.platform === "win32" && { backgroundMaterial: "mica" }),
    ...(process.platform === "darwin" && { vibrancy: "under-window", titleBarStyle: "hidden" }),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loadApp(win);
  win.once("ready-to-show", () => win.show());
  windows.main = win;
  win.on("closed", () => {
    windows.main = null;
  });
  return win;
}

function openStickyWindow(groupId) {
  const label = `sticky-${groupId}`;
  const existing = windows.sticky.get(label);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }
  const win = new BrowserWindow({
    width: 320,
    height: 400,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loadApp(win, `sticky=${groupId}`);
  windows.sticky.set(label, win);
  win.on("closed", () => windows.sticky.delete(label));
  return win;
}

function openCaptureWindow() {
  if (windows.capture && !windows.capture.isDestroyed()) {
    windows.capture.focus();
    return windows.capture;
  }
  const win = new BrowserWindow({
    width: 420,
    height: 60,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loadApp(win, "capture=1");
  windows.capture = win;
  win.on("closed", () => {
    windows.capture = null;
  });
  return win;
}

module.exports = { createMainWindow, openStickyWindow, openCaptureWindow, windows };
