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

// ── AdsGram Imperative API ──────────────────────────────────────────────────
//
// Root cause of the broken UI in the screenshot:
//   The <adsgram-task> web component renders its OWN full shadow-DOM row
//   (thumbnail, title, orange "Complete" button) regardless of what we put in
//   slots. Both the component's UI and our slotted content were visible at once,
//   causing the overlapping layout. Slots are NOT supported by this component.
//
// Fix: use the AdsGram JS API imperatively.
//   - AdController = window.Adsgram.init({ blockId })
//   - AdController.show() returns a Promise that resolves on reward / rejects on error
//   - We render 100% our own card UI; the component element is never in the DOM.

declare global {
  interface Window {
    Adsgram?: {
      init: (config: { blockId: string; debug?: boolean }) => {
        show: () => Promise<{ done: boolean }>
        destroy: () => void
      }
    }
  }
}

interface AdsgramTaskConfig {
  blockId:     string
  spinsReward: number
  starsReward: number
  xpReward:    number
  title:       string
  description: string
}

/**
 * Parse VITE_ADSGRAM_TASK_BLOCKS env var.
 * Format per entry: blockId:spins:stars:xp:title:description
 * Multiple entries separated by semicolons.
 * Falls back to VITE_ADSGRAM_TASK_BLOCK_ID for a single block.
 */
function parseAdsgramBlocks(): AdsgramTaskConfig[] {
  const raw = import.meta.env.VITE_ADSGRAM_TASK_BLOCKS as string | undefined
  if (raw?.trim()) {
    return raw.split(';').flatMap((entry) => {
      const parts   = entry.split(':')
      const blockId = parts[0]?.trim()
      if (!blockId) return []
      return [{
        blockId,
        spinsReward: parseInt(parts[1] ?? '1', 10)  || 1,
        starsReward: parseInt(parts[2] ?? '5', 10)  || 5,
        xpReward:    parseInt(parts[3] ?? '15', 10) || 15,
        title:       parts[4]?.trim() || 'Watch a Sponsored Video',
        description: parts[5]?.trim() || 'Watch a short ad to earn rewards',
      }]
    })
  }
  const single = import.meta.env.VITE_ADSGRAM_TASK_BLOCK_ID as string | undefined
  if (single?.trim()) {
    return [{
      blockId:     single.trim(),
      spinsReward: 1,
      starsReward: 5,
      xpReward:    15,
      title:       'Watch a Sponsored Video',
      description: 'Watch a short ad to earn rewards',
    }]
  }
  return []
}

