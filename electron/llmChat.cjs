const { createOpenAI } = require("@ai-sdk/openai");
const { createAnthropic } = require("@ai-sdk/anthropic");
const { streamText } = require("ai");

/** Port of llm.rs's call_llm_api. `kind` is "anthropic" or "openai-compatible" (covers
 * openai/groq/local/custom via base_url) — same two-branch shape as the Rust version, but
 * the `ai` SDK replaces the hand-rolled SSE parsing. */
async function callLlmApi(win, { taskId, kind, baseUrl, apiKey, model, messages }) {
  try {
    const provider =
      kind === "anthropic" ? createAnthropic({ apiKey }) : createOpenAI({ apiKey, baseURL: baseUrl || "https://api.openai.com/v1" });

    const result = streamText({ model: provider(model), messages });
    for await (const delta of result.textStream) {
      win.webContents.send("chat-event", { payload: { task_id: taskId, delta } });
    }
    win.webContents.send("chat-exit", { payload: { task_id: taskId, error: null } });
  } catch (err) {
    win.webContents.send("chat-exit", { payload: { task_id: taskId, error: String(err?.message ?? err) } });
  }
}

module.exports = { callLlmApi };
