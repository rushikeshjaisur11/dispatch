import { useCallback, useRef, useState } from "react";
import type Database from "../lib/db";
import { listen } from "../lib/event";
import { getApiKey, extractCompletion, COMPLETION_SYSTEM_PROMPT, type ByokProvider } from "../lib/agentIntegrations";
import type { Message } from "./useMessages";

/** Runs a BYOK direct-API chat turn for a task, streaming deltas from Rust's `call_llm_api`
 * (kept out of the webview to sidestep Anthropic's missing CORS headers), and persists the
 * finished turn via `onMessage` (bind this to a useMessages(db, taskId).addMessage). */
export function useChat(db: Database | null, taskId: string | null, onMessage: (role: "user" | "assistant", content: string) => Promise<void>) {
  const [streamingText, setStreamingText] = useState("");
  const [running, setRunning] = useState(false);
  const runIdRef = useRef<string | null>(null);

  const sendChat = useCallback(
    async (provider: ByokProvider, history: Message[], prompt: string) => {
      if (!db || !taskId) return;
      await onMessage("user", prompt);
      const apiKey = (await getApiKey(provider.id)) ?? "";
      const runId = crypto.randomUUID();
      runIdRef.current = runId;
      await db.execute("INSERT INTO agent_runs (id, task_id, agent, run_kind) VALUES ($1, $2, $3, 'chat')", [runId, taskId, provider.id]);
      await db.execute("UPDATE tasks SET status = 'running', updated_at = datetime('now') WHERE id = $1", [taskId]);
      setRunning(true);
      setStreamingText("");

      let full = "";
      const unlistenDelta = await listen<{ task_id: string; delta: string }>("chat-event", (e) => {
        if (e.payload.task_id !== taskId) return;
        full += e.payload.delta;
        setStreamingText(full);
      });
      const unlistenExit = await listen<{ task_id: string; error: string | null }>("chat-exit", async (e) => {
        if (e.payload.task_id !== taskId) return;
        unlistenDelta();
        unlistenExit();
        setRunning(false);
        setStreamingText("");
        // A reply finishing isn't the same as the request being done — only the model's own
        // completion signal (COMPLETION_SYSTEM_PROMPT) flips status to 'done'; anything else
        // pauses, so the conversation can keep going via a follow-up.
        const { complete, text: cleanFull } = extractCompletion(full);
        await db.execute(
          "UPDATE agent_runs SET end_reason = $1, summary = $2, ended_at = datetime('now') WHERE id = $3",
          [e.payload.error ? "error" : "success", e.payload.error ?? cleanFull, runId],
        );
        await db.execute("UPDATE tasks SET status = $1, updated_at = datetime('now') WHERE id = $2", [e.payload.error ? "paused" : complete ? "done" : "paused", taskId]);
        if (cleanFull) await onMessage("assistant", cleanFull);
      });

      const messages = [
        { role: "system", content: COMPLETION_SYSTEM_PROMPT },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: prompt },
      ];
      await window.api.callLlmApi({
        taskId,
        kind: provider.kind,
        baseUrl: provider.base_url,
        apiKey,
        model: provider.default_model ?? "gpt-4o-mini",
        messages,
      });
    },
    [db, taskId, onMessage],
  );

  return { sendChat, streamingText, running };
}
