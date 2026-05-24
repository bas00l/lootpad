import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db, dbPool, users, tokenBalances, spinHistory, activityFeed, tokenSinkLedger, referrals } from '../../db/index.js'
import { eq, sql, and } from 'drizzle-orm'
import {
  TOKENS,
  TOKEN_KEYS,
  SPIN_COOLDOWN_MS,
  SPIN_STARS_REWARD,
  SPIN_XP_REWARD,
  FAKE_NAMES,
  RARITY_TIERS,
  ACHIEVEMENTS,
  getLevelFromXP,
  AD_COOLDOWN_MS,
  AD_WATCH_SPINS,
  AD_WATCH_XP,
  MIN_ACTIVITY_SPINS,
  MIN_ACTIVITY_ADS,
  MIN_ACCOUNT_AGE_MS,
  HOUSE_EV_MULTIPLIER,
  EV_MULTIPLIER_MIN,
  EV_MULTIPLIER_MAX,
  SPIN_BOOST_COST_STARS,
  LUCKY_CHARM_COST_STARS,
  WITHDRAWAL_STAR_FEE_PCT,
  FRAUD_SOFT_BLOCK_SCORE,
  FRAUD_HARD_BLOCK_SCORE,
  REFERRAL_MIN_SPINS,
  REFERRAL_MIN_ADS,
  REFERRAL_BONUS_STARS,
  REFERRAL_BONUS_SPINS,
} from '../lib/constants.js'
import type { Rarity } from '../lib/constants.js'

// ── Rarity / token helpers ───────────────────────────────────────────────────

function pickRarity(evMult: number): Rarity {
  // evMult < 1 pushes toward common; evMult > 1 pushes toward better rarities
  const roll = Math.random() * 100
  let cumulative = 0
  // We scale the non-common chances by evMult, keeping common as the remainder
  const tiers = Object.entries(RARITY_TIERS) as [Rarity, (typeof RARITY_TIERS)[Rarity]][]
  const totalNonCommon = tiers
    .filter(([k]) => k !== 'common')
    .reduce((s, [, t]) => s + t.chance, 0)
  const scaledNonCommon = Math.min(totalNonCommon * evMult, 99) // cap at 99%
  const commonChance = 100 - scaledNonCommon

  for (const [key, tier] of tiers) {
    const chance = key === 'common' ? commonChance : tier.chance * evMult
    cumulative += chance
    if (roll < cumulative) return key
  }
  return 'common'
}

function weightedRandomToken() {
  const totalWeight = TOKEN_KEYS.reduce((sum, k) => sum + TOKENS[k].weight, 0)
  let rand = Math.random() * totalWeight
  for (const key of TOKEN_KEYS) {
    rand -= TOKENS[key].weight
    if (rand <= 0) return key
  }
  return TOKEN_KEYS[0]
}

/**
 * Compute a reward amount, clamped by the combined house + per-user EV multiplier.
 * evMult is already the product of HOUSE_EV_MULTIPLIER × user.evMultiplier.
 */
function randomReward(token: keyof typeof TOKENS, rarityMultiplier: number, evMult: number): number {
  const cfg = TOKENS[token]
  const clampedEV = Math.max(EV_MULTIPLIER_MIN, Math.min(EV_MULTIPLIER_MAX, evMult))
  const raw = (cfg.minReward + Math.random() * (cfg.maxReward - cfg.minReward)) * rarityMultiplier * clampedEV
  return Math.round(raw * 1e8) / 1e8
}

// ── Achievement helper ───────────────────────────────────────────────────────

