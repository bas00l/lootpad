import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  numeric,
  index,
  uniqueIndex,
  jsonb,
} from 'drizzle-orm/pg-core'

export const users = pgTable(
  'users',
  {
    id: serial().primaryKey(),
    telegramId: text('telegram_id').notNull().unique(),
    username: text('username'),
    firstName: text('first_name'),
    photoUrl: text('photo_url'),
    stars: integer('stars').notNull().default(0),
    xp: integer('xp').notNull().default(0),
    level: integer('level').notNull().default(1),
    spinsAvailable: integer('spins_available').notNull().default(3),
    referralCode: text('referral_code').notNull().unique(),
    referredByCode: text('referred_by_code'),
    fraudScore: integer('fraud_score').notNull().default(0),
    isBanned: boolean('is_banned').notNull().default(false),
    lastSpinAt: timestamp('last_spin_at'),
    lastDailyAt: timestamp('last_daily_at'),
    dailyStreak: integer('daily_streak').notNull().default(0),
    spinCount: integer('spin_count').notNull().default(0),
    ipAddress: text('ip_address'),
    achievements: text('achievements').array().notNull().default([]),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),

    // ── Anti-Sybil / activity gating ──────────────────────────────────
    /** Total number of real (non-simulated) ads watched — used for min-activity gate */
    adsWatched: integer('ads_watched').notNull().default(0),
    /** Number of tasks completed — combined with adsWatched to verify minimum activity */
    tasksCompleted: integer('tasks_completed').notNull().default(0),
    /** Timestamp of last ad watch — enforces 30-second ad cooldown server-side */
    lastAdWatchAt: timestamp('last_ad_watch_at'),
    /** Device fingerprint hash supplied on first registration */
    deviceFingerprint: text('device_fingerprint'),
    /** Cumulative stars spent on token sink actions (withdrawals, boosts, etc.) */
    totalStarsSunk: integer('total_stars_sunk').notNull().default(0),
    /** Whether the referral bonus has been verified (referee met minimum activity) */
    referralVerified: boolean('referral_verified').notNull().default(false),
    /** Timestamp when the referral was first verified */
    referralVerifiedAt: timestamp('referral_verified_at'),
    /** House-controlled expected-value multiplier (0.5–1.5). Default 1.0 */
    evMultiplier: numeric('ev_multiplier', { precision: 4, scale: 2 }).notNull().default('1.00'),
  },
  (t) => [index('users_telegram_id_idx').on(t.telegramId)],
)

export const tokenBalances = pgTable(
  'token_balances',
  {
    id: serial().primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    token: text('token').notNull(),
    amount: numeric('amount', { precision: 20, scale: 8 }).notNull().default('0'),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [uniqueIndex('token_balances_user_token_idx').on(t.userId, t.token)],
)

export const spinHistory = pgTable('spin_history', {
  id: serial().primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  token: text('token').notNull(),
  amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
  starsEarned: integer('stars_earned').notNull().default(0),
  xpEarned: integer('xp_earned').notNull().default(0),
  rarity: text('rarity').notNull().default('common'),
  spunAt: timestamp('spun_at').defaultNow(),
})

export const tasks = pgTable('tasks', {
  id: serial().primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  taskType: text('task_type').notNull(),
  url: text('url').notNull(),
  rewardToken: text('reward_token').notNull(),
  rewardAmount: numeric('reward_amount', { precision: 20, scale: 8 }).notNull(),
  starsReward: integer('stars_reward').notNull().default(0),
  xpReward: integer('xp_reward').notNull().default(0),
  spinsReward: integer('spins_reward').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  isDailyQuest: boolean('is_daily_quest').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
})

export const taskCompletions = pgTable(
  'task_completions',
  {
    id: serial().primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    taskId: integer('task_id')
      .notNull()
      .references(() => tasks.id),
    completedAt: timestamp('completed_at').defaultNow(),
  },
  (t) => [uniqueIndex('task_completions_user_task_idx').on(t.userId, t.taskId)],
)

export const referrals = pgTable('referrals', {
  id: serial().primaryKey(),
  referrerId: integer('referrer_id')
    .notNull()
    .references(() => users.id),
  referredId: integer('referred_id')
    .notNull()
    .references(() => users.id),
  bonusPaid: boolean('bonus_paid').notNull().default(false),
  starsAwarded: integer('stars_awarded').notNull().default(0),
  spinsAwarded: integer('spins_awarded').notNull().default(0),
  /** Set true once referee clears REFERRAL_MIN_SPINS & REFERRAL_MIN_ADS */
  verified: boolean('verified').notNull().default(false),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').defaultNow(),
})

export const withdrawals = pgTable('withdrawals', {
  id: serial().primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  token: text('token').notNull(),
  amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
  starsCost: integer('stars_cost').notNull(),
  walletAddress: text('wallet_address').notNull(),
  status: text('status').notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const activityFeed = pgTable('activity_feed', {
  id: serial().primaryKey(),
  displayText: text('display_text').notNull(),
  token: text('token').notNull(),
  rarity: text('rarity').notNull().default('common'),
  isFake: boolean('is_fake').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
})

export const fraudEvents = pgTable('fraud_events', {
  id: serial().primaryKey(),
  userId: integer('user_id').references(() => users.id),
  eventType: text('event_type').notNull(),
  ipAddress: text('ip_address'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
})

/** Token sink ledger — every deliberate burn/spend of tokens is recorded here */
export const tokenSinkLedger = pgTable('token_sink_ledger', {
  id: serial().primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  token: text('token').notNull(),
  /** Positive = tokens burned/spent */
  amountSunk: numeric('amount_sunk', { precision: 20, scale: 8 }).notNull(),
  starsSunk: integer('stars_sunk').notNull().default(0),
  sinkType: text('sink_type').notNull(), // 'withdrawal_fee' | 'boost_purchase' | 'spin_boost' | 'lucky_charm'
  createdAt: timestamp('created_at').defaultNow(),
})

// Leaderboard snapshots (updated periodically)
export const leaderboardEntries = pgTable('leaderboard_entries', {
  id: serial().primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  category: text('category').notNull(),
  rank: integer('rank').notNull(),
  score: integer('score').notNull(),
  period: text('period').notNull(),
  displayName: text('display_name'),
  updatedAt: timestamp('updated_at').defaultNow(),
})
