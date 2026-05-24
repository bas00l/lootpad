import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { getTasks, completeTask } from '../server/tasks.functions.js'
import { getTelegramUserId, hapticSuccess, hapticError } from '../lib/telegram.js'
import { TOKENS } from '../lib/constants.js'
import { AdsgramTask } from '@adsgram/react'

export const Route = createFileRoute('/tasks')({
  component: TasksPage,
})

interface Task {
  id: number
  title: string
  description: string
  taskType: string
  url: string
  rewardToken: string
  rewardAmount: string
  starsReward: number
  completed: boolean
}

function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState<number | null>(null)
  const [justDone, setJustDone] = useState<number | null>(null)
  // Tasks the user has opened but not yet verified — they must tap "✓ Verify" after visiting the URL
  const [pendingVerify, setPendingVerify] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const getTasksFn = useServerFn(getTasks)
  const completeTaskFn = useServerFn(completeTask)

  const tgId = getTelegramUserId()

  useEffect(() => {
    getTasksFn({ data: { telegramId: tgId } })
      .then((t) => setTasks(t as Task[]))
      .catch(() => setError('Failed to load tasks'))
      .finally(() => setLoading(false))
  }, [])

  // Step 1: open URL and enter "pending verify" state
  const handleGo = (task: Task) => {
    if (task.completed || completing !== null) return
    window.open(task.url, '_blank')
    setPendingVerify((prev) => new Set(prev).add(task.id))
  }

  // Step 2: user comes back and taps Verify — server marks complete
  const handleVerify = async (task: Task) => {
    if (task.completed || completing !== null) return
    setCompleting(task.id)
    setError(null)
    try {
      await completeTaskFn({ data: { telegramId: tgId, taskId: task.id } })
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: true } : t)))
      setPendingVerify((prev) => { const s = new Set(prev); s.delete(task.id); return s })
      setJustDone(task.id)
      hapticSuccess()
      setTimeout(() => setJustDone(null), 3000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed'
      if (msg === 'Already completed') {
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: true } : t)))
      } else {
        setError(msg)
        hapticError()
      }
    } finally {
      setCompleting(null)
    }
  }

  const taskTypeIcon: Record<string, string> = {
    telegram_join: '📱',
    twitter_follow: '🐦',
    website_visit: '🌐',
    youtube_watch: '▶️',
    discord_join: '💬',
  }

  const pending = tasks.filter((t) => !t.completed)
  const done = tasks.filter((t) => t.completed)

  return (
    <div className="page">
      <div className="text-center">
        <h1 className="text-xl font-bold shimmer-text">Tasks</h1>
        <p className="text-gray-400 text-sm">Complete tasks to earn tokens & stars</p>
      </div>

      {/* Progress bar */}
      <div className="card p-3">
        <div className="flex justify-between text-xs mb-2">
          <span className="text-gray-400">Progress</span>
          <span className="text-purple-400 font-bold">{done.length}/{tasks.length} completed</span>
        </div>
        <div className="rounded-full h-2 overflow-hidden" style={{ background: '#1e1e40' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: tasks.length ? `${(done.length / tasks.length) * 100}%` : '0%',
              background: 'linear-gradient(90deg, #7c3aed, #a78bfa)',
            }}
          />
        </div>
      </div>

      {error && <p className="text-red-400 text-xs text-center">{error}</p>}

      {loading ? (
        <div className="text-center py-8 text-gray-400">
          <div className="text-3xl mb-2 animate-spin">⏳</div>
          Loading tasks...
        </div>
      ) : (
        <>

          <AdsgramTask
            blockId={import.meta.env.VITE_ADSGRAM_TASK_BLOCK_ID}
            data-debug={import.meta.env.DEV ? "true" : "false"}
            className="w-full"
            onReward={(e) => {
              // Adsgram task completed — award spins or stars via server
              hapticSuccess()
            }}
            onError={(e) => {
              console.error('Adsgram task error:', e.detail)
            }}
          >
            <span slot="reward" className="text-yellow-400 font-bold text-xs">+1 🎫 spin</span>
            <div slot="button" className="btn-primary text-sm py-1.5">Go →</div>
            <div slot="claim" className="btn-primary text-sm py-1.5">✓ Claim</div>
            <div slot="done" className="text-green-400 text-xs font-bold">✅ Done</div>
          </AdsgramTask>
          {/* Pending tasks */}
          {pending.length > 0 && (
            <div className="flex flex-col gap-2">
              {pending.map((task) => {
                const cfg = TOKENS[task.rewardToken as keyof typeof TOKENS]
                const isProcessing = completing === task.id
                return (
                  <div key={task.id} className="card p-3">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl mt-0.5">{taskTypeIcon[task.taskType] ?? '📋'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-white">{task.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{task.description}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {cfg && (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                              style={{ background: cfg.bg, color: cfg.color }}
                            >
                              {cfg.emoji} +{task.rewardAmount} {task.rewardToken}
                            </span>
                          )}
                          {task.starsReward > 0 && (
                            <span className="text-yellow-400 text-xs font-bold">+{task.starsReward}⭐</span>
                          )}
                        </div>
                      </div>
                      {pendingVerify.has(task.id) ? (
                        <button
                          onClick={() => handleVerify(task)}
                          disabled={isProcessing}
                          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                          style={{
                            background: isProcessing ? '#2a2a50' : '#1a3a1a',
                            color: isProcessing ? '#6b7280' : '#4ade80',
                            border: '1px solid #16a34a',
                          }}
                        >
                          {isProcessing ? '⏳' : '✓ Verify'}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleGo(task)}
                          disabled={isProcessing}
                          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                          style={{
                            background: '#4c1d95',
                            color: 'white',
                            border: '1px solid #6d28d9',
                          }}
                        >
                          Go →
                        </button>
                      )}
                    </div>
                    {justDone === task.id && (
                      <div className="bounce-in mt-2 text-center text-green-400 text-xs font-bold">
                        ✅ Task completed! Reward credited.
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Completed tasks */}
          {done.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Completed</p>
              <div className="flex flex-col gap-1.5">
                {done.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl opacity-50"
                    style={{ background: '#12122a', border: '1px solid #1e1e40' }}
                  >
                    <span className="text-green-500">✅</span>
                    <span className="text-xs text-gray-400 flex-1">{task.title}</span>
                    <span className="text-green-500 text-xs">Done</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tasks.length === 0 && (
            <div className="text-center py-10 text-gray-500">
              <p className="text-3xl mb-2">📋</p>
              <p>No tasks available yet</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
