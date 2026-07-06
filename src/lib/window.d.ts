export {};

declare global {
  interface Window {
    api: {
      db: {
        select<T>(sql: string, params?: unknown[]): Promise<T>;
        execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId: number | bigint }>;
      };
      events: {
        on(channel: string, cb: (data: { payload: unknown }) => void): () => void;
      };
      window: {
        minimize(): Promise<void>;
        maximizeToggle(): Promise<void>;
        close(): Promise<void>;
      };
      theme: {
        set(source: "system" | "light" | "dark"): Promise<void>;
      };
      runAgent(args: { taskId: string; command: string; args: string[]; projectDir: string }): Promise<void>;
      pauseAgent(taskId: string): Promise<void>;
      callLlmApi(args: {
        taskId: string;
        kind: string;
        baseUrl: string | null;
        apiKey: string;
        model: string;
        messages: { role: string; content: string }[];
      }): Promise<void>;
      saveApiKey(provider: string, key: string): Promise<void>;
      getApiKey(provider: string): Promise<string | null>;
      deleteApiKey(provider: string): Promise<void>;
      googleAuthStart(clientId: string, clientSecret: string): Promise<void>;
      googleAuthStatus(): Promise<boolean>;
      googleAuthSignOut(): Promise<void>;
      googleCalendarEnsure(args: { clientId: string; clientSecret: string }): Promise<string>;
      googleCalendarUpsertEvent(args: {
        clientId: string;
        clientSecret: string;
        calendarId: string;
        eventId: string | null;
        summary: string;
        dueAtIso: string;
      }): Promise<string>;
      googleCalendarDeleteEvent(args: { clientId: string; clientSecret: string; calendarId: string; eventId: string }): Promise<void>;
      googleCalendarListEvents(args: {
        clientId: string;
        clientSecret: string;
        calendarId: string;
        syncToken: string | null;
      }): Promise<{ items?: unknown[]; nextSyncToken?: string }>;
      startLocalRedirectListener(): Promise<number>;
      detectObsidianVault(vaultPath: string): Promise<boolean>;
      writeVaultNote(args: { vaultPath: string; folder: string; filename: string; content: string }): Promise<void>;
      selectFolder(): Promise<string | null>;
      openSettings(): Promise<void>;
      openCapture(): Promise<void>;
      openExternal(url: string): Promise<void>;
      openTerminal(command: string, cwd: string | null): Promise<void>;
    };
  }
}
