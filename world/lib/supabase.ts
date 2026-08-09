// Server-only Supabase client. Uses the service_role key, which bypasses
// RLS — this app has no user auth, so the server is the only trusted writer.
// Never import this from client-side code (src/).

import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const localEnv = fileURLToPath(new URL("../.env.local", import.meta.url));
if ((!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) && existsSync(localEnv)) {
  loadEnvFile(localEnv);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

export const supabase = createClient(url, key);