async function checkAndGrantAchievements(
  user: { id: number; spinCount: number; dailyStreak: number; achievements: string[]; xp: number; level: number },
  rarity: Rarity,
): Promise<string[]> {
  const granted: string[] = []
  const has = (id: string) => user.achievements.includes(id)

  if (!has('first_spin') && user.spinCount >= 1)     granted.push('first_spin')
  if (!has('spin_10')    && user.spinCount >= 10)    granted.push('spin_10')
  if (!has('spin_100')   && user.spinCount >= 100)   granted.push('spin_100')
  if (rarity === 'legendary' && !has('legendary_spin')) granted.push('legendary_spin')
  if (!has('level_5')  && user.level >= 5)           granted.push('level_5')
  if (!has('level_10') && user.level >= 10)          granted.push('level_10')

  if (granted.length > 0) {
    const newAchievements = [...user.achievements, ...granted]
    const bonusXP = granted.reduce((s, id) => s + (ACHIEVEMENTS[id as keyof typeof ACHIEVEMENTS]?.xp ?? 0), 0)
    await db
      .update(users)
      .set({ achievements: newAchievements, xp: user.xp + bonusXP, updatedAt: new Date() })
      .where(eq(users.id, user.id))
  }
  return granted
}

// ── Minimum-activity check (shared gate) ─────────────────────────────────────

export function meetsMinimumActivity(user: {
  spinCount: number
  adsWatched: number
  createdAt: Date | null
}): { ok: boolean; reason?: string } {
  const age = Date.now() - (user.createdAt?.getTime() ?? 0)
  if (age < MIN_ACCOUNT_AGE_MS) {
    const waitSecs = Math.ceil((MIN_ACCOUNT_AGE_MS - age) / 1000)
    return { ok: false, reason: `ACCOUNT_TOO_NEW:${waitSecs}` }
  }
  if (user.spinCount < MIN_ACTIVITY_SPINS) {
    return { ok: false, reason: `NEED_MORE_SPINS:${MIN_ACTIVITY_SPINS - user.spinCount}` }
  }
  if (user.adsWatched < MIN_ACTIVITY_ADS) {
    return { ok: false, reason: `NEED_AD_WATCH:${MIN_ACTIVITY_ADS - user.adsWatched}` }
  }
  return { ok: true }
}

// ── spinWheel ────────────────────────────────────────────────────────────────

