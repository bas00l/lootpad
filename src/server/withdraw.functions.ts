import { withServerError } from './errors.js'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db, users, tokenBalances, withdrawals, tokenSinkLedger } from '../../db/index.js'
import { eq, and, desc } from 'drizzle-orm'
import {
  TOKENS,
  WITHDRAWAL_STAR_FEE_PCT,
  FRAUD_HARD_BLOCK_SCORE,
} from '../lib/constants.js'
import { meetsMinimumActivity } from './spin.functions.js'

export const getBalances = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ telegramId: z.string() }))
  .handler(({ data }) => withServerError(async () => {
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1)

    if (!userRows.length) return []
    const userId = userRows[0].id

    const balances = await db
      .select()
      .from(tokenBalances)
      .where(eq(tokenBalances.userId, userId))

    return balances.map((b) => ({
      token: b.token,
      amount: parseFloat(b.amount),
    }))
  }))

export const requestWithdrawal = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      telegramId: z.string(),
      token: z.string(),
      // TON addresses: EQ/UQ prefix + 46 base64url chars (user-friendly bounceable/non-bounceable)
      // Raw hex format (64 chars) also accepted for advanced users
      walletAddress: z.string()
        .min(10).max(100)
        .refine(
          (addr) => /^(EQ|UQ)[A-Za-z0-9_-]{46}$/.test(addr) || /^[0-9a-fA-F]{64}$/.test(addr),
          { message: 'Invalid TON wallet address — must start with EQ or UQ followed by 46 characters' }
        ),
    }),
  )
  .handler(({ data }) => withServerError(async () => {
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1)

    if (!userRows.length) throw new Error('User not found')
    const user = userRows[0]
    if (user.isBanned) throw new Error('Account suspended')
    if (user.fraudScore > FRAUD_HARD_BLOCK_SCORE) throw new Error('Account flagged — withdrawals paused')

    // ── Minimum activity gate ────────────────────────────────────────────
    const activityCheck = meetsMinimumActivity({
      spinCount: user.spinCount,
      adsWatched: user.adsWatched ?? 0,
      createdAt: user.createdAt,
    })
    if (!activityCheck.ok) {
      throw new Error(`ACTIVITY_GATE:${activityCheck.reason}`)
    }

    const tokenCfg = TOKENS[data.token as keyof typeof TOKENS]
    if (!tokenCfg) throw new Error('Invalid token')

    // ── Balance check ────────────────────────────────────────────────────
    const balanceRows = await db
      .select()
      .from(tokenBalances)
      .where(and(eq(tokenBalances.userId, user.id), eq(tokenBalances.token, data.token)))
      .limit(1)

    const balance = balanceRows.length ? parseFloat(balanceRows[0].amount) : 0

    if (balance < tokenCfg.withdrawThreshold) {
      throw new Error(`MIN_BALANCE:${tokenCfg.withdrawThreshold} ${data.token} required`)
    }

    // ── Stars gate ───────────────────────────────────────────────────────
    if (user.stars < tokenCfg.starsCost) {
      throw new Error(`NOT_ENOUGH_STARS:${tokenCfg.starsCost} stars required`)
    }

    // ── Token sink: stars processing fee (10% of starsCost, rounded up) ──
    const feeStars = Math.ceil(tokenCfg.starsCost * WITHDRAWAL_STAR_FEE_PCT)
    const totalStarsCost = tokenCfg.starsCost + feeStars
    if (user.stars < totalStarsCost) {
      throw new Error(`NOT_ENOUGH_STARS:${totalStarsCost} stars required (includes ${feeStars} processing fee)`)
    }

    // Deduct stars (base cost + processing fee sink)
    await db
      .update(users)
      .set({
        stars: user.stars - totalStarsCost,
        totalStarsSunk: (user.totalStarsSunk ?? 0) + feeStars,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))

    // Record the fee in sink ledger
    await db.insert(tokenSinkLedger).values({
      userId: user.id,
      token: data.token,
      amountSunk: '0',
      starsSunk: feeStars,
      sinkType: 'withdrawal_fee',
    })

    // Deduct balance and insert withdrawal record atomically.
    // Without a transaction, a crash between these two writes would zero the
    // user's balance without creating a withdrawal record.
    let withdrawal: typeof withdrawals.$inferSelect
    await db.transaction(async (tx) => {
      await tx
        .update(tokenBalances)
        .set({ amount: '0', updatedAt: new Date() })
        .where(and(eq(tokenBalances.userId, user.id), eq(tokenBalances.token, data.token)))

      const [inserted] = await tx
        .insert(withdrawals)
        .values({
          userId: user.id,
          token: data.token,
          amount: String(balance),
          starsCost: totalStarsCost,
          walletAddress: data.walletAddress,
          status: 'pending',
        })
        .returning()

      withdrawal = inserted
    })

    return { success: true, withdrawalId: withdrawal!.id, amount: balance, feeStars }
  }))

export const getWithdrawals = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ telegramId: z.string() }))
  .handler(({ data }) => withServerError(async () => {
    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1)

    if (!userRows.length) return []
    const userId = userRows[0].id

    return db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.userId, userId))
      .orderBy(desc(withdrawals.createdAt))
      .limit(20)
  }))
