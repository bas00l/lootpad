import { defineConfig } from 'drizzle-kit'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// drizzle-kit runs as a standalone CLI and only auto-loads `.env` — not `.env.local`.
// We manually parse .env.local (preferred) or .env so DATABASE_URL is always available
// without needing dotenv-cli or any wrapper tool.
function loadEnvLocal() {
  for (const filename of ['.env.local', '.env']) {
    const filepath = resolve(process.cwd(), filename)
    if (!existsSync(filepath)) continue
    const content = readFileSync(filepath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
      // Don't overwrite vars already in the environment (e.g. set by CI/Vercel)
      if (!(key in process.env)) {
        process.env[key] = val
      }
    }
    break // stop after first file found
  }
}

loadEnvLocal()

if (!process.env.DATABASE_URL) {
  console.error(`
  ❌  DATABASE_URL is not set.

  Create a .env.local file in the project root:

    DATABASE_URL=postgresql://user:pass@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require

  Get this from: https://console.neon.tech
    → your project → Connection Details → Pooled connection string
`)
  process.exit(1)
}

export default defineConfig({
  dialect: 'postgresql',
  schema:  './db/schema.ts',
  out:     './drizzle/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
})
