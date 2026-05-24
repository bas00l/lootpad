/**
 * Server-side error wrapper for TanStack Start server functions.
 *
 * TanStack Start serialises a thrown Error on the client as:
 *   { status: 500, statusMessage: "<original message>", message: "HTTPError" }
 *
 * So the real message lives in `e.statusMessage`, NOT `e.message`.
 * This wrapper simply re-throws with a clean Error — no external deps needed.
 */

export async function withServerError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    // Already structured (e.g. thrown by us in a nested call) — pass through
    if (err instanceof ServerError) throw err

    const message = err instanceof Error ? err.message : String(err)
    throw new ServerError(message)
  }
}

export class ServerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerError'
  }
}
