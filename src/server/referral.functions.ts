import { withServerError } from './errors.js'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db, users, referrals } from '../../db/index.js'
import { eq, desc, inArray, and } from 'drizzle-orm'

export const getReferralStats = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ telegramId: z.string() }))
  .handler(({ data }) => withServerError(async () => {
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1)

    if (!userRows.length) return { referralCode: '', referralCount: 0, totalStarsEarned: 0, totalSpinsEarned: 0, recent: [] }
    const user = userRows[0]

    const refs = await db
      .select({ id: referrals.id, starsAwarded: referrals.starsAwarded, spinsAwarded: referrals.spinsAwarded, createdAt: referrals.createdAt, referredId: referrals.referredId, verified: referrals.verified })
      .from(referrals)
      .where(eq(referrals.referrerId, user.id))
      .orderBy(desc(referrals.createdAt))

    // Only count verified referrals — unverified ones haven't paid out yet
    const verifiedRefs = refs.filter(r => r.verified)
    const totalStarsEarned = verifiedRefs.reduce((sum, r) => sum + r.starsAwarded, 0)
    const totalSpinsEarned = verifiedRefs.reduce((sum, r) => sum + (r.spinsAwarded ?? 0), 0)

    // Get referred users' names for display — single batched query (no N+1)
    const recentIds = refs.slice(0, 5).map(r => r.referredId)
    let recentNames: Record<number, string> = {}
    if (recentIds.length > 0) {
      const nameRows = await db
        .select({ id: users.id, firstName: users.firstName })
        .from(users)
        .where(inArray(users.id, recentIds))
      for (const row of nameRows) {
        recentNames[row.id] = row.firstName ?? 'User'
      }
    }

    const recent = refs.slice(0, 5).map(r => ({
      name: recentNames[r.referredId] ?? 'User',
      starsAwarded: r.starsAwarded,
      createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    }))

    return {
      referralCode: user.referralCode,
      referralCount: refs.length,         // total invited
      verifiedCount: verifiedRefs.length,  // completed activity gate
      totalStarsEarned,
      totalSpinsEarned,
      recent,
    }
  }))
