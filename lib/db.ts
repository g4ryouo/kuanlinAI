import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
      auth: { persistSession: false },
    });
  }
  return client;
}
