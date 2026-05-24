/**
 * Server-side error utilities for TanStack Start server functions.
 *
 * Problem: When a server function throws a plain Error, TanStack Start
 * serialises it as {"status":500,"unhandled":true,"message":"HTTPError"} on
 * the client — losing the real message completely.
 *
 * Solution: Wrap every handler body in `withServerError()` so any thrown
 * Error is re-thrown via `createError` from `vinxi/http`, which TanStack Start
 * knows how to forward to the client with the correct status + message.
 */
import { createError } from 'vinxi/http'

/**
 * Re-throws known application errors with a proper HTTP status so the client
 * receives the real message rather than a generic "HTTPError".
 *
 * Usage:
 *   .handler(({ data }) => withServerError(async () => {
 *     // your handler logic
 *   }))
 */
export async function withServerError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    // Already a vinxi/H3 error — pass through untouched
    if (err && typeof err === 'object' && '__is_error__' in err) throw err

    const message = err instanceof Error ? err.message : String(err)

    // Map known application error messages to appropriate HTTP status codes
    const status = message === 'User not found'        ? 404
      : message === 'Task not found'                   ? 404
      : message === 'Account suspended'                ? 403
      : message === 'Account flagged for review'       ? 403
      : message === 'Already completed'                ? 409
      : message.startsWith('NO_SPINS')                 ? 429
      : message.startsWith('AD_COOLDOWN')              ? 429
      : message.startsWith('NOT_ENOUGH_STARS')         ? 402
      : message.startsWith('TELEGRAM_BOT_TOKEN')       ? 500
      : message.startsWith('DATABASE_URL')             ? 500
      : 400

    throw createError({ statusCode: status, statusMessage: message })
  }
}
