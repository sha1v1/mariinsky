import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Dev-only: load .env.local into process.env so api/*.ts handlers (running
// as plain Node code via the local API plugin) can read Supabase/LLM keys.
// In production, Vercel injects env vars directly — this loader only fills
// in values that aren't already set, so it's a no-op there.
const envPath = fileURLToPath(new URL('./.env.local', import.meta.url))
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/world/',
  plugins: [react()],
})
