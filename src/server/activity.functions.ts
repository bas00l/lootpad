import { withServerError } from './errors.js'
import { createServerFn } from '@tanstack/react-start'
import { db, activityFeed } from '../../db/index.js'
import { desc } from 'drizzle-orm'
import { FAKE_NAMES, TOKENS, TOKEN_KEYS } from '../lib/constants.js'

export const getActivityFeed = createServerFn({ method: 'GET' })
  .handler(() => withServerError(async () => {
    const real = await db
      .select()
      .from(activityFeed)
      .orderBy(desc(activityFeed.createdAt))
      .limit(20)

    // Pad with fake entries if needed
    const fakeEntries = Array.from({ length: Math.max(0, 15 - real.length) }, (_, i) => {
      const token = TOKEN_KEYS[Math.floor(Math.random() * TOKEN_KEYS.length)]
      const name = FAKE_NAMES[Math.floor(Math.random() * FAKE_NAMES.length)]
      const cfg = TOKENS[token]
      const rarityRoll = Math.random() * 100
      const fakeRarity = rarityRoll < 60 ? 'common' : rarityRoll < 82 ? 'uncommon' : rarityRoll < 93 ? 'rare' : rarityRoll < 98 ? 'epic' : 'legendary'
      return {
        id: -(i + 1),
        displayText: `${name} won ${cfg.emoji} ${token}`,
        token,
        rarity: fakeRarity,
        isFake: true,
        createdAt: new Date(Date.now() - Math.random() * 3_600_000),
      }
    })

    const combined = [...real, ...fakeEntries].sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    )

    return combined.slice(0, 20).map((e) => ({
      id: e.id,
      displayText: e.displayText,
      token: e.token,
      rarity: (e as any).rarity ?? 'common',
      createdAt: e.createdAt?.toISOString() ?? new Date().toISOString(),
    }))
  }))
