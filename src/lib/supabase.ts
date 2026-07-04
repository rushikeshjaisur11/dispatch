import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function initSupabase(url: string, anonKey: string): SupabaseClient {
  // pkce flowType so the emailed link's redirect carries a `?code=` (capturable by a plain
  // loopback listener) instead of an implicit-flow `#access_token=` fragment (browser-JS only).
  client = createClient(url, anonKey, { auth: { flowType: "pkce" } });
  return client;
}

export function getSupabase(): SupabaseClient | null {
  return client;
}