export const spinWheel = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      telegramId: z.string(),
      /** Optional: user wants to use a pre-purchased Spin Boost this spin */
      useSpinBoost: z.boolean().optional(),
      /** Optional: user wants to use a pre-purchased Lucky Charm this spin */
      useLuckyCharm: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1)

    if (!userRows.length) throw new Error('User not found')
    const user = userRows[0]
    if (user.isBanned) throw new Error('Account suspended')
    if (user.fraudScore > FRAUD_HARD_BLOCK_SCORE) throw new Error('Account flagged for review')

    // ── Spin availability gate ───────────────────────────────────────────
    if (user.spinsAvailable <= 0) {
      if (user.lastSpinAt) {
        const elapsed = Date.now() - user.lastSpinAt.getTime()
        if (elapsed < SPIN_COOLDOWN_MS) {
          const remaining = Math.ceil((SPIN_COOLDOWN_MS - elapsed) / 1000)
          throw new Error(`NO_SPINS:${remaining}`)
        }
        // Cooldown passed — silent grace spin
      } else {
        throw new Error('NO_SPINS:0')
      }
    }

    // ── Apply Spin Boost / Lucky Charm effects ───────────────────────────
    // Boosts and charms are purchased via purchaseSpinBoost/purchaseLuckyCharm
    // (which already deduct stars and log the sink). spinWheel only applies
    // the effect — it does NOT charge again to prevent double-billing.
    const boostActive = !!data.useSpinBoost
    const charmActive = !!data.useLuckyCharm

    // ── Server-side EV control ───────────────────────────────────────────
    const userEVMult = parseFloat((user as any).evMultiplier ?? '1.00')
    const effectiveEV = HOUSE_EV_MULTIPLIER * Math.max(EV_MULTIPLIER_MIN, Math.min(EV_MULTIPLIER_MAX, userEVMult))

    // ── Resolve outcome ──────────────────────────────────────────────────
    let rarity = pickRarity(effectiveEV)

    // Lucky Charm: upgrade rarity one step (can't exceed legendary)
    if (charmActive) {
      const rarityOrder: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']
      const idx = rarityOrder.indexOf(rarity)
      if (idx < rarityOrder.length - 1) rarity = rarityOrder[idx + 1]
    }

    const rarityTier = RARITY_TIERS[rarity]
    const token = weightedRandomToken()
    const boostMult = boostActive ? 2 : 1
    const amount = randomReward(token, rarityTier.multiplier * boostMult, effectiveEV)
    const starsEarned = SPIN_STARS_REWARD
    const xpEarned = SPIN_XP_REWARD + rarityTier.xpBonus

    const newXP = user.xp + xpEarned
    const newLevel = getLevelFromXP(newXP)
    const leveledUp = newLevel > user.level
    const newSpins = Math.max(0, user.spinsAvailable - 1)

    // ── Write results (wrapped in a transaction for atomicity) ──────────
    // This prevents partial writes if a concurrent request or network failure
    // occurs mid-spin (e.g. balance credited but spins not decremented).
    await dbPool.transaction(async (tx) => {
      await tx
        .insert(tokenBalances)
        .values({ userId: user.id, token, amount: String(amount) })
        .onConflictDoUpdate({
          target: [tokenBalances.userId, tokenBalances.token],
          set: {
            amount: sql`${tokenBalances.amount} + ${String(amount)}`,
            updatedAt: new Date(),
          },
        })

      await tx
        .update(users)
        .set({
          stars: user.stars + starsEarned,  // boost/charm costs already deducted by purchaseX calls
          xp: newXP,
          level: newLevel,
          lastSpinAt: new Date(),
          spinCount: user.spinCount + 1,
          spinsAvailable: newSpins,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))

      await tx.insert(spinHistory).values({
        userId: user.id,
        token,
        amount: String(amount),
        starsEarned,
        xpEarned,
        rarity,
      })

      // Live feed
      const name = user.firstName ?? FAKE_NAMES[Math.floor(Math.random() * FAKE_NAMES.length)]
      const rarityLabel = rarity !== 'common' ? ` [${rarityTier.label}]` : ''
      await tx.insert(activityFeed).values({
        displayText: `${name} won ${TOKENS[token].emoji} ${token}${rarityLabel}`,
        token,
        rarity,
        isFake: false,
      })
    })

    const newAchievements = await checkAndGrantAchievements(
      { ...user, spinCount: user.spinCount + 1, level: newLevel, xp: newXP },
      rarity,
    )

    return {
      token,
      amount,
      starsEarned,
      xpEarned,
      rarity,
      newStars: user.stars + starsEarned,
      newXP,
      newLevel,
      leveledUp,
      spinsRemaining: newSpins,
      newAchievements,
      boostUsed: boostActive,
      charmUsed: charmActive,
    }
  })

// ── getSpinStatus ────────────────────────────────────────────────────────────

export const getSpinStatus = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ telegramId: z.string() }))
  .handler(async ({ data }) => {
    const userRows = await db
      .select({
        lastSpinAt: users.lastSpinAt,
        spinsAvailable: users.spinsAvailable,
        spinCount: users.spinCount,
        adsWatched: users.adsWatched,
        createdAt: users.createdAt,
        lastAdWatchAt: users.lastAdWatchAt,
      })
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1)

    if (!userRows.length) return { canSpin: true, spinsAvailable: 3, cooldownRemaining: 0, adCooldownRemaining: 0 }
    const u = userRows[0]

    const adCooldownRemaining = u.lastAdWatchAt
      ? Math.max(0, Math.ceil((AD_COOLDOWN_MS - (Date.now() - u.lastAdWatchAt.getTime())) / 1000))
      : 0

    if (u.spinsAvailable > 0) return { canSpin: true, spinsAvailable: u.spinsAvailable, cooldownRemaining: 0, adCooldownRemaining }

    if (!u.lastSpinAt) return { canSpin: false, spinsAvailable: 0, cooldownRemaining: 0, adCooldownRemaining }
    const elapsed = Date.now() - u.lastSpinAt.getTime()
    const remaining = Math.max(0, Math.ceil((SPIN_COOLDOWN_MS - elapsed) / 1000))
    return { canSpin: false, spinsAvailable: 0, cooldownRemaining: remaining, adCooldownRemaining }
  })

