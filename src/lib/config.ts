/** Embedded Google OAuth client for the app's own "installed app" (desktop) credential —
 * so a typical end user just clicks Connect, instead of having to create their own Google
 * Cloud project + OAuth consent screen + credentials. Set these once (as the app's
 * developer) via a `.env` file (VITE_GOOGLE_CLIENT_ID / VITE_GOOGLE_CLIENT_SECRET) before
 * shipping; Settings still lets a user override with their own OAuth app if they prefer. */
export const EMBEDDED_GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
export const EMBEDDED_GOOGLE_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET ?? "";

/** Embedded Supabase project — the developer's own project, one for every install of the
 * app, so an end user never has to create a Supabase project or find its URL/anon key just
 * to sync notes across their own devices. Set once via `.env` (VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY); Settings still lets a user point at their own project instead. */
export const EMBEDDED_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
export const EMBEDDED_SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

/** Where to send a user who needs to generate their own BYOK API key — this step can't be
 * removed (the whole point of BYOK is the user's own billing account), but a direct link
 * beats making them go search for it. */
export const BYOK_KEY_SIGNUP_URL: Record<string, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
};
