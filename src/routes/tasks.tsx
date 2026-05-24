// Error helper: reads TanStack Start's statusMessage before message
function getServerErrMsg(e: unknown, fallback: string): string {
  if (e && typeof e === 'object') {
    const err = e as Record<string, unknown>
    if (typeof err.statusMessage === 'string' && err.statusMessage) return err.statusMessage
    if (typeof err.message === 'string' && err.message !== 'HTTPError') return err.message
  }
  return fallback
}

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { getTasks, completeTask, addTask, toggleTask, getAllTasksAdmin } from '../server/tasks.functions.js'
import { earnSpinsFromAd } from '../server/spin.functions.js'
import { getTelegramUserId, hapticSuccess, hapticError, hapticSelect } from '../lib/telegram.js'
import { TOKENS } from '../lib/constants.js'

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
  xpReward?: number
  spinsReward?: number
  isActive?: boolean
  completed: boolean
}

interface RewardResult {
  rewardToken: string
  rewardAmount: string
  starsReward: number
  xpReward: number
  spinsReward: number
  newStars: number
  newXP: number
  newLevel: number
  newSpins: number
}

const TASK_TYPE_OPTIONS = [
  { value: 'telegram_join',    label: 'Telegram Join',    icon: '📱' },
  { value: 'twitter_follow',   label: 'Twitter/X Follow', icon: '🐦' },
  { value: 'website_visit',    label: 'Website Visit',    icon: '🌐' },
  { value: 'youtube_watch',    label: 'YouTube Watch',    icon: '▶️' },
  { value: 'discord_join',     label: 'Discord Join',     icon: '💬' },
  { value: 'instagram_follow', label: 'Instagram Follow', icon: '📸' },
  { value: 'tiktok_follow',    label: 'TikTok Follow',    icon: '🎵' },
  { value: 'custom',           label: 'Custom Task',      icon: '📋' },
]

const TASK_TYPE_ICON: Record<string, string> = Object.fromEntries(
  TASK_TYPE_OPTIONS.map((o) => [o.value, o.icon])
)

// ── AdsGram Task Blocks ──────────────────────────────────────────────────────
// task-XXXXX blocks use the <adsgram-task> web component.
// We render it hidden and project fully custom slots into it so only OUR
// button/claim/done UI is visible — the component shell stays display:none.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'adsgram-task': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        'data-block-id'?: string
        'data-debug'?: string
      }
    }
  }
}

interface AdsgramTaskConfig {
  blockId: string
  spinsReward: number
  starsReward: number
  xpReward: number
}

function parseAdsgramBlocks(): AdsgramTaskConfig[] {
  const raw = import.meta.env.VITE_ADSGRAM_TASK_BLOCKS as string | undefined
  if (raw && raw.trim()) {
    return raw.split(';').map((entry) => {
      const [blockId = '', spins = '1', stars = '5', xp = '15'] = entry.split(':')
      return {
        blockId: blockId.trim(),
        spinsReward: parseInt(spins, 10) || 1,
        starsReward: parseInt(stars, 10) || 5,
        xpReward:    parseInt(xp,    10) || 15,
      }
    }).filter((c) => c.blockId)
  }
  const single = import.meta.env.VITE_ADSGRAM_TASK_BLOCK_ID as string | undefined
  if (single?.trim()) {
    return [{ blockId: single.trim(), spinsReward: 1, starsReward: 5, xpReward: 15 }]
  }
  return []
}

