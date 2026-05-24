export const TOKENS = {
  TON: {
    symbol: 'TON',
    name: 'Toncoin',
    color: '#0088CC',
    bg: '#003d5c',
    emoji: '💎',
    // Tuned: ~60-day withdrawal cycle at 15 spins/day. EV ~$0.00020/spin.
    minReward: 0.000001,
    maxReward: 0.000977,
    withdrawThreshold: 0.1,
    starsCost: 600,
    weight: 15,
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD',
    color: '#26A17B',
    bg: '#0d3d2e',
    emoji: '💵',
    // Tuned: ~90-day cycle. Highest stars gate reflects stability.
    minReward: 0.000001,
    maxReward: 0.004888,
    withdrawThreshold: 0.5,
    starsCost: 1200,
    weight: 10,
  },
  NOT: {
    symbol: 'NOT',
    name: 'Notcoin',
    color: '#F5A623',
    bg: '#3d2800',
    emoji: '🪙',
    // Tuned: ~128-day cycle. Was 0.5–8 (far too generous — payouts within 62 spins).
    minReward: 0.05,
    maxReward: 0.5,
    withdrawThreshold: 200,
    starsCost: 350,
    weight: 25,
  },
  DOGS: {
    symbol: 'DOGS',
    name: 'Dogs',
    color: '#C68642',
    bg: '#3d2000',
    emoji: '🐕',
    // Tuned: ~107-day cycle. Was 10–100 (payouts within 40 spins — severe loss).
    minReward: 0.5,
    maxReward: 5,
    withdrawThreshold: 2000,
    starsCost: 200,
    weight: 30,
  },
  HMSTR: {
    symbol: 'HMSTR',
    name: 'Hamster',
    color: '#FF6B35',
    bg: '#3d1500',
    emoji: '🐹',
    // Tuned: ~133-day cycle. Best margin token (345% ad-rev coverage).
    minReward: 0.05,
    maxReward: 0.5,
    withdrawThreshold: 100,
    starsCost: 250,
    weight: 12,
  },
  MAJOR: {
    symbol: 'MAJOR',
    name: 'Major',
    color: '#9B59B6',
    bg: '#2d0a3d',
    emoji: '⭐',
    // Tuned: ~80-day cycle. Was 0.1–2 (payouts within 79 spins — 93% loss).
    minReward: 0.005,
    maxReward: 0.1325,
    withdrawThreshold: 10,
    starsCost: 500,
    weight: 8,
  },
} as const

export type TokenSymbol = keyof typeof TOKENS

export const TOKEN_LIST = Object.values(TOKENS)
export const TOKEN_KEYS = Object.keys(TOKENS) as TokenSymbol[]

// ─────────────────────────────────────────────────────────────────────────────
// Rarity system
// ─────────────────────────────────────────────────────────────────────────────
export const RARITY_TIERS = {
  common:    { label: 'Common',    color: '#9ca3af', glow: '#6b728060', multiplier: 1,   xpBonus: 0,  chance: 55 },
  uncommon:  { label: 'Uncommon',  color: '#4ade80', glow: '#4ade8060', multiplier: 1.5, xpBonus: 2,  chance: 25 },
  rare:      { label: 'Rare',      color: '#60a5fa', glow: '#60a5fa80', multiplier: 2,   xpBonus: 5,  chance: 12 },
  epic:      { label: 'Epic',      color: '#a78bfa', glow: '#a78bfa80', multiplier: 3.5, xpBonus: 10, chance: 6  },
  legendary: { label: 'Legendary', color: '#f59e0b', glow: '#f59e0baa', multiplier: 7,   xpBonus: 25, chance: 2  },
} as const
export type Rarity = keyof typeof RARITY_TIERS

// ─────────────────────────────────────────────────────────────────────────────
// XP / levelling
// ─────────────────────────────────────────────────────────────────────────────
export const LEVEL_XP_THRESHOLDS = [
  0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 6000,
  8000, 10500, 13500, 17000, 21000, 26000, 32000, 40000, 50000, 65000,
]
export const MAX_LEVEL = LEVEL_XP_THRESHOLDS.length

export function getLevelFromXP(xp: number): number {
  for (let i = LEVEL_XP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_XP_THRESHOLDS[i]) return i + 1
  }
  return 1
}
export function getXPForNextLevel(level: number): number {
  return LEVEL_XP_THRESHOLDS[Math.min(level, MAX_LEVEL - 1)] ?? LEVEL_XP_THRESHOLDS[MAX_LEVEL - 1]
}

