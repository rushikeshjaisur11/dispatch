import type Database from "./db";
import { getSetting, setSetting } from "./settings";
import { EMBEDDED_GOOGLE_CLIENT_ID, EMBEDDED_GOOGLE_CLIENT_SECRET } from "./config";

export async function getGoogleCreds(db: Database): Promise<{ clientId: string; clientSecret: string } | null> {
  const clientId = (await getSetting(db, "google_client_id")) || EMBEDDED_GOOGLE_CLIENT_ID;
  const clientSecret = (await getSetting(db, "google_client_secret")) || EMBEDDED_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function ensureCalendarId(db: Database, clientId: string, clientSecret: string): Promise<string> {
  const cached = await getSetting(db, "google_calendar_id");
  if (cached) return cached;
  const id = await window.api.googleCalendarEnsure({ clientId, clientSecret });
  await setSetting(db, "google_calendar_id", id);
  return id;
}

/** Pushes a task's due date to its Google Calendar event (creates one on first push). */
export async function pushTaskToCalendar(db: Database, task: { id: string; title: string; due_at: string | null; calendar_event_id: string | null }): Promise<void> {
  const creds = await getGoogleCreds(db);
  if (!creds || !task.due_at) return;
  const calendarId = await ensureCalendarId(db, creds.clientId, creds.clientSecret);
  const eventId = await window.api.googleCalendarUpsertEvent({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    calendarId,
    eventId: task.calendar_event_id,
    summary: task.title,
    dueAtIso: task.due_at,
  });
  if (eventId !== task.calendar_event_id) {
    await db.execute("UPDATE tasks SET calendar_event_id = $1 WHERE id = $2", [eventId, task.id]);
  }
}

type CalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
};

/** Incremental pull: applies remote Calendar changes onto local tasks (new due_at, or a brand-new task for events created directly on the calendar). */
export async function pullCalendarEvents(db: Database, groupId: string): Promise<void> {
  const creds = await getGoogleCreds(db);
  if (!creds) return;
  const calendarId = await ensureCalendarId(db, creds.clientId, creds.clientSecret);
  const syncToken = await getSetting(db, "google_sync_token");
  const resp = (await window.api.googleCalendarListEvents({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    calendarId,
    syncToken,
  })) as { items?: CalendarEvent[]; nextSyncToken?: string };
  for (const event of resp.items ?? []) {
    const existing = await db.select<{ id: string }[]>("SELECT id FROM tasks WHERE calendar_event_id = $1", [event.id]);
    if (event.status === "cancelled") {
      if (existing[0]) {
        await db.execute("UPDATE tasks SET deleted_at = datetime('now') WHERE id = $1", [existing[0].id]);
      }
      continue;
    }
    const dueAt = event.start?.dateTime ?? event.start?.date ?? null;
    if (existing[0]) {
      await db.execute(
        "UPDATE tasks SET title = $1, due_at = $2, updated_at = datetime('now') WHERE id = $3",
        [event.summary ?? "(untitled)", dueAt, existing[0].id],
      );
    } else {
      await db.execute(
        "INSERT INTO tasks (id, note_group_id, title, due_at, calendar_event_id) VALUES ($1, $2, $3, $4, $5)",
        [crypto.randomUUID(), groupId, event.summary ?? "(untitled)", dueAt, event.id],
      );
    }
  }
  if (resp.nextSyncToken) {
    await setSetting(db, "google_sync_token", resp.nextSyncToken);
  }
}