// Single task-block card — wraps the web component with fully custom slots
function AdsgramTaskCard({ cfg, tgId, onReward }: {
  cfg: AdsgramTaskConfig
  tgId: string
  onReward: (r: { spinsReward: number; starsReward: number; xpReward: number }) => void
}) {
  const ref = useRef<HTMLElement>(null)
  const earnSpinsFn = useServerFn(earnSpinsFromAd)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onRewardEvt = async () => {
      try {
        await earnSpinsFn({ data: { telegramId: tgId } })
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (!msg.startsWith('AD_COOLDOWN:')) console.warn('earnSpins error:', msg)
      }
      onReward({ spinsReward: cfg.spinsReward, starsReward: cfg.starsReward, xpReward: cfg.xpReward })
      hapticSuccess()
    }
    const onErrEvt = (e: Event) => {
      console.warn('AdsGram task error', cfg.blockId, (e as CustomEvent).detail)
      hapticError()
    }

    el.addEventListener('reward', onRewardEvt)
    el.addEventListener('onError', onErrEvt)
    return () => {
      el.removeEventListener('reward', onRewardEvt)
      el.removeEventListener('onError', onErrEvt)
    }
  }, [cfg.blockId, tgId])

  return (
    <div
      className="card p-3"
      style={{ border: '1px solid #f59e0b30' }}
    >
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{ width: 44, height: 44, background: '#2d1800', border: '1px solid #f59e0b50', fontSize: '1.4rem' }}
        >
          📺
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <p className="font-semibold text-sm text-white leading-tight truncate">{cfg.title}</p>
            <span style={{ background: '#2d1800', color: '#f59e0b', fontSize: '0.5rem', letterSpacing: '0.05em', padding: '2px 5px', borderRadius: 4, fontWeight: 700, flexShrink: 0 }}>AD</span>
          </div>
          <p className="text-xs text-gray-400 leading-tight">{cfg.description}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {cfg.spinsReward > 0 && <span className="text-blue-400 text-xs font-bold">+{cfg.spinsReward} 🎫</span>}
            {cfg.starsReward > 0 && <span className="text-yellow-400 text-xs font-bold">+{cfg.starsReward} ⭐</span>}
            {cfg.xpReward > 0 && <span className="text-purple-400 text-xs font-bold">+{cfg.xpReward} XP</span>}
            <span className="text-gray-600 text-xs">· repeatable</span>
          </div>
        </div>

        {/* The web component — shell is hidden, only the slotted buttons show */}
        <div className="flex-shrink-0">
          <adsgram-task
            ref={ref as React.RefObject<HTMLElement>}
            data-block-id={cfg.blockId}
            data-debug={import.meta.env.DEV ? 'true' : 'false'}
            style={{ display: 'contents' }}
          >
            {/* Slot: initial Go button */}
            <button
              slot="button"
              className="px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg, #92400e, #b45309)', color: '#fef3c7', border: '1px solid #f59e0b80', minWidth: 72 }}
            >
            </button>
            {/* Slot: claim after watching */}
            <button
              slot="claim"
              className="px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg, #14532d, #15803d)', color: '#bbf7d0', border: '1px solid #16a34a80', minWidth: 72 }}
            >
              ✓ Claim
            </button>
            {/* Slot: done state */}
            <div
              slot="done"
              className="px-3 py-2 rounded-xl text-xs font-bold"
              style={{ background: '#1a3a1a', color: '#4ade80', border: '1px solid #16a34a50', minWidth: 72, textAlign: 'center' }}
            >
              ✅ Done
            </div>
            {/* Slot: reward label (hidden visually but required by component) */}
            <span slot="reward" style={{ display: 'none' }}>reward</span>
          </adsgram-task>
        </div>
      </div>
    </div>
  )
}

// ── AdsGram Tasks Section — renders all blocks stacked ───────────────────────
function AdsgramTasksSection({ tgId, onReward }: {
  tgId: string
  onReward: (r: { spinsReward: number; starsReward: number; xpReward: number }) => void
}) {
  const blocks = parseAdsgramBlocks()
  if (blocks.length === 0) return null

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#f59e0b' }}>
        📺 Sponsored Tasks
      </p>
      <div className="flex flex-col gap-2">
        {blocks.map((cfg) => (
          <AdsgramTaskCard
            key={cfg.blockId}
            cfg={cfg}
            tgId={tgId}
            onReward={onReward}
          />
        ))}
      </div>
    </div>
  )
}

