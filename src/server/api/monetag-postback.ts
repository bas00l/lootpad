/**
 * Monetag server-side postback endpoint.
 *
 * Monetag sends a GET request to this URL when an ad event is confirmed.
 * Configure in Monetag SSP → SDK Zone → Postback URL:
 *
 *   https://your-vercel-domain.com/api/monetag-postback?ymid={ymid}&zone={zone_id}&event={event_type}&value={reward_event_type}&amount={estimated_price}
 *
 * Security: requests are validated against MONETAG_POSTBACK_SECRET env var.
 * Set a shared secret in both Monetag dashboard and Vercel env vars.
 *
 * Docs: https://docs.monetag.com/docs/postbacks/configuration/
 */

import { defineEventHandler, getQuery, sendNoContent, createError } from 'h3'
import { db, users } from '../../../db/index.js'
import { eq, sql } from 'drizzle-orm'

// XP and spins granted per confirmed ad postback — same as earnSpinsFromAd
const POSTBACK_SPINS = 1
const POSTBACK_XP    = 10
// Minimum ms between postback rewards for the same user (server-side dedup)
const POSTBACK_COOLDOWN_MS = 25_000  // 25s — slightly under the 30s client cooldown

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  // ── 1. Parse params ──────────────────────────────────────────────────────
  const ymid              = String(query.ymid              ?? '').trim()
  const rewardEventType   = String(query.value             ?? '').trim()  // 'valued' | 'non_valued'
  const zoneId            = String(query.zone              ?? '').trim()
  const eventType         = String(query.event             ?? '').trim()
  const secret            = String(query.secret            ?? '').trim()

  // ── 2. Validate secret ───────────────────────────────────────────────────
  const expectedSecret = process.env.MONETAG_POSTBACK_SECRET
  if (expectedSecret && secret !== expectedSecret) {
    console.warn('[monetag-postback] invalid secret from zone', zoneId)
    // Return 200 anyway — Monetag retries on non-200, we don't want retry spam
    return sendNoContent(event, 200)
  }

  // ── 3. Only reward 'valued' events ──────────────────────────────────────
  // 'valued' = monetized impression; 'non_valued' = no fill / no revenue
  if (rewardEventType !== 'valued') {
    console.info(`[monetag-postback] non-valued event for ymid=${ymid}, skipping reward`)
    return sendNoContent(event, 200)
  }

  // ── 4. ymid must be a valid user identifier ──────────────────────────────
  if (!ymid) {
    console.warn('[monetag-postback] missing ymid')
    return sendNoContent(event, 200)
  }

  try {
    // ── 5. Look up user ────────────────────────────────────────────────────
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, ymid))
      .limit(1)

    if (!userRows.length) {
      console.warn(`[monetag-postback] user not found: ymid=${ymid}`)
      return sendNoContent(event, 200)
    }

    const user = userRows[0]

    if (user.isBanned) {
      console.warn(`[monetag-postback] banned user: ymid=${ymid}`)
      return sendNoContent(event, 200)
    }

    // ── 6. Idempotency / cooldown check ────────────────────────────────────
    // Use lastAdWatchAt as the dedup field — same as the client-side ad flow.
    // This means a Monetag postback and an Adsgram client reward share the
    // same cooldown window, preventing double-rewarding from both paths.
    if (user.lastAdWatchAt) {
      const elapsed = Date.now() - user.lastAdWatchAt.getTime()
      if (elapsed < POSTBACK_COOLDOWN_MS) {
        console.info(`[monetag-postback] cooldown active for ymid=${ymid}, ${Math.ceil((POSTBACK_COOLDOWN_MS - elapsed) / 1000)}s remaining`)
        // Return 200 so Monetag doesn't retry — this is intentional dedup
        return sendNoContent(event, 200)
      }
    }

    // ── 7. Grant reward ────────────────────────────────────────────────────
    const newXP    = user.xp + POSTBACK_XP
    const newLevel = Math.max(user.level, Math.floor(Math.sqrt(newXP / 100)) + 1)

    await db
      .update(users)
      .set({
        spinsAvailable: sql`${users.spinsAvailable} + ${POSTBACK_SPINS}`,
        xp:             newXP,
        level:          newLevel,
        adsWatched:     sql`${users.adsWatched} + 1`,
        lastAdWatchAt:  new Date(),
        updatedAt:      new Date(),
      })
      .where(eq(users.id, user.id))

    console.info(`[monetag-postback] rewarded ymid=${ymid} zone=${zoneId} +${POSTBACK_SPINS} spin +${POSTBACK_XP} XP`)

    return sendNoContent(event, 200)

  } catch (err) {
    // Log but always return 200 — we don't want Monetag retry floods on DB errors
    console.error('[monetag-postback] DB error:', err)
    return sendNoContent(event, 200)
  }
})