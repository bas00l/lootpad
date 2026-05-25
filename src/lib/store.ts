/**
 * Global app state shared across all routes.
 * Uses @tanstack/react-store — already a dependency.
 */
import { Store, useStore } from '@tanstack/react-store'

export interface UserState {
  id: number
  stars: number
  xp: number
  level: number
  firstName: string
  username?: string | null
  photoUrl?: string | null
  dailyStreak: number
  spinCount: number
  spinsAvailable: number
  adsWatched: number
  achievements: string[]
}

export interface Balance { token: string; amount: number }

interface AppState {
  user: UserState | null
  balances: Balance[]
}

export const appStore = new Store<AppState>({
  user: null,
  balances: [],
})

// ── Typed hooks ────────────────────────────────────────────────────────────

export function useUser() {
  return useStore(appStore, (s) => s.user)
}

export function useBalances() {
  return useStore(appStore, (s) => s.balances)
}

// ── Mutators ───────────────────────────────────────────────────────────────

export function setUser(user: UserState | null) {
  appStore.setState((s) => ({ ...s, user }))
}

export function updateUser(patch: Partial<UserState>) {
  appStore.setState((s) => ({
    ...s,
    user: s.user ? { ...s.user, ...patch } : s.user,
  }))
}

export function setBalances(balances: Balance[]) {
  appStore.setState((s) => ({ ...s, balances }))
}

export function applyTaskReward(reward: {
  rewardToken: string
  rewardAmount: string
  starsReward: number
  xpReward: number
  spinsReward: number
  newLevel: number
}) {
  appStore.setState((s) => {
    if (!s.user) return s

    // Update matching balance
    const token = reward.rewardToken
    const delta = parseFloat(reward.rewardAmount)
    const existing = s.balances.find((b) => b.token === token)
    const balances = existing
      ? s.balances.map((b) => b.token === token ? { ...b, amount: b.amount + delta } : b)
      : [...s.balances, { token, amount: delta }]

    return {
      ...s,
      balances,
      user: {
        ...s.user,
        stars:          s.user.stars + reward.starsReward,
        xp:             s.user.xp + reward.xpReward,
        level:          reward.newLevel,
        spinsAvailable: s.user.spinsAvailable + reward.spinsReward,
      },
    }
  })
}
