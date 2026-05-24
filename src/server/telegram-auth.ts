/**
 * Server-side Telegram WebApp initData validation.
 *
 * Telegram signs the initData payload with a secret derived from your bot token.
 * We validate the HMAC-SHA256 signature before trusting any user data.
 *
 * Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Usage in a server function:
 *   const telegramId = await validateTelegramInitData(data.initData)
 *   // telegramId is the verified Telegram user ID (string)
 */

import { createHmac, createHash, timingSafeEqual } from 'node:crypto'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

/**
 * Validates Telegram initData and returns the verified telegramId.
 *
 * Throws if:
 *  - TELEGRAM_BOT_TOKEN env var is missing
 *  - initData is empty or missing the hash field
 *  - The HMAC signature doesn't match (tampered or replayed data)
 *  - The auth_date is older than MAX_AGE_SECONDS (prevents replay attacks)
 *  - No user object is present in the payload
 *
 * Returns the verified string telegramId.
 */
export function validateTelegramInitData(
  initData: string,
  maxAgeSeconds = 86_400, // 24 hours
): string {
  // In development without a bot token, allow demo_ IDs through.
  // Never skip in production.
  if (!BOT_TOKEN) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured')
    }
    // Dev fallback: parse without validation
    const params = new URLSearchParams(initData)
    const userStr = params.get('user')
    if (userStr) {
      const u = JSON.parse(userStr)
      return String(u.id)
    }
    // Allow demo_ IDs that come directly (non-initData path)
    return initData
  }

  const params = new URLSearchParams(initData)
  const receivedHash = params.get('hash')
  if (!receivedHash) throw new Error('Missing hash in initData')

  // Build the data-check string: all fields except hash, sorted, joined by \n
  params.delete('hash')
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  // Derive secret key: HMAC-SHA256("WebAppData", botToken)
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()

  // Compute expected hash
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  // Timing-safe comparison
  const expected = Buffer.from(expectedHash, 'hex')
  const received = Buffer.from(receivedHash, 'hex')
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error('Invalid Telegram initData signature')
  }

  // Check auth_date freshness
  const authDate = parseInt(params.get('auth_date') ?? '0', 10)
  if (Date.now() / 1000 - authDate > maxAgeSeconds) {
    throw new Error('Telegram initData has expired')
  }

  // Extract user ID
  const userStr = params.get('user')
  if (!userStr) throw new Error('No user in initData')
  const user = JSON.parse(userStr)
  return String(user.id)
}
