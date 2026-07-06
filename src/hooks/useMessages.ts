import { useCallback, useEffect, useState } from "react";
import type Database from "../lib/db";

export type Message = {
  id: string;
  task_id: string;
  run_id: string | null;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export function useMessages(db: Database | null, taskId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);

  const refresh = useCallback(async () => {
    if (!db || !taskId) {
      setMessages([]);
      return;
    }
    const rows = await db.select<Message[]>(
      "SELECT id, task_id, run_id, role, content, created_at FROM messages WHERE task_id = $1 ORDER BY created_at ASC",
      [taskId],
    );
    setMessages(rows);
  }, [db, taskId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addMessage = useCallback(
    async (role: "user" | "assistant", content: string, runId: string | null = null) => {
      if (!db || !taskId) return;
      const id = crypto.randomUUID();
      await db.execute(
        "INSERT INTO messages (id, task_id, run_id, role, content) VALUES ($1, $2, $3, $4, $5)",
        [id, taskId, runId, role, content],
      );
      await refresh();
    },
    [db, taskId, refresh],
  );

  return { messages, addMessage, refresh };
}
