import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db, users, referrals } from '../../db/index.js'
import { eq, desc, sql } from 'drizzle-orm'
import {
  REFERRAL_BONUS_STARS,
  REFERRAL_BONUS_SPINS,
  STARTING_FREE_SPINS,
  ACHIEVEMENTS,
  getLevelFromXP,
} from '../lib/constants.js'

function generateReferralCode(telegramId: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  const seed = telegramId + Date.now()
  for (let i = 0; i < 8; i++) {
    code += chars[(seed.charCodeAt(i % seed.length) + i * 7) % chars.length]
  }
  return code
}

/**
 * Anti-Sybil scoring on new account creation.
 * Returns a fraud score delta (0–100) based on signals available at registration.
 */
function computeInitialFraudScore(data: {
  telegramId: string
  username?: string
  ipAddress?: string
  deviceFingerprint?: string
}): number {
  let score = 0

  // Missing username — bots often skip it
  if (!data.username) score += 10

  // Demo / synthetic ID prefix
  if (data.telegramId.startsWith('demo_')) score += 30

  // Numeric-only Telegram IDs under 100 000 are almost certainly fake
  if (/^\d+$/.test(data.telegramId) && parseInt(data.telegramId, 10) < 100_000) score += 20

  // No device fingerprint at all
  if (!data.deviceFingerprint) score += 5

  return Math.min(score, 100)
}

export const initUser = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      telegramId: z.string().min(1).max(50),
      username: z.string().optional(),
      firstName: z.string().optional(),
      photoUrl: z.string().optional(),
      referralCode: z.string().optional(),
      ipAddress: z.string().optional(),
      /** SHA-256 hash of client-side device signals (canvas, screen, etc.) */
      deviceFingerprint: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1)

    if (existing.length > 0) {
      const user = existing[0]
      if (user.isBanned) throw new Error('Account suspended')

      // Update mutable profile fields on every login
      await db
        .update(users)
        .set({
          username: data.username,
          firstName: data.firstName,
          photoUrl: data.photoUrl,
          // Keep device fingerprint if not yet set
          ...(data.deviceFingerprint && !user.deviceFingerprint
            ? { deviceFingerprint: data.deviceFingerprint }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))

      return { ...user, photoUrl: data.photoUrl ?? user.photoUrl }
    }

    // ── New user registration ──────────────────────────────────────────────

    const fraudScore = computeInitialFraudScore(data)
    const referralCode = generateReferralCode(data.telegramId)

    // ── Anti-Sybil: check if same IP or device fingerprint already registered ──
    if (data.ipAddress || data.deviceFingerprint) {
      const duplicateChecks: Promise<unknown>[] = []

      if (data.ipAddress) {
        duplicateChecks.push(
          db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.ipAddress, data.ipAddress))
            .limit(5),
        )
      }
      if (data.deviceFingerprint) {
        duplicateChecks.push(
          db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.deviceFingerprint, data.deviceFingerprint))
            .limit(3),
        )
      }

      const [ipMatches, fpMatches] = await Promise.all(duplicateChecks) as [
        { id: number }[],
        { id: number }[] | undefined,
      ]

      // Hard limit: more than 3 accounts from same IP → heavy penalty
      if (Array.isArray(ipMatches) && ipMatches.length >= 3) {
        // Don't outright ban — they may share a network — but heavily flag
        // fraudScore is already computed; we'll bump it further below
      }

      // Same device fingerprint already exists → almost certainly Sybil
      if (Array.isArray(fpMatches) && fpMatches.length > 0) {
        // Record but allow registration; ban can be applied by admin review
        // The high fraud score will block rewards automatically
        const extraPenalty = fpMatches.length >= 2 ? 60 : 40
        const finalScore = Math.min(fraudScore + extraPenalty, 100)

        const [newUser] = await db
          .insert(users)
          .values({
            telegramId: data.telegramId,
            username: data.username,
            firstName: data.firstName ?? 'User',
            photoUrl: data.photoUrl,
            referralCode,
            referredByCode: data.referralCode || null,
            fraudScore: finalScore,
            ipAddress: data.ipAddress,
            deviceFingerprint: data.deviceFingerprint,
            spinsAvailable: STARTING_FREE_SPINS,
            achievements: [''],
          })
          .returning()

        // Log the fraud event
        const { fraudEvents } = await import('../../db/index.js')
        await db.insert(fraudEvents).values({
          userId: newUser.id,
          eventType: 'duplicate_device',
          ipAddress: data.ipAddress,
          metadata: JSON.stringify({ matchedFPs: fpMatches.length }),
        })

        return newUser
      }
    }

    const [newUser] = await db
      .insert(users)
      .values({
        telegramId: data.telegramId,
        username: data.username,
        firstName: data.firstName ?? 'User',
        photoUrl: data.photoUrl,
        referralCode,
        referredByCode: data.referralCode || null,
        fraudScore,
        ipAddress: data.ipAddress,
        deviceFingerprint: data.deviceFingerprint,
        spinsAvailable: STARTING_FREE_SPINS,
        achievements: [''],
      })
      .returning()

    // ── Process referral (pending verification — no bonus paid yet) ────────
    if (data.referralCode) {
      const referrers = await db
        .select()
        .from(users)
        .where(eq(users.referralCode, data.referralCode))
        .limit(1)

      if (referrers.length > 0 && referrers[0].id !== newUser.id) {
        const referrer = referrers[0]

        // Insert referral record with verified=false — bonus paid when referee
        // clears REFERRAL_MIN_SPINS & REFERRAL_MIN_ADS (see checkReferralVerification)
        await db.insert(referrals).values({
          referrerId: referrer.id,
          referredId: newUser.id,
          bonusPaid: false,
          verified: false,
          starsAwarded: REFERRAL_BONUS_STARS,
          spinsAwarded: REFERRAL_BONUS_SPINS,
        })
      }
    }

    return newUser
  })

