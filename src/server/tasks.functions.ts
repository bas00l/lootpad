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

    const existing = await db
      .select()
      .from(taskCompletions)
      .where(and(eq(taskCompletions.userId, user.id), eq(taskCompletions.taskId, task.id)))
      .limit(1)

    if (existing.length > 0) throw new Error('Already completed')

    await db.insert(taskCompletions).values({ userId: user.id, taskId: task.id })

    // Award token reward
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
    const newXP    = user.xp + xpReward
    const newLevel = getLevelFromXP(newXP)

    await db
      .update(users)
      .set({
        stars:          user.stars + task.starsReward,
        xp:             newXP,
        level:          newLevel,
        spinsAvailable: user.spinsAvailable + spinsReward,
        tasksCompleted: (user.tasksCompleted ?? 0) + 1,
        updatedAt:      new Date(),
      })
      .where(eq(users.id, user.id))

    return {
      rewardToken:  task.rewardToken,
      rewardAmount: task.rewardAmount,
      starsReward:  task.starsReward,
      xpReward,
      spinsReward,
      newLevel,
    }
  }))
