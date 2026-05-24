import { neon, neonConfig, Pool } from '@neondatabase/serverless'
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http'
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless'
import * as schema from './schema.js'

/**
 * Neon dual-driver setup:
 * - `db`     → HTTP driver, used for all normal queries (fast, no cold-start WS overhead)
 * - `dbPool` → WebSocket Pool driver, used only inside db.transaction() calls
 *
 * DATABASE_URL must be set in Vercel environment variables:
 *   postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
 */

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL environment variable is not set. ' +
    'Add it in Vercel → Project → Settings → Environment Variables.',
  )
}

// HTTP driver — for all regular queries
const sql = neon(process.env.DATABASE_URL)
export const db = drizzleHttp(sql, { schema })

// WebSocket Pool driver — for transactions only
// ws polyfill is required in Node.js environments (not needed in edge/browser)
if (typeof WebSocket === 'undefined') {
  try {
    const { default: ws } = await import('ws')
    neonConfig.webSocketConstructor = ws
  } catch {
    // ws not available — Pool/transactions won't work, but HTTP queries will
    console.warn('[db] ws package not found; dbPool transactions are unavailable')
  }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
export const dbPool = drizzleWs(pool, { schema })

export * from './schema.js'