// ── earnSpinsFromAd ──────────────────────────────────────────────────────────

export const earnSpinsFromAd = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ telegramId: z.string() }))
  .handler(async ({ data }) => {
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1)

    if (!userRows.length) throw new Error('User not found')
    const user = userRows[0]
    if (user.isBanned) throw new Error('Account suspended')

    // ── 30-second ad cooldown ────────────────────────────────────────────
    if (user.lastAdWatchAt) {
      const elapsed = Date.now() - user.lastAdWatchAt.getTime()
      if (elapsed < AD_COOLDOWN_MS) {
        const remaining = Math.ceil((AD_COOLDOWN_MS - elapsed) / 1000)
        throw new Error(`AD_COOLDOWN:${remaining}`)
      }
    }

    // ── Soft fraud block ─────────────────────────────────────────────────
    if (user.fraudScore >= FRAUD_SOFT_BLOCK_SCORE) {
      throw new Error('Account under review — ad rewards temporarily paused')
    }

    const newXP = user.xp + AD_WATCH_XP
    const newLevel = getLevelFromXP(newXP)
    const newAdsWatched = (user.adsWatched ?? 0) + 1

    await db
      .update(users)
      .set({
        spinsAvailable: user.spinsAvailable + AD_WATCH_SPINS,
        xp: newXP,
        level: newLevel,
        adsWatched: newAdsWatched,
        lastAdWatchAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))

    // ── Check whether this ad watch completes referral verification ──────
    await checkReferralVerification(user.id, { spinCount: user.spinCount, adsWatched: newAdsWatched })

    return {
      spinsAdded: AD_WATCH_SPINS,
      newSpinsAvailable: user.spinsAvailable + AD_WATCH_SPINS,
      xpEarned: AD_WATCH_XP,
      newXP,
      newLevel,
      adsWatched: newAdsWatched,
    }
  })

// ── purchaseSpinBoost ─────────────────────────────────────────────────────────

export const purchaseSpinBoost = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ telegramId: z.string() }))
  .handler(async ({ data }) => {
    const userRows = await db.select().from(users).where(eq(users.telegramId, data.telegramId)).limit(1)
    if (!userRows.length) throw new Error('User not found')
    const user = userRows[0]
    if (user.isBanned) throw new Error('Account suspended')
    if (user.stars < SPIN_BOOST_COST_STARS) throw new Error(`NOT_ENOUGH_STARS:need ${SPIN_BOOST_COST_STARS}`)

    await db.update(users).set({
      stars: user.stars - SPIN_BOOST_COST_STARS,
      totalStarsSunk: user.totalStarsSunk + SPIN_BOOST_COST_STARS,
      updatedAt: new Date(),
    }).where(eq(users.id, user.id))

    await db.insert(tokenSinkLedger).values({
      userId: user.id,
      token: 'STARS',
      amountSunk: '0',
      starsSunk: SPIN_BOOST_COST_STARS,
      sinkType: 'spin_boost',
    })

    return { newStars: user.stars - SPIN_BOOST_COST_STARS, cost: SPIN_BOOST_COST_STARS }
  })

// ── purchaseLuckyCharm ────────────────────────────────────────────────────────

