const { spawn } = require("child_process");
const readline = require("readline");

/** Tracks running child processes keyed by task_id, so a task can be paused. Port of
 * lib.rs's Supervisor: same spawn/track/kill shape, streamed line-by-line over IPC
 * instead of Tauri's `app.emit`. */
const running = new Map();

function runAgent(win, { taskId, command, args, projectDir }) {
  let child;
  try {
    child = spawn(command, args, { cwd: projectDir, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    win.webContents.send("agent-event", { payload: { task_id: taskId, line: `[dispatch] failed to launch "${command}": ${err.message}` } });
    win.webContents.send("agent-exit", { payload: { task_id: taskId } });
    return;
  }
  running.set(taskId, child);

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    win.webContents.send("agent-event", { payload: { task_id: taskId, line } });
  });
  // stderr was previously discarded entirely, so a misconfigured or unauthenticated CLI
  // failed with zero visible feedback — surface it as log lines instead.
  const rlErr = readline.createInterface({ input: child.stderr });
  rlErr.on("line", (line) => {
    win.webContents.send("agent-event", { payload: { task_id: taskId, line: `[stderr] ${line}` } });
  });
  // ENOENT (binary not found/not on PATH) and similar failures land here, asynchronously,
  // instead of throwing — without this the task just sits at "running" forever.
  child.on("error", (err) => {
    running.delete(taskId);
    win.webContents.send("agent-event", {
      payload: { task_id: taskId, line: `[dispatch] "${command}" failed to start: ${err.message} — is it installed and on PATH?` },
    });
    win.webContents.send("agent-exit", { payload: { task_id: taskId } });
  });
  child.on("close", () => {
    running.delete(taskId);
    win.webContents.send("agent-exit", { payload: { task_id: taskId } });
  });
}

function pauseAgent(taskId) {
  const child = running.get(taskId);
  if (child) {
    child.kill();
    running.delete(taskId);
  }
}

module.exports = { runAgent, pauseAgent };
