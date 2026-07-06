/** Matches Tauri's `listen<T>(event, handler)` shape (async, resolves to an unlisten fn,
 * handler receives `{ payload }`) so hook call sites port with just the import swapped.
 * Backed by `window.api.events.on`, which the main process feeds via `webContents.send`. */
export type UnlistenFn = () => void;

export async function listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<UnlistenFn> {
  return window.api.events.on(event, handler as (data: { payload: unknown }) => void);
}
