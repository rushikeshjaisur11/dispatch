import { useCallback, useEffect, useState } from "react";
import type Database from "../lib/db";

export type Group = {
  id: string;
  title: string;
  color: string;
  parent_id: string | null;
};

export function useGroups(db: Database | null) {
  const [groups, setGroups] = useState<Group[]>([]);

  const refresh = useCallback(async () => {
    if (!db) return;
    const rows = await db.select<Group[]>(
      "SELECT id, title, color, parent_id FROM note_groups ORDER BY title ASC",
    );
    setGroups(rows);
  }, [db]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addGroup(title: string, parentId: string | null = null) {
    if (!db || !title.trim()) return;
    const id = crypto.randomUUID();
    await db.execute("INSERT INTO note_groups (id, title, parent_id) VALUES ($1, $2, $3)", [id, title.trim(), parentId]);
    await refresh();
    return id;
  }

  async function renameGroup(id: string, title: string) {
    if (!db || !title.trim()) return;
    await db.execute("UPDATE note_groups SET title = $1, updated_at = datetime('now') WHERE id = $2", [title.trim(), id]);
    await refresh();
  }

  async function moveGroup(id: string, parentId: string | null) {
    if (!db) return;
    await db.execute("UPDATE note_groups SET parent_id = $1, updated_at = datetime('now') WHERE id = $2", [parentId, id]);
    await refresh();
  }

  async function setGroupColor(id: string, color: string) {
    if (!db) return;
    await db.execute("UPDATE note_groups SET color = $1, updated_at = datetime('now') WHERE id = $2", [color, id]);
    await refresh();
  }

  async function deleteGroup(id: string) {
    if (!db) return;
    await db.execute("UPDATE note_groups SET parent_id = NULL WHERE parent_id = $1", [id]);
    await db.execute("DELETE FROM note_groups WHERE id = $1", [id]);
    await refresh();
  }

  return { groups, addGroup, renameGroup, moveGroup, setGroupColor, deleteGroup, refresh };
}