// ── Reward Toast ─────────────────────────────────────────────────────────────
function RewardToast({ result, onClose }: { result: RewardResult; onClose: () => void }) {
  const cfg = TOKENS[result.rewardToken as keyof typeof TOKENS]
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div
      className="bounce-in rounded-2xl p-4 flex flex-col items-center gap-2 text-center"
      style={{
        background: 'linear-gradient(135deg, #1a3a1a, #0f2a0f)',
        border: '2px solid #16a34a',
        boxShadow: '0 0 24px #16a34a40',
      }}
    >
      <p className="text-2xl">🎉</p>
      <p className="font-black text-green-400 text-base">Task Complete!</p>

      <div className="flex flex-wrap gap-2 justify-center">
        {cfg && (
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-black"
            style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}50` }}
          >
            {cfg.emoji} +{parseFloat(result.rewardAmount).toFixed(4)} {result.rewardToken}
          </span>
        )}
        {result.starsReward > 0 && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-black"
            style={{ background: '#2d2000', color: '#fbbf24', border: '1px solid #f59e0b50' }}>
            ⭐ +{result.starsReward} Stars
          </span>
        )}
        {result.xpReward > 0 && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-black"
            style={{ background: '#1e1040', color: '#a78bfa', border: '1px solid #7c3aed50' }}>
            ✨ +{result.xpReward} XP
          </span>
        )}
        {result.spinsReward > 0 && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-black"
            style={{ background: '#1a1a3a', color: '#c4b5fd', border: '1px solid #6d28d950' }}>
            🎫 +{result.spinsReward} Spin{result.spinsReward > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {result.newLevel > 1 && (
        <p className="text-purple-300 text-xs font-bold">Level {result.newLevel} · {result.newStars} ⭐ total</p>
      )}
    </div>
  )
}

// ── Admin Panel ──────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  title: '', description: '', taskType: 'telegram_join',
  url: '', rewardToken: 'NOT', rewardAmount: '10',
  starsReward: 10, xpReward: 15, spinsReward: 0, sortOrder: 99,
}

function AdminPanel({ tgId }: { tgId: string }) {
  const [allTasks, setAllTasks] = useState<(Task & { isActive: boolean })[]>([])
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [tab, setTab] = useState<'add' | 'manage'>('manage')

  const addTaskFn      = useServerFn(addTask)
  const toggleTaskFn   = useServerFn(toggleTask)
  const getAllTasksFn   = useServerFn(getAllTasksAdmin)

  const load = useCallback(() => {
    getAllTasksFn({ data: { adminTelegramId: tgId } })
      .then((t) => setAllTasks(t as any))
      .catch(() => {})
  }, [tgId])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!form.title || !form.url) return
    setSaving(true)
    setMsg(null)
    try {
      await addTaskFn({
        data: {
          adminTelegramId: tgId,
          ...form,
          starsReward: Number(form.starsReward),
          xpReward: Number(form.xpReward),
          spinsReward: Number(form.spinsReward),
          sortOrder: Number(form.sortOrder),
          taskType: form.taskType as any,
        },
      })
      setMsg({ type: 'ok', text: 'Task added!' })
      setForm({ ...EMPTY_FORM })
      load()
      setTab('manage')
    } catch (e) {
      setMsg({ type: 'err', text: getServerErrMsg(e, 'Failed') })
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (task: Task & { isActive: boolean }) => {
    setToggling(task.id)
    try {
      await toggleTaskFn({ data: { adminTelegramId: tgId, taskId: task.id, isActive: !task.isActive } })
      setAllTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, isActive: !t.isActive } : t))
    } catch {}
    finally { setToggling(null) }
  }

  const inputStyle = {
    background: '#0d0d1a', border: '1px solid #2e2e60',
    color: '#e2e8f0', outline: 'none', borderRadius: 10,
    padding: '8px 12px', width: '100%', fontSize: '0.8rem',
  }
  const labelStyle = { color: '#9ca3af', fontSize: '0.65rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 4, display: 'block' }

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: '#0d0d1a', border: '2px solid #7c3aed' }}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2" style={{ background: 'linear-gradient(135deg, #2d1b4e, #1a1040)' }}>
        <p className="font-black text-purple-300 text-sm">⚙️ Admin Panel</p>
        <p className="text-xs text-gray-500">Manage tasks</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: '#1e1e40' }}>
        {(['manage', 'add'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2 text-xs font-bold transition-all"
            style={{
              color: tab === t ? '#a78bfa' : '#6b7280',
              borderBottom: tab === t ? '2px solid #7c3aed' : '2px solid transparent',
              background: 'transparent',
            }}
          >
            {t === 'manage' ? '📋 Manage' : '➕ Add Task'}
          </button>
        ))}
      </div>

      <div className="p-4">
        {msg && (
          <div
            className="mb-3 rounded-xl px-3 py-2 text-xs font-bold"
            style={{
              background: msg.type === 'ok' ? '#1a3a1a' : '#2a0a0a',
              color: msg.type === 'ok' ? '#4ade80' : '#f87171',
              border: `1px solid ${msg.type === 'ok' ? '#16a34a' : '#7f1d1d'}`,
            }}
          >
            {msg.type === 'ok' ? '✅' : '❌'} {msg.text}
          </div>
        )}

        {tab === 'manage' && (
          <div className="flex flex-col gap-2">
            {allTasks.length === 0 && <p className="text-gray-500 text-xs text-center py-4">No tasks yet</p>}
            {allTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-2 rounded-xl p-2.5"
                style={{
                  background: task.isActive ? '#13132b' : '#0a0a14',
                  border: `1px solid ${task.isActive ? '#2e2e60' : '#1a1a30'}`,
                  opacity: task.isActive ? 1 : 0.5,
                }}
              >
                <span className="text-lg">{TASK_TYPE_ICON[task.taskType] ?? '📋'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">{task.title}</p>
                  <p className="text-gray-500" style={{ fontSize: '0.6rem' }}>
                    +{task.starsReward}⭐ · {task.rewardAmount} {task.rewardToken}
                  </p>
                </div>
                <button
                  onClick={() => handleToggle(task)}
                  disabled={toggling === task.id}
                  className="text-xs font-bold px-2.5 py-1 rounded-lg transition-all"
                  style={{
                    background: task.isActive ? '#2a0a0a' : '#1a2d1a',
                    color: task.isActive ? '#f87171' : '#4ade80',
                    border: `1px solid ${task.isActive ? '#7f1d1d' : '#16a34a'}`,
                  }}
                >
                  {toggling === task.id ? '⏳' : task.isActive ? 'Disable' : 'Enable'}
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === 'add' && (
          <div className="flex flex-col gap-3">
            <div>
              <label style={labelStyle}>Task Type</label>
              <select
                value={form.taskType}
                onChange={(e) => setForm((f) => ({ ...f, taskType: e.target.value }))}
                style={inputStyle}
              >
                {TASK_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.icon} {o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Title *</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Follow us on Twitter"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Description *</label>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Short description shown to users"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>URL *</label>
              <input
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://"
                style={inputStyle}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label style={labelStyle}>Reward Token</label>
                <select
                  value={form.rewardToken}
                  onChange={(e) => setForm((f) => ({ ...f, rewardToken: e.target.value }))}
                  style={inputStyle}
                >
                  {Object.keys(TOKENS).map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Reward Amount</label>
                <input
                  value={form.rewardAmount}
                  onChange={(e) => setForm((f) => ({ ...f, rewardAmount: e.target.value }))}
                  placeholder="10"
                  style={inputStyle}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label style={labelStyle}>⭐ Stars</label>
                <input
                  type="number" min={0}
                  value={form.starsReward}
                  onChange={(e) => setForm((f) => ({ ...f, starsReward: Number(e.target.value) }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>✨ XP</label>
                <input
                  type="number" min={0}
                  value={form.xpReward}
                  onChange={(e) => setForm((f) => ({ ...f, xpReward: Number(e.target.value) }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>🎫 Spins</label>
                <input
                  type="number" min={0}
                  value={form.spinsReward}
                  onChange={(e) => setForm((f) => ({ ...f, spinsReward: Number(e.target.value) }))}
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Sort Order (lower = first)</label>
              <input
                type="number" min={0}
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
                style={inputStyle}
              />
            </div>

            <button
              className="btn-primary"
              onClick={handleAdd}
              disabled={saving || !form.title || !form.url}
            >
              {saving ? '⏳ Adding...' : '➕ Add Task'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────
function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState<number | null>(null)
  const [pendingVerify, setPendingVerify] = useState<Set<number>>(new Set())
  const [rewardResult, setRewardResult] = useState<RewardResult | null>(null)
  const [adsgramReward, setAdsgramReward] = useState<{ spinsReward: number; starsReward: number; xpReward: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAdmin, setShowAdmin] = useState(false)

  const getTasksFn    = useServerFn(getTasks)
  const completeTaskFn = useServerFn(completeTask)

  const tgId = getTelegramUserId()
  const adminId = import.meta.env.VITE_ADMIN_TELEGRAM_ID as string | undefined
  const isAdmin = !!adminId && tgId === adminId

  useEffect(() => {
    getTasksFn({ data: { telegramId: tgId } })
      .then((t) => setTasks(t as Task[]))
      .catch(() => setError('Failed to load tasks'))
      .finally(() => setLoading(false))
  }, [])

  const handleGo = (task: Task) => {
    if (task.completed || completing !== null) return
    window.open(task.url, '_blank')
    hapticSelect()
    setPendingVerify((prev) => new Set(prev).add(task.id))
  }

  const handleVerify = async (task: Task) => {
    if (task.completed || completing !== null) return
    setCompleting(task.id)
    setError(null)
    try {
      const result = await completeTaskFn({ data: { telegramId: tgId, taskId: task.id } }) as RewardResult
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: true } : t)))
      setPendingVerify((prev) => { const s = new Set(prev); s.delete(task.id); return s })
      setRewardResult(result)
      hapticSuccess()
    } catch (e) {
      const msg = getServerErrMsg(e, 'Failed')
      if (msg === 'Already completed') {
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: true } : t)))
        setPendingVerify((prev) => { const s = new Set(prev); s.delete(task.id); return s })
      } else {
        setError(msg)
        hapticError()
      }
    } finally {
      setCompleting(null)
    }
  }

  const pending = tasks.filter((t) => !t.completed)
  const done    = tasks.filter((t) => t.completed)
  // Group pending tasks by type for section headers
  const typeGroups: Record<string, Task[]> = {}
  for (const t of pending) {
    if (!typeGroups[t.taskType]) typeGroups[t.taskType] = []
    typeGroups[t.taskType].push(t)
  }

  const typeLabels: Record<string, string> = {
    telegram_join:    '📱 Telegram',
    twitter_follow:   '🐦 Twitter / X',
    youtube_watch:    '▶️ YouTube',
    discord_join:     '💬 Discord',
    website_visit:    '🌐 Website',
    instagram_follow: '📸 Instagram',
    tiktok_follow:    '🎵 TikTok',
    custom:           '📋 Other',
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold shimmer-text">Tasks</h1>
          <p className="text-gray-400 text-sm">Complete tasks to earn tokens & stars</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAdmin((v) => !v)}
            className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
            style={{
              background: showAdmin ? '#2d1b4e' : '#1a1040',
              border: '1px solid #6d28d9',
              color: '#c4b5fd',
            }}
          >
            ⚙️ {showAdmin ? 'Hide' : 'Admin'}
          </button>
        )}
      </div>

      {/* Admin Panel */}
      {isAdmin && showAdmin && <AdminPanel tgId={tgId} />}

      {/* Progress */}
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
        {done.length > 0 && (
          <p className="text-xs text-gray-500 mt-1.5 text-center">
            🏆 {done.length} task{done.length > 1 ? 's' : ''} completed · keep going!
          </p>
        )}
      </div>

      {/* Reward Toast */}
      {rewardResult && (
        <RewardToast result={rewardResult} onClose={() => setRewardResult(null)} />
      )}

      {error && <p className="text-red-400 text-xs text-center">{error}</p>}

      {loading ? (
        <div className="text-center py-8 text-gray-400">
          <div className="text-3xl mb-2 animate-spin">⏳</div>
          Loading tasks...
        </div>
      ) : (
        <>
          {/* AdsGram Sponsored Tasks */}
          <AdsgramTasksSection
            tgId={tgId}
            onReward={(result) => {
              if (result.spinsReward > 0 || result.starsReward > 0 || result.xpReward > 0) {
                setAdsgramReward(result)
                setTimeout(() => setAdsgramReward(null), 4000)
              }
            }}
          />

          {/* AdsGram reward toast */}
          {adsgramReward && (
            <div
              className="bounce-in rounded-2xl p-3 flex items-center gap-3"
              style={{
                background: 'linear-gradient(135deg, #1a1a3a, #0f0f2a)',
                border: '2px solid #f59e0b',
                boxShadow: '0 0 20px #f59e0b30',
              }}
            >
              <span className="text-2xl">🎉</span>
              <div>
                <p className="font-black text-yellow-400 text-sm">Sponsored Task Done!</p>
                <div className="flex gap-2 mt-0.5">
                  {adsgramReward.spinsReward > 0 && <span className="text-blue-400 text-xs font-bold">+{adsgramReward.spinsReward} 🎫</span>}
                  {adsgramReward.starsReward > 0 && <span className="text-yellow-400 text-xs font-bold">+{adsgramReward.starsReward} ⭐</span>}
                  {adsgramReward.xpReward > 0 && <span className="text-purple-400 text-xs font-bold">+{adsgramReward.xpReward} XP</span>}
                </div>
              </div>
            </div>
          )}

          {/* Pending tasks grouped by type */}
          {pending.length > 0 && (
            <div className="flex flex-col gap-4">
              {Object.entries(typeGroups).map(([type, typeTasks]) => (
                <div key={type}>
                  <p
                    className="text-xs font-bold uppercase tracking-wider mb-2"
                    style={{ color: '#7c3aed' }}
                  >
                    {typeLabels[type] ?? type}
                  </p>
                  <div className="flex flex-col gap-2">
                    {typeTasks.map((task) => {
                      const cfg = TOKENS[task.rewardToken as keyof typeof TOKENS]
                      const isProcessing = completing === task.id
                      const isPendingVerify = pendingVerify.has(task.id)

                      return (
                        <div
                          key={task.id}
                          className="card p-3 transition-all"
                          style={{
                            border: isPendingVerify ? '1px solid #16a34a40' : undefined,
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className="flex items-center justify-center rounded-xl flex-shrink-0"
                              style={{
                                width: 40, height: 40,
                                background: '#1a1a3a',
                                border: '1px solid #2e2e60',
                                fontSize: '1.3rem',
                              }}
                            >
                              {TASK_TYPE_ICON[task.taskType] ?? '📋'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm text-white leading-tight">{task.title}</p>
                              <p className="text-xs text-gray-400 mt-0.5 leading-tight">{task.description}</p>
                              {/* Rewards row */}
                              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                {cfg && (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                                    style={{ background: cfg.bg, color: cfg.color }}
                                  >
                                    {cfg.emoji} +{parseFloat(task.rewardAmount).toFixed(
                                      parseFloat(task.rewardAmount) >= 1 ? 0 : 4
                                    )} {task.rewardToken}
                                  </span>
                                )}
                                {(task.starsReward ?? 0) > 0 && (
                                  <span className="text-yellow-400 text-xs font-bold">+{task.starsReward}⭐</span>
                                )}
                                {(task.xpReward ?? 0) > 0 && (
                                  <span className="text-purple-400 text-xs font-bold">+{task.xpReward}XP</span>
                                )}
                                {(task.spinsReward ?? 0) > 0 && (
                                  <span className="text-blue-400 text-xs font-bold">+{task.spinsReward}🎫</span>
                                )}
                              </div>
                            </div>

                            {/* Action button */}
                            <div className="flex-shrink-0 flex flex-col gap-1.5 items-end">
                              {isPendingVerify ? (
                                <>
                                  <button
                                    onClick={() => handleVerify(task)}
                                    disabled={isProcessing}
                                    className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                                    style={{
                                      background: isProcessing ? '#2a2a50' : '#1a3a1a',
                                      color: isProcessing ? '#6b7280' : '#4ade80',
                                      border: '1px solid #16a34a',
                                    }}
                                  >
                                    {isProcessing ? '⏳' : '✓ Verify'}
                                  </button>
                                  <button
                                    onClick={() => handleGo(task)}
                                    className="text-xs text-gray-500 underline"
                                  >
                                    Re-visit
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => handleGo(task)}
                                  disabled={isProcessing}
                                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                                  style={{
                                    background: 'linear-gradient(135deg, #4c1d95, #6d28d9)',
                                    color: 'white',
                                    border: '1px solid #7c3aed',
                                  }}
                                >
                                  Go →
                                </button>
                              )}
                            </div>
                          </div>

                          {isPendingVerify && !isProcessing && (
                            <div
                              className="mt-2 rounded-lg px-2 py-1.5 text-xs text-green-300"
                              style={{ background: '#0f2a0f', border: '1px solid #16a34a40' }}
                            >
                              ✅ Done? Tap <strong>Verify</strong> to claim your reward.
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Completed section */}
          {done.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                Completed ({done.length})
              </p>
              <div className="flex flex-col gap-1.5">
                {done.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl opacity-50"
                    style={{ background: '#12122a', border: '1px solid #1e1e40' }}
                  >
                    <span className="text-green-500">✅</span>
                    <span className="text-base">{TASK_TYPE_ICON[task.taskType] ?? '📋'}</span>
                    <span className="text-xs text-gray-400 flex-1 truncate">{task.title}</span>
                    <span className="text-green-500 text-xs font-bold">Done</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tasks.length === 0 && !loading && (
            <div className="text-center py-10 text-gray-500">
              <p className="text-3xl mb-2">📋</p>
              <p>No tasks available yet</p>
              {isAdmin && (
                <button
                  onClick={() => { setShowAdmin(true); }}
                  className="mt-3 text-purple-400 text-xs underline"
                >
                  Add your first task →
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
