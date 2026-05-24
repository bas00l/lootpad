import { neon, neonConfig, Pool } from '@neondatabase/serverless'
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http'
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless'
import * as schema from './schema.js'

/**
 * Neon dual-driver setup:
 * - `db`     → HTTP driver, used for all normal queries (fast, no cold-start WS overhead)
 * - `dbPool` → WebSocket Pool driver, used only inside db.transaction() calls
 *
 * In your server functions, use `dbPool` when you need transactions:
 *   await dbPool.transaction(async (tx) => { ... })
 *
 * DATABASE_URL format:
 *   postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
 */

// HTTP driver — for all regular queries
const sql = neon(process.env.DATABASE_URL!)
export const db = drizzleHttp(sql, { schema })

// WebSocket Pool driver — for transactions only
// ws constructor is conditionally loaded so it doesn't break browser/edge bundles
if (typeof WebSocket === 'undefined') {
  const { default: ws } = await import('ws')
  neonConfig.webSocketConstructor = ws
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL! })
export const dbPool = drizzleWs(pool, { schema })

export * from './schema.js'