export const purchaseLuckyCharm = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ telegramId: z.string() }))
  .handler(async ({ data }) => {
    const userRows = await db.select().from(users).where(eq(users.telegramId, data.telegramId)).limit(1)
    if (!userRows.length) throw new Error('User not found')
    const user = userRows[0]
    if (user.isBanned) throw new Error('Account suspended')
    if (user.stars < LUCKY_CHARM_COST_STARS) throw new Error(`NOT_ENOUGH_STARS:need ${LUCKY_CHARM_COST_STARS}`)

    await db.update(users).set({
      stars: user.stars - LUCKY_CHARM_COST_STARS,
      totalStarsSunk: user.totalStarsSunk + LUCKY_CHARM_COST_STARS,
      updatedAt: new Date(),
    }).where(eq(users.id, user.id))

    await db.insert(tokenSinkLedger).values({
      userId: user.id,
      token: 'STARS',
      amountSunk: '0',
      starsSunk: LUCKY_CHARM_COST_STARS,
      sinkType: 'lucky_charm',
    })

    return { newStars: user.stars - LUCKY_CHARM_COST_STARS, cost: LUCKY_CHARM_COST_STARS }
  })

// ── Internal: verify referral after referee activity ─────────────────────────

async function checkReferralVerification(
  referredUserId: number,
  activity: { spinCount: number; adsWatched: number },
) {
  if (activity.spinCount < REFERRAL_MIN_SPINS || activity.adsWatched < REFERRAL_MIN_ADS) return

  // Find unverified referral record for this user
  const refRows = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.referredId, referredUserId), eq(referrals.verified, false)))
    .limit(1)

  if (!refRows.length) return
  const ref = refRows[0]

  // Double-check the referee really qualifies
  const refereeRows = await db
    .select({ spinCount: users.spinCount, adsWatched: users.adsWatched })
    .from(users)
    .where(eq(users.id, referredUserId))
    .limit(1)

  if (!refereeRows.length) return
  const referee = refereeRows[0]
  if ((referee.spinCount ?? 0) < REFERRAL_MIN_SPINS || (referee.adsWatched ?? 0) < REFERRAL_MIN_ADS) return

  // Pay referrer the pending bonus
  const referrerRows = await db.select().from(users).where(eq(users.id, ref.referrerId)).limit(1)
  if (!referrerRows.length) return
  const referrer = referrerRows[0]

  const newXP = referrer.xp + 30
  const newLevel = getLevelFromXP(newXP)

  // Check referral achievements
  // drizzleSql alias to avoid shadowing outer sql import
  const drizzleSql = sql
  const refCountRows = await db
    .select({ count: drizzleSql<number>`count(*)::int` })
    .from(referrals)
    .where(and(eq(referrals.referrerId, referrer.id), eq(referrals.verified, true)))
  const totalVerified = (refCountRows[0]?.count ?? 0) + 1

  const newAchievements = [...(referrer.achievements ?? [])]
  if (totalVerified >= 1  && !newAchievements.includes('referral_1'))  newAchievements.push('referral_1')
  if (totalVerified >= 5  && !newAchievements.includes('referral_5'))  newAchievements.push('referral_5')
  if (totalVerified >= 25 && !newAchievements.includes('referral_25')) newAchievements.push('referral_25')

  await db.update(users).set({
    stars: referrer.stars + REFERRAL_BONUS_STARS,
    spinsAvailable: referrer.spinsAvailable + REFERRAL_BONUS_SPINS,
    xp: newXP,
    level: newLevel,
    achievements: newAchievements,
  }).where(eq(users.id, referrer.id))

  // Mark referral verified and update referee stars
  await db.update(referrals).set({ verified: true, verifiedAt: new Date() }).where(eq(referrals.id, ref.id))
  await db.update(users).set({
    referralVerified: true,
    referralVerifiedAt: new Date(),
    stars: drizzleSql`${users.stars} + ${Math.floor(REFERRAL_BONUS_STARS / 2)}`,
  }).where(eq(users.id, referredUserId))
}