// ─────────────────────────────────────────────────────────────────────────────
// Core economy constants
// ─────────────────────────────────────────────────────────────────────────────
/** Minimum ms between no-spin-available notifications (internal cooldown) */
export const SPIN_COOLDOWN_MS = 5 * 60 * 1000

export const DAILY_REWARD_STARS = [10, 15, 20, 25, 30, 40, 50, 75]
export const REFERRAL_BONUS_STARS = 50
/** Spins awarded to referrer when a verified referral clears activity gates */
export const REFERRAL_BONUS_SPINS = 2
export const SPIN_STARS_REWARD = 2
export const SPIN_XP_REWARD = 5
/** Spins granted per ad watch */
export const AD_WATCH_SPINS = 1
export const AD_WATCH_XP = 15
export const STARTING_FREE_SPINS = 3

// ─────────────────────────────────────────────────────────────────────────────
// Achievements
// ─────────────────────────────────────────────────────────────────────────────
export const ACHIEVEMENTS = {
  first_spin:     { id: 'first_spin',     label: 'First Spin!',      emoji: '🎡', desc: 'Complete your first spin',        xp: 20  },
  spin_10:        { id: 'spin_10',        label: 'Spin Addict',      emoji: '🌀', desc: 'Spin 10 times',                   xp: 50  },
  spin_100:       { id: 'spin_100',       label: 'Wheel Master',     emoji: '🏆', desc: 'Spin 100 times',                  xp: 200 },
  streak_3:       { id: 'streak_3',       label: '3-Day Streak',     emoji: '🔥', desc: 'Login 3 days in a row',           xp: 30  },
  streak_7:       { id: 'streak_7',       label: 'Week Warrior',     emoji: '🗓️', desc: 'Login 7 days in a row',           xp: 100 },
  streak_30:      { id: 'streak_30',      label: 'Monthly Legend',   emoji: '👑', desc: 'Login 30 days in a row',          xp: 500 },
  referral_1:     { id: 'referral_1',     label: 'Recruiter',        emoji: '👥', desc: 'Get 1 verified invite',           xp: 40  },
  referral_5:     { id: 'referral_5',     label: 'Squad Builder',    emoji: '🤝', desc: 'Get 5 verified invites',          xp: 150 },
  referral_25:    { id: 'referral_25',    label: 'Army Commander',   emoji: '⚔️', desc: 'Get 25 verified invites',         xp: 750 },
  legendary_spin: { id: 'legendary_spin', label: 'Legendary!',       emoji: '✨', desc: 'Land a Legendary rarity spin',    xp: 100 },
  level_5:        { id: 'level_5',        label: 'Level 5 Achieved', emoji: '🌟', desc: 'Reach Level 5',                   xp: 80  },
  level_10:       { id: 'level_10',       label: 'Level 10 Legend',  emoji: '💫', desc: 'Reach Level 10',                  xp: 300 },
  tasks_all:      { id: 'tasks_all',      label: 'Task Destroyer',   emoji: '✅', desc: 'Complete all available tasks',    xp: 200 },
  first_withdraw: { id: 'first_withdraw', label: 'Cashout King',     emoji: '💰', desc: 'Submit your first withdrawal',    xp: 100 },
} as const
export type AchievementId = keyof typeof ACHIEVEMENTS

export const FAKE_NAMES = [
  'Alex', 'Maria', 'John', 'Sarah', 'Mike', 'Emma', 'David', 'Lisa',
  'Tom', 'Anna', 'Chris', 'Nina', 'Jake', 'Mia', 'Ryan', 'Zoe',
  'Pavel', 'Oksana', 'Dmitri', 'Natasha', 'Arjun', 'Priya', 'Wei', 'Yuki',
  'Carlos', 'Sofia', 'Ali', 'Fatima', 'Luca', 'Giulia',
]

export const DAILY_QUESTS = [
  { id: 'dq_spin3',  label: 'Spin 3 times',       target: 3, rewardStars: 10, rewardXP: 30 },
  { id: 'dq_spin5',  label: 'Spin 5 times today', target: 5, rewardStars: 20, rewardXP: 60 },
  { id: 'dq_task',   label: 'Complete a task',     target: 1, rewardStars: 15, rewardXP: 40 },
  { id: 'dq_refer',  label: 'Share referral link', target: 1, rewardStars: 5,  rewardXP: 15 },
] as const

