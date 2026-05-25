import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db, users, tasks, taskCompletions, tokenBalances } from '../../db/index.js'
import { eq, and, sql } from 'drizzle-orm'
import { getLevelFromXP } from '../lib/constants.js'
import { withServerError } from './errors.js'

export const getTasks = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ telegramId: z.string() }))
  .handler(({ data }) => withServerError(async () => {
    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1)

    const allTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.isActive, true))

    if (!userRows.length) return allTasks.map((t) => ({ ...t, completed: false }))
    const userId = userRows[0].id

    const completed = await db
      .select({ taskId: taskCompletions.taskId })
      .from(taskCompletions)
      .where(eq(taskCompletions.userId, userId))

    const completedIds = new Set(completed.map((c) => c.taskId))
    return allTasks
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({ ...t, completed: completedIds.has(t.id) }))
  }))

export const completeTask = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ telegramId: z.string(), taskId: z.number().int() }))
  .handler(({ data }) => withServerError(async () => {
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1)

    if (!userRows.length) throw new Error('User not found')
    const user = userRows[0]
    if (user.isBanned) throw new Error('Account suspended')

    const taskRows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, data.taskId), eq(tasks.isActive, true)))
      .limit(1)

    if (!taskRows.length) throw new Error('Task not found')
    const task = taskRows[0]

    // Idempotent: if already completed just return success silently
    const existing = await db
      .select()
      .from(taskCompletions)
      .where(and(eq(taskCompletions.userId, user.id), eq(taskCompletions.taskId, task.id)))
      .limit(1)

    if (existing.length > 0) throw new Error('Already completed')

    // Record completion
    await db.insert(taskCompletions).values({ userId: user.id, taskId: task.id })

    // Award token balance
    await db
      .insert(tokenBalances)
      .values({ userId: user.id, token: task.rewardToken, amount: task.rewardAmount })
      .onConflictDoUpdate({
        target: [tokenBalances.userId, tokenBalances.token],
        set: {
          amount: sql`${tokenBalances.amount} + ${task.rewardAmount}`,
          updatedAt: new Date(),
        },
      })

    // Award stars + XP + spins
    const xpReward    = task.xpReward    ?? 0
    const spinsReward = task.spinsReward ?? 0
    const newXP    = (user.xp ?? 0) + xpReward
    const newLevel = getLevelFromXP(newXP)
    const newStars = (user.stars ?? 0) + (task.starsReward ?? 0)
    const newSpins = (user.spinsAvailable ?? 0) + spinsReward

    await db
      .update(users)
      .set({
        stars:          newStars,
        xp:             newXP,
        level:          newLevel,
        spinsAvailable: newSpins,
        tasksCompleted: sql`${users.tasksCompleted} + 1`,
        updatedAt:      new Date(),
      })
      .where(eq(users.id, user.id))

    return {
      rewardToken:  task.rewardToken,
      rewardAmount: String(task.rewardAmount),
      starsReward:  task.starsReward ?? 0,
      xpReward,
      spinsReward,
      newStars,
      newXP,
      newLevel,
      newSpins,
    }
  }))

// Admin: add a new task
export const addTask = createServerFn({ method: 'POST' })
  .inputValidator(z.object({
    adminTelegramId: z.string(),
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(300),
    taskType: z.enum(['telegram_join', 'twitter_follow', 'website_visit', 'youtube_watch', 'discord_join', 'instagram_follow', 'tiktok_follow', 'custom']),
    url: z.string().url(),
    rewardToken: z.string(),
    rewardAmount: z.string(),
    starsReward: z.number().int().min(0).default(10),
    xpReward: z.number().int().min(0).default(15),
    spinsReward: z.number().int().min(0).default(0),
    sortOrder: z.number().int().min(0).default(99),
  }))
  .handler(({ data }) => withServerError(async () => {
    const adminId = process.env.ADMIN_TELEGRAM_ID ?? process.env.VITE_ADMIN_TELEGRAM_ID
    if (!adminId || data.adminTelegramId !== adminId) {
      throw new Error('Unauthorized')
    }

    const [inserted] = await db
      .insert(tasks)
      .values({
        title: data.title,
        description: data.description,
        taskType: data.taskType,
        url: data.url,
        rewardToken: data.rewardToken,
        rewardAmount: data.rewardAmount,
        starsReward: data.starsReward,
        xpReward: data.xpReward,
        spinsReward: data.spinsReward,
        isActive: true,
        isDailyQuest: false,
        sortOrder: data.sortOrder,
      })
      .returning()

    return inserted
  }))

// Admin: toggle task active/inactive
export const toggleTask = createServerFn({ method: 'POST' })
  .inputValidator(z.object({
    adminTelegramId: z.string(),
    taskId: z.number().int(),
    isActive: z.boolean(),
  }))
  .handler(({ data }) => withServerError(async () => {
    const adminId = process.env.ADMIN_TELEGRAM_ID ?? process.env.VITE_ADMIN_TELEGRAM_ID
    if (!adminId || data.adminTelegramId !== adminId) throw new Error('Unauthorized')

    await db.update(tasks).set({ isActive: data.isActive }).where(eq(tasks.id, data.taskId))
    return { ok: true }
  }))

// Admin: get all tasks including inactive
export const getAllTasksAdmin = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ adminTelegramId: z.string() }))
  .handler(({ data }) => withServerError(async () => {
    const adminId = process.env.ADMIN_TELEGRAM_ID ?? process.env.VITE_ADMIN_TELEGRAM_ID
    if (!adminId || data.adminTelegramId !== adminId) throw new Error('Unauthorized')
    return db.select().from(tasks).orderBy(tasks.sortOrder)
  }))