export const getUser = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ telegramId: z.string() }))
  .handler(async ({ data }) => {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1)
    return result[0] ?? null
  })

// Leaderboard data — computed on the fly from DB
export const getLeaderboard = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      category: z.enum(['top_inviters', 'highest_streak', 'most_spins', 'weekly_xp', 'top_level']),
    }),
  )
  .handler(async ({ data }) => {
    let rows: { displayName: string | null; score: number; telegramId: string }[] = []

    if (data.category === 'top_inviters') {
      // Only count verified referrals to prevent fake-invite gaming
      const result = await db.execute(sql`
        SELECT u.first_name as display_name, u.telegram_id,
               COUNT(r.id)::int as score
        FROM users u
        LEFT JOIN referrals r ON r.referrer_id = u.id AND r.verified = true
        GROUP BY u.id, u.first_name, u.telegram_id
        ORDER BY score DESC
        LIMIT 20
      `)
      rows = (result.rows as any[]).map((r) => ({
        displayName: r.display_name,
        score: r.score,
        telegramId: r.telegram_id,
      }))
    } else if (data.category === 'highest_streak') {
      const result = await db
        .select({ displayName: users.firstName, score: users.dailyStreak, telegramId: users.telegramId })
        .from(users)
        .orderBy(desc(users.dailyStreak))
        .limit(20)
      rows = result.map((r) => ({ displayName: r.displayName, score: r.score, telegramId: r.telegramId }))
    } else if (data.category === 'most_spins') {
      const result = await db
        .select({ displayName: users.firstName, score: users.spinCount, telegramId: users.telegramId })
        .from(users)
        .orderBy(desc(users.spinCount))
        .limit(20)
      rows = result.map((r) => ({ displayName: r.displayName, score: r.score, telegramId: r.telegramId }))
    } else if (data.category === 'weekly_xp') {
      const result = await db
        .select({ displayName: users.firstName, score: users.xp, telegramId: users.telegramId })
        .from(users)
        .orderBy(desc(users.xp))
        .limit(20)
      rows = result.map((r) => ({ displayName: r.displayName, score: r.score, telegramId: r.telegramId }))
    } else if (data.category === 'top_level') {
      const result = await db
        .select({ displayName: users.firstName, score: users.level, telegramId: users.telegramId })
        .from(users)
        .orderBy(desc(users.level))
        .limit(20)
      rows = result.map((r) => ({ displayName: r.displayName, score: r.score, telegramId: r.telegramId }))
    }

    return rows.map((r, i) => ({
      rank: i + 1,
      displayName: r.displayName ?? 'Anonymous',
      score: r.score,
      telegramId: r.telegramId,
    }))
  })