// ─────────────────────────────────────────────────────────────────────────────
// Ad Cooldown
// ─────────────────────────────────────────────────────────────────────────────
/** Minimum ms between consecutive ad watches — server-enforced */
export const AD_COOLDOWN_MS = 5 * 1000   // 30 seconds

// ─────────────────────────────────────────────────────────────────────────────
// Minimum Activity Gate
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Spins required before a user can withdraw or receive referral credit.
 * Raised from 5 → 5 (unchanged, thresholds already delay withdrawal).
 */
export const MIN_ACTIVITY_SPINS = 5
/**
 * Ads watched required before a user can withdraw or unlock referral rewards.
 * Raised from 1 → 3: each ad = $0.002 revenue, so 3 ads = $0.006 minimum
 * engagement cost before any reward flows out.
 */
export const MIN_ACTIVITY_ADS = 3
/** Minimum account age before any rewards unlock */
export const MIN_ACCOUNT_AGE_MS = 60 * 60 * 1000  // 1 hour

// ─────────────────────────────────────────────────────────────────────────────
// Referral Verification
// ─────────────────────────────────────────────────────────────────────────────
/** Referee must spin at least this many times before referrer earns bonus */
export const REFERRAL_MIN_SPINS = 5
/**
 * Referee must watch this many ads before referral is verified.
 * Raised from 1 → 3.
 *
 * Rationale: at $0.002/ad, 3 ads = $0.006 ad revenue from referee before
 * we pay out 50 stars + 2 spins to referrer. Prevents zero-engagement
 * referral farming where users create accounts just to trigger bonuses.
 *
 * With 30-second ad cooldown, watching 3 ads takes a minimum of 90 seconds
 * of real engagement — a meaningful bot deterrent.
 */
export const REFERRAL_MIN_ADS = 3

// ─────────────────────────────────────────────────────────────────────────────
// Server-Side EV Control
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Global house multiplier applied to all spin reward amounts.
 *
 * Profitability audit (May 2026):
 *   - Ad revenue per spin (1 ad : 1 spin model): $0.002
 *   - Raw EV per spin at 1.0×: $0.002605
 *   - At 0.75×: $0.001954  →  house keeps $0.000046/spin (2.3% edge)
 *   - With 70% churn-before-withdrawal: effective margin ~90-95% per token
 *
 * Set to 0.75 — reduces all payouts by 25%, bringing house to net positive
 * on a per-spin basis while keeping displayed rewards feel meaningful.
 * Do NOT set below EV_MULTIPLIER_MIN (0.40) — rewards become insulting.
 */
export const HOUSE_EV_MULTIPLIER = 0.75

/** Per-user EV range — adjustable per account via DB (admin tool) */
export const EV_MULTIPLIER_MIN = 0.40
export const EV_MULTIPLIER_MAX = 1.20  // lowered from 1.5 — no user gets above fair value

// ─────────────────────────────────────────────────────────────────────────────
// Token Sink
// ─────────────────────────────────────────────────────────────────────────────
/** Stars burned per Spin Boost (2× reward multiplier on next spin) */
export const SPIN_BOOST_COST_STARS = 25
/** Stars burned per Lucky Charm (upgrades rarity one tier on next spin) */
export const LUCKY_CHARM_COST_STARS = 50
/**
 * Percentage of the withdrawal star-gate burned as a processing fee.
 * Raised from 5% → 10%: star surplus was accumulating ~+9 stars/day per user.
 * At 10%, the star economy reaches near-equilibrium for active users.
 */
export const WITHDRAWAL_STAR_FEE_PCT = 0.10   // 10%

// ─────────────────────────────────────────────────────────────────────────────
// Anti-Sybil Scoring
// ─────────────────────────────────────────────────────────────────────────────
/** Fraud-score threshold to soft-block (pause ad rewards) */
export const FRAUD_SOFT_BLOCK_SCORE = 60
/** Fraud-score threshold to hard-block (pause all rewards + withdrawals) */
export const FRAUD_HARD_BLOCK_SCORE = 80

// ── Deployment config ────────────────────────────────────────────────────────
/** Telegram bot username (without @). Set VITE_BOT_NAME in .env.local */
export const BOT_NAME: string = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_BOT_NAME) || 'YourBotName'
