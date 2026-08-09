// Server-only Supabase client. Uses the service_role key, which bypasses
// RLS — this app has no user auth, so the server is the only trusted writer.
// Never import this from client-side code (src/).

import { createClient } from "@supabase/supabase-js";
import { loadEnvFile } from "node:process";

loadEnvFile(".env.local");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

export const supabase = createClient(url, key);
