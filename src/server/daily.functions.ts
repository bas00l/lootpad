import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db, users, tokenBalances } from '../../db/index.js'
import { eq, sql } from 'drizzle-orm'
import { DAILY_REWARD_STARS, TOKENS, TOKEN_KEYS, ACHIEVEMENTS, getLevelFromXP } from '../lib/constants.js'

function isSameDay(d1: Date, d2: Date) {
  return (
    d1.getUTCFullYear() === d2.getUTCFullYear() &&
    d1.getUTCMonth()    === d2.getUTCMonth()    &&
    d1.getUTCDate()     === d2.getUTCDate()
  )
}

function wasYesterday(d: Date, now: Date) {
  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  return isSameDay(d, yesterday)
}

export const claimDailyReward = createServerFn({ method: 'POST' })
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

    const now = new Date()

    if (user.lastDailyAt && isSameDay(user.lastDailyAt, now)) {
      const nextClaim = new Date(user.lastDailyAt)
      nextClaim.setUTCDate(nextClaim.getUTCDate() + 1)
      const remaining = Math.ceil((nextClaim.getTime() - now.getTime()) / 1000)
      throw new Error(`ALREADY_CLAIMED:${remaining}`)
    }

    let newStreak = 1
    if (user.lastDailyAt && wasYesterday(user.lastDailyAt, now)) {
      newStreak = user.dailyStreak + 1
    }

    const streakIndex = Math.min(newStreak - 1, DAILY_REWARD_STARS.length - 1)
    const starsReward  = DAILY_REWARD_STARS[streakIndex]
    // XP scales with streak: 20 base + 5 per day
    const xpReward     = 20 + (newStreak - 1) * 5

    // Only grant a token bonus on streak milestones — daily micro-amounts are unprofitable
    const BONUS_MILESTONES = new Set([3, 7, 14, 30])
    const grantBonus = BONUS_MILESTONES.has(newStreak)
    const bonusToken  = grantBonus ? TOKEN_KEYS[newStreak % TOKEN_KEYS.length] : TOKEN_KEYS[0]
    const bonusAmount = grantBonus ? TOKENS[bonusToken].minReward * 5 : 0

    const newXP    = user.xp + xpReward
    const newLevel = getLevelFromXP(newXP)

    // Check streak achievements
    const achievements = [...(user.achievements ?? []).filter(Boolean)]
    if (newStreak >= 3  && !achievements.includes('streak_3'))  achievements.push('streak_3')
    if (newStreak >= 7  && !achievements.includes('streak_7'))  achievements.push('streak_7')
    if (newStreak >= 30 && !achievements.includes('streak_30')) achievements.push('streak_30')
    const achievementXP = achievements
      .filter(id => !(user.achievements ?? []).includes(id))
      .reduce((s, id) => s + (ACHIEVEMENTS[id as keyof typeof ACHIEVEMENTS]?.xp ?? 0), 0)

    await db
      .update(users)
      .set({
        stars:        user.stars + starsReward,
        xp:           newXP + achievementXP,
        level:        newLevel,
        dailyStreak:  newStreak,
        lastDailyAt:  now,
        achievements,
        updatedAt:    now,
      })
      .where(eq(users.id, user.id))

    if (grantBonus && bonusAmount > 0) {
      await db
        .insert(tokenBalances)
        .values({ userId: user.id, token: bonusToken, amount: String(bonusAmount) })
        .onConflictDoUpdate({
          target: [tokenBalances.userId, tokenBalances.token],
          set: {
            amount:    sql`${tokenBalances.amount} + ${String(bonusAmount)}`,
            updatedAt: new Date(),
          },
        })
    }

    return {
      starsReward,
      xpReward,
      newStreak,
      newStars:  user.stars + starsReward,
      newXP:     newXP + achievementXP,
      newLevel,
      bonusToken,
      bonusAmount,
      newAchievements: achievements.filter(id => !(user.achievements ?? []).includes(id)),
    }
  })

export const getDailyStatus = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ telegramId: z.string() }))
  .handler(async ({ data }) => {
    const userRows = await db
      .select({ lastDailyAt: users.lastDailyAt, dailyStreak: users.dailyStreak })
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1)

    if (!userRows.length) return { canClaim: true, streak: 0, nextClaimIn: 0 }
    const { lastDailyAt, dailyStreak } = userRows[0]
    const now = new Date()

    if (!lastDailyAt) return { canClaim: true, streak: 0, nextClaimIn: 0 }

    if (isSameDay(lastDailyAt, now)) {
      const next = new Date(lastDailyAt)
      next.setUTCDate(next.getUTCDate() + 1)
      return {
        canClaim:    false,
        streak:      dailyStreak,
        nextClaimIn: Math.ceil((next.getTime() - now.getTime()) / 1000),
      }
    }

    const streakBroken = !wasYesterday(lastDailyAt, now)
    return { canClaim: true, streak: streakBroken ? 0 : dailyStreak, nextClaimIn: 0 }
  })