// ── Single AdsGram task card — fully custom UI, zero web-component DOM ────────
function AdsgramTaskCard({ cfg, tgId, onReward }: {
  cfg:      AdsgramTaskConfig
  tgId:     string
  onReward: (r: { spinsReward: number; starsReward: number; xpReward: number }) => void
}) {
  const [state, setState]       = useState<'idle' | 'watching' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg]     = useState('')
  const controllerRef           = useRef<ReturnType<NonNullable<Window['Adsgram']>['init']> | null>(null)
  const earnSpinsFn             = useServerFn(earnSpinsFromAd)

  // Clean up controller on unmount
  useEffect(() => () => { controllerRef.current?.destroy() }, [])

  const handleGo = async () => {
    if (state === 'watching' || state === 'done') return
    setErrMsg('')

    if (!window.Adsgram) {
      setErrMsg('Ad SDK not loaded — refresh and try again')
      hapticError()
      return
    }

    setState('watching')
    hapticSelect()

    // Initialise a fresh controller every time (required by AdsGram)
    const controller = window.Adsgram.init({
      blockId: cfg.blockId,
      debug:   import.meta.env.DEV,
    })
    controllerRef.current = controller

    try {
      await controller.show()
      // show() resolves → user watched and reward is granted
      try { await earnSpinsFn({ data: { telegramId: tgId } }) } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (!msg.startsWith('AD_COOLDOWN:')) console.warn('earnSpins error:', msg)
      }
      setState('done')
      onReward({ spinsReward: cfg.spinsReward, starsReward: cfg.starsReward, xpReward: cfg.xpReward })
      hapticSuccess()
    } catch (err: unknown) {
      // show() rejects on: user skip, no fill, or SDK error
      const detail = (err as any)?.description ?? (err instanceof Error ? err.message : String(err))
      console.warn('AdsGram error:', cfg.blockId, detail)
      setState('idle')
      setErrMsg('No ad available — try again later')
      hapticError()
    } finally {
      controllerRef.current = null
    }
  }

  return (
    <div
      className="card"
      style={{
        padding: 14,
        border: state === 'done' ? '1px solid #16a34a50' : '1px solid #f59e0b30',
        transition: 'border-color 0.25s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>

        {/* Icon */}
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: '#2d1800', border: '1px solid #f59e0b50',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22,
        }}>
          📺
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title + AD badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <p style={{
              fontWeight: 700, fontSize: 13, color: '#fff', margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {cfg.title}
            </p>
            <span style={{
              background: '#2d1800', color: '#f59e0b', fontSize: 9,
              letterSpacing: '0.06em', padding: '2px 5px', borderRadius: 4,
              fontWeight: 800, flexShrink: 0,
            }}>
              AD
            </span>
          </div>

          {/* Description */}
          <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 8px', lineHeight: 1.4 }}>
            {cfg.description}
          </p>

          {/* Reward pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            {cfg.spinsReward > 0 && (
              <span style={{ background: '#1a1a3a', color: '#93c5fd', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, border: '1px solid #3b82f625' }}>
                +{cfg.spinsReward} 🎫
              </span>
            )}
            {cfg.starsReward > 0 && (
              <span style={{ background: '#2d2000', color: '#fbbf24', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, border: '1px solid #f59e0b25' }}>
                +{cfg.starsReward} ⭐
              </span>
            )}
            {cfg.xpReward > 0 && (
              <span style={{ background: '#1e1040', color: '#c4b5fd', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, border: '1px solid #7c3aed25' }}>
                +{cfg.xpReward} XP
              </span>
            )}
            <span style={{ color: '#4b5563', fontSize: 10 }}>· repeatable</span>
          </div>

          {/* Error message */}
          {errMsg && (
            <p style={{ fontSize: 10, color: '#f87171', marginTop: 5, fontStyle: 'italic' }}>{errMsg}</p>
          )}
        </div>

        {/* Action button — 100% our own, no web component */}
        <div style={{ flexShrink: 0 }}>
          {state === 'done' ? (
            <div style={{
              padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
              background: '#1a3a1a', color: '#4ade80', border: '1px solid #16a34a60',
              whiteSpace: 'nowrap', textAlign: 'center',
            }}>
              ✅ Done
            </div>
          ) : state === 'watching' ? (
            <div style={{
              padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
              background: '#1a1a3a', color: '#a78bfa', border: '1px solid #7c3aed50',
              whiteSpace: 'nowrap', textAlign: 'center',
            }}>
              ⏳ Playing…
            </div>
          ) : (
            <button
              onClick={handleGo}
              style={{
                padding: '9px 18px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                background: 'linear-gradient(135deg,#92400e,#b45309)',
                color: '#fef3c7', border: '1px solid #f59e0b70',
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                transition: 'opacity 0.15s',
              }}
              onMouseDown={e => (e.currentTarget.style.opacity = '0.8')}
              onMouseUp={e   => (e.currentTarget.style.opacity = '1')}
            >
              ▶ Watch
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── AdsGram Tasks Section ─────────────────────────────────────────────────────
function AdsgramTasksSection({ tgId, onReward }: {
  tgId:     string
  onReward: (r: { spinsReward: number; starsReward: number; xpReward: number }) => void
}) {
  const blocks = parseAdsgramBlocks()
  if (blocks.length === 0) return null

  return (
    <div>
      <p style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: '#f59e0b', marginBottom: 10,
      }}>
        📺 Sponsored Tasks
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {blocks.map((cfg) => (
          <AdsgramTaskCard key={cfg.blockId} cfg={cfg} tgId={tgId} onReward={onReward} />
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
      className="bounce-in rounded-2xl p-4"
      style={{
        background: 'linear-gradient(135deg,#1a3a1a,#0f2a0f)',
        border: '2px solid #16a34a',
        boxShadow: '0 0 24px #16a34a40',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center',
      }}
    >
      <p style={{ fontSize: 28 }}>🎉</p>
      <p style={{ fontWeight: 900, color: '#4ade80', fontSize: 15, margin: 0 }}>Task Complete!</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
        {cfg && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 900, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}50` }}>
            {cfg.emoji} +{parseFloat(result.rewardAmount).toFixed(4)} {result.rewardToken}
          </span>
        )}
        {result.starsReward > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 900, background: '#2d2000', color: '#fbbf24', border: '1px solid #f59e0b50' }}>
            ⭐ +{result.starsReward} Stars
          </span>
        )}
        {result.xpReward > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 900, background: '#1e1040', color: '#a78bfa', border: '1px solid #7c3aed50' }}>
            ✨ +{result.xpReward} XP
          </span>
        )}
        {result.spinsReward > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 900, background: '#1a1a3a', color: '#c4b5fd', border: '1px solid #6d28d950' }}>
            🎫 +{result.spinsReward} Spin{result.spinsReward > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {result.newLevel > 1 && (
        <p style={{ color: '#c4b5fd', fontSize: 11, fontWeight: 700 }}>Level {result.newLevel} · {result.newStars} ⭐ total</p>
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
  const [allTasks, setAllTasks]   = useState<(Task & { isActive: boolean })[]>([])
  const [form, setForm]           = useState({ ...EMPTY_FORM })
  const [saving, setSaving]       = useState(false)
  const [toggling, setToggling]   = useState<number | null>(null)
  const [msg, setMsg]             = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [tab, setTab]             = useState<'add' | 'manage'>('manage')

  const addTaskFn    = useServerFn(addTask)
  const toggleTaskFn = useServerFn(toggleTask)
  const getAllTasksFn = useServerFn(getAllTasksAdmin)

  const load = useCallback(() => {
    getAllTasksFn({ data: { adminTelegramId: tgId } })
      .then((t) => setAllTasks(t as any))
      .catch(() => {})
  }, [tgId])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!form.title || !form.url) return
    setSaving(true); setMsg(null)
    try {
      await addTaskFn({ data: { adminTelegramId: tgId, ...form, starsReward: Number(form.starsReward), xpReward: Number(form.xpReward), spinsReward: Number(form.spinsReward), sortOrder: Number(form.sortOrder), taskType: form.taskType as any } })
      setMsg({ type: 'ok', text: 'Task added!' })
      setForm({ ...EMPTY_FORM })
      load(); setTab('manage')
    } catch (e) {
      setMsg({ type: 'err', text: getServerErrMsg(e, 'Failed') })
    } finally { setSaving(false) }
  }

  const handleToggle = async (task: Task & { isActive: boolean }) => {
    setToggling(task.id)
    try {
      await toggleTaskFn({ data: { adminTelegramId: tgId, taskId: task.id, isActive: !task.isActive } })
      setAllTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, isActive: !t.isActive } : t))
    } catch {} finally { setToggling(null) }
  }

  const inputStyle: React.CSSProperties = { background: '#0d0d1a', border: '1px solid #2e2e60', color: '#e2e8f0', outline: 'none', borderRadius: 10, padding: '8px 12px', width: '100%', fontSize: '0.8rem', fontFamily: 'inherit', boxSizing: 'border-box' }
  const labelStyle: React.CSSProperties = { color: '#9ca3af', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block' }

  return (
    <div style={{ background: '#0d0d1a', border: '2px solid #7c3aed', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px 10px', background: 'linear-gradient(135deg,#2d1b4e,#1a1040)' }}>
        <p style={{ fontWeight: 900, color: '#c4b5fd', fontSize: 14, margin: 0 }}>⚙️ Admin Panel</p>
        <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>Manage tasks</p>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #1e1e40' }}>
        {(['manage', 'add'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex: 1, padding: '9px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: 'transparent', border: 'none', borderBottom: tab === t ? '2px solid #7c3aed' : '2px solid transparent', color: tab === t ? '#a78bfa' : '#6b7280', marginBottom: -1 }}>
            {t === 'manage' ? '📋 Manage' : '➕ Add Task'}
          </button>
        ))}
      </div>

      <div style={{ padding: 16 }}>
        {msg && (
          <div style={{ marginBottom: 12, borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 700, background: msg.type === 'ok' ? '#1a3a1a' : '#2a0a0a', color: msg.type === 'ok' ? '#4ade80' : '#f87171', border: `1px solid ${msg.type === 'ok' ? '#16a34a' : '#7f1d1d'}` }}>
            {msg.type === 'ok' ? '✅' : '❌'} {msg.text}
          </div>
        )}

        {tab === 'manage' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {allTasks.length === 0 && <p style={{ color: '#6b7280', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>No tasks yet</p>}
            {allTasks.map((task) => (
              <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10, padding: 10, background: task.isActive ? '#13132b' : '#0a0a14', border: `1px solid ${task.isActive ? '#2e2e60' : '#1a1a30'}`, opacity: task.isActive ? 1 : 0.6 }}>
                <span style={{ fontSize: 18 }}>{TASK_TYPE_ICON[task.taskType] ?? '📋'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#fff', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</p>
                  <p style={{ fontSize: 10, color: '#6b7280', margin: 0 }}>+{task.starsReward}⭐ · {task.rewardAmount} {task.rewardToken}</p>
                </div>
                <button onClick={() => handleToggle(task)} disabled={toggling === task.id}
                  style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', background: task.isActive ? '#2a0a0a' : '#1a2d1a', color: task.isActive ? '#f87171' : '#4ade80', border: `1px solid ${task.isActive ? '#7f1d1d' : '#16a34a'}` }}>
                  {toggling === task.id ? '⏳' : task.isActive ? 'Disable' : 'Enable'}
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === 'add' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label style={labelStyle}>Task Type</label><select value={form.taskType} onChange={(e) => setForm((f) => ({ ...f, taskType: e.target.value }))} style={inputStyle}>{TASK_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}</select></div>
            <div><label style={labelStyle}>Title *</label><input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Follow us on Twitter" style={inputStyle} /></div>
            <div><label style={labelStyle}>Description *</label><input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Short description" style={inputStyle} /></div>
            <div><label style={labelStyle}>URL *</label><input value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://" style={inputStyle} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><label style={labelStyle}>Reward Token</label><select value={form.rewardToken} onChange={(e) => setForm((f) => ({ ...f, rewardToken: e.target.value }))} style={inputStyle}>{Object.keys(TOKENS).map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
              <div><label style={labelStyle}>Amount</label><input value={form.rewardAmount} onChange={(e) => setForm((f) => ({ ...f, rewardAmount: e.target.value }))} placeholder="10" style={inputStyle} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div><label style={labelStyle}>⭐ Stars</label><input type="number" min={0} value={form.starsReward} onChange={(e) => setForm((f) => ({ ...f, starsReward: Number(e.target.value) }))} style={inputStyle} /></div>
              <div><label style={labelStyle}>✨ XP</label><input type="number" min={0} value={form.xpReward} onChange={(e) => setForm((f) => ({ ...f, xpReward: Number(e.target.value) }))} style={inputStyle} /></div>
              <div><label style={labelStyle}>🎫 Spins</label><input type="number" min={0} value={form.spinsReward} onChange={(e) => setForm((f) => ({ ...f, spinsReward: Number(e.target.value) }))} style={inputStyle} /></div>
            </div>
            <div><label style={labelStyle}>Sort Order</label><input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))} style={inputStyle} /></div>
            <button className="btn-primary" onClick={handleAdd} disabled={saving || !form.title || !form.url}>{saving ? '⏳ Adding...' : '➕ Add Task'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────
function TasksPage() {
  const [tasks, setTasks]             = useState<Task[]>([])
  const [loading, setLoading]         = useState(true)
  const [completing, setCompleting]   = useState<number | null>(null)
  const [pendingVerify, setPendingVerify] = useState<Set<number>>(new Set())
  const [rewardResult, setRewardResult]   = useState<RewardResult | null>(null)
  const [adsgramReward, setAdsgramReward] = useState<{ spinsReward: number; starsReward: number; xpReward: number } | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [showAdmin, setShowAdmin]     = useState(false)

  const getTasksFn     = useServerFn(getTasks)
  const completeTaskFn = useServerFn(completeTask)

  const tgId    = getTelegramUserId()
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
    setCompleting(task.id); setError(null)
    try {
      const result = await completeTaskFn({ data: { telegramId: tgId, taskId: task.id } }) as RewardResult
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: true } : t)))
      setPendingVerify((prev) => { const s = new Set(prev); s.delete(task.id); return s })
      setRewardResult(result); hapticSuccess()
    } catch (e) {
      const msg = getServerErrMsg(e, 'Failed')
      if (msg === 'Already completed') {
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: true } : t)))
        setPendingVerify((prev) => { const s = new Set(prev); s.delete(task.id); return s })
      } else { setError(msg); hapticError() }
    } finally { setCompleting(null) }
  }

  const pending = tasks.filter((t) => !t.completed)
  const done    = tasks.filter((t) =>  t.completed)

  // Group pending by type for section headers
  const typeGroups: Record<string, Task[]> = {}
  for (const t of pending) {
    if (!typeGroups[t.taskType]) typeGroups[t.taskType] = []
    typeGroups[t.taskType].push(t)
  }

  const typeLabels: Record<string, string> = {
    telegram_join:    '📱 Telegram', twitter_follow: '🐦 Twitter / X',
    youtube_watch:    '▶️ YouTube',  discord_join:   '💬 Discord',
    website_visit:    '🌐 Website',  instagram_follow: '📸 Instagram',
    tiktok_follow:    '🎵 TikTok',   custom:         '📋 Other',
  }

  return (
    <div className="page">

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="shimmer-text" style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Tasks</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '3px 0 0' }}>Complete tasks · earn tokens & stars</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowAdmin((v) => !v)}
            style={{ padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: showAdmin ? '#2d1b4e' : '#1a1040', border: '1px solid #6d28d9', color: '#c4b5fd' }}>
            ⚙️ {showAdmin ? 'Hide' : 'Admin'}
          </button>
        )}
      </div>

      {/* ── Admin Panel ── */}
      {isAdmin && showAdmin && <AdminPanel tgId={tgId} />}

      {/* ── Progress bar ── */}
      <div className="card p-3">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
          <span style={{ color: '#9ca3af' }}>Progress</span>
          <span style={{ color: '#a78bfa', fontWeight: 700 }}>{done.length}/{tasks.length} completed</span>
        </div>
        <div style={{ height: 8, background: '#1e1e40', borderRadius: 20, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: tasks.length ? `${(done.length / tasks.length) * 100}%` : '0%', background: 'linear-gradient(90deg,#7c3aed,#a78bfa)', borderRadius: 20, transition: 'width 0.5s ease' }} />
        </div>
        {done.length > 0 && (
          <p style={{ fontSize: 11, color: '#6b7280', marginTop: 6, textAlign: 'center' }}>
            🏆 {done.length} task{done.length > 1 ? 's' : ''} completed · keep going!
          </p>
        )}
      </div>

      {/* ── Reward toast ── */}
      {rewardResult && <RewardToast result={rewardResult} onClose={() => setRewardResult(null)} />}

      {error && <p style={{ color: '#f87171', fontSize: 12, textAlign: 'center' }}>{error}</p>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#6b7280' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }} className="spin-slow">⏳</div>
          Loading tasks...
        </div>
      ) : (
        <>
          {/* ── AdsGram Sponsored Tasks ── */}
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
            <div className="bounce-in" style={{ background: 'linear-gradient(135deg,#1a1a3a,#0f0f2a)', border: '2px solid #f59e0b', boxShadow: '0 0 20px #f59e0b30', borderRadius: 16, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 24 }}>🎉</span>
              <div>
                <p style={{ fontWeight: 900, color: '#fbbf24', fontSize: 14, margin: '0 0 3px' }}>Sponsored Task Done!</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  {adsgramReward.spinsReward > 0 && <span style={{ color: '#93c5fd', fontSize: 12, fontWeight: 700 }}>+{adsgramReward.spinsReward} 🎫</span>}
                  {adsgramReward.starsReward > 0 && <span style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700 }}>+{adsgramReward.starsReward} ⭐</span>}
                  {adsgramReward.xpReward > 0 && <span style={{ color: '#c4b5fd', fontSize: 12, fontWeight: 700 }}>+{adsgramReward.xpReward} XP</span>}
                </div>
              </div>
            </div>
          )}

          {/* ── Pending tasks grouped by type ── */}
          {pending.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {Object.entries(typeGroups).map(([type, typeTasks]) => (
                <div key={type}>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7c3aed', marginBottom: 8 }}>
                    {typeLabels[type] ?? type}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {typeTasks.map((task) => {
                      const cfg            = TOKENS[task.rewardToken as keyof typeof TOKENS]
                      const isProcessing   = completing === task.id
                      const isPendingVerify = pendingVerify.has(task.id)

                      return (
                        <div key={task.id} className="card p-3" style={{ border: isPendingVerify ? '1px solid #16a34a40' : undefined, transition: 'border-color 0.2s' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>

                            {/* Icon */}
                            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#1a1a3a', border: '1px solid #2e2e60', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', flexShrink: 0 }}>
                              {TASK_TYPE_ICON[task.taskType] ?? '📋'}
                            </div>

                            {/* Info */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontWeight: 600, fontSize: 13, color: '#fff', margin: '0 0 3px', lineHeight: 1.3 }}>{task.title}</p>
                              <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 8px', lineHeight: 1.4 }}>{task.description}</p>
                              {/* Rewards */}
                              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                                {cfg && (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color }}>
                                    {cfg.emoji} +{parseFloat(task.rewardAmount).toFixed(parseFloat(task.rewardAmount) >= 1 ? 0 : 4)} {task.rewardToken}
                                  </span>
                                )}
                                {(task.starsReward ?? 0) > 0 && <span style={{ color: '#fbbf24', fontSize: 11, fontWeight: 700 }}>+{task.starsReward}⭐</span>}
                                {(task.xpReward   ?? 0) > 0 && <span style={{ color: '#a78bfa', fontSize: 11, fontWeight: 700 }}>+{task.xpReward}XP</span>}
                                {(task.spinsReward ?? 0) > 0 && <span style={{ color: '#93c5fd', fontSize: 11, fontWeight: 700 }}>+{task.spinsReward}🎫</span>}
                              </div>
                            </div>

                            {/* Action */}
                            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                              {isPendingVerify ? (
                                <>
                                  <button onClick={() => handleVerify(task)} disabled={isProcessing}
                                    style={{ padding: '7px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: isProcessing ? '#2a2a50' : '#1a3a1a', color: isProcessing ? '#6b7280' : '#4ade80', border: '1px solid #16a34a' }}>
                                    {isProcessing ? '⏳' : '✓ Verify'}
                                  </button>
                                  <button onClick={() => handleGo(task)} style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
                                    Re-visit
                                  </button>
                                </>
                              ) : (
                                <button onClick={() => handleGo(task)} disabled={isProcessing}
                                  style={{ padding: '7px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(135deg,#4c1d95,#6d28d9)', color: '#fff', border: '1px solid #7c3aed' }}>
                                  Go →
                                </button>
                              )}
                            </div>
                          </div>

                          {isPendingVerify && !isProcessing && (
                            <div style={{ marginTop: 10, borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#86efac', background: '#0f2a0f', border: '1px solid #16a34a40' }}>
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

          {/* ── Completed ── */}
          {done.length > 0 && (
            <div>
              <p style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, fontWeight: 700 }}>
                Completed ({done.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {done.map((task) => (
                  <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: '#12122a', border: '1px solid #1e1e40', opacity: 0.55 }}>
                    <span>✅</span>
                    <span style={{ fontSize: 16 }}>{TASK_TYPE_ICON[task.taskType] ?? '📋'}</span>
                    <span style={{ flex: 1, fontSize: 12, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
                    <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 700 }}>Done</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tasks.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#6b7280' }}>
              <p style={{ fontSize: 32, margin: '0 0 8px' }}>📋</p>
              <p>No tasks available yet</p>
              {isAdmin && (
                <button onClick={() => setShowAdmin(true)} style={{ marginTop: 12, background: 'none', border: 'none', color: '#a78bfa', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
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
