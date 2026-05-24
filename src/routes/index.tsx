import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { SpinWheel } from '../components/SpinWheel.js'
import { ActivityFeed } from '../components/ActivityFeed.js'
import { TokenIcon } from '../components/TokenIcon.js'
import { initUser } from '../server/user.functions.js'
import { spinWheel, getSpinStatus, earnSpinsFromAd, purchaseSpinBoost, purchaseLuckyCharm } from '../server/spin.functions.js'
import { getBalances, getWithdrawals, requestWithdrawal } from '../server/withdraw.functions.js'
import { getUser } from '../server/user.functions.js'
import {
  getTelegramUser,
  getTelegramUserId,
  getTelegramStartParam,
  initTelegramApp,
  hapticSuccess,
  hapticError,
  hapticImpact,
  hapticSelect,
} from '../lib/telegram.js'
import {
  TOKENS, RARITY_TIERS, ACHIEVEMENTS, LEVEL_XP_THRESHOLDS,
  AD_COOLDOWN_MS, SPIN_BOOST_COST_STARS, LUCKY_CHARM_COST_STARS,
  MIN_ACTIVITY_SPINS, MIN_ACTIVITY_ADS, WITHDRAWAL_STAR_FEE_PCT,
} from '../lib/constants.js'
import type { Rarity } from '../lib/constants.js'
import createAdHandler from 'monetag-tg-sdk'

export const Route = createFileRoute('/')({ component: SpinPage })

async function buildDeviceFingerprint(): Promise<string> {
  try {
    const signals = [
      navigator.userAgent,
      navigator.language,
      String(screen.width) + 'x' + String(screen.height),
      String(screen.colorDepth),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      String(navigator.hardwareConcurrency ?? ''),
    ].join('|')
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signals))
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return ''
  }
}

// Monetag rewarded interstitial via official npm package
const moneTagAdHandler = createAdHandler(11049772)

interface UserState {
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

interface Balance { token: string; amount: number }
interface Withdrawal {
  id: number; token: string; amount: string; starsCost: number;
  walletAddress: string; status: string; createdAt: string | null
}

function XPBar({ xp, level }: { xp: number; level: number }) {
  const currentLevelXP = LEVEL_XP_THRESHOLDS[level - 1] ?? 0
  const nextLevelXP    = LEVEL_XP_THRESHOLDS[level] ?? LEVEL_XP_THRESHOLDS[LEVEL_XP_THRESHOLDS.length - 1]
  const progress       = Math.min(100, ((xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100)
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs mb-1" style={{ color: '#9ca3af' }}>
        <span>Level {level}</span>
        <span>{xp.toLocaleString()} / {nextLevelXP.toLocaleString()} XP</span>
      </div>
      <div className="rounded-full overflow-hidden" style={{ height: 6, background: '#1e1e40' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #7c3aed, #a78bfa, #f9a8d4)',
          }}
        />
      </div>
    </div>
  )
}

function RarityBadge({ rarity }: { rarity: Rarity }) {
  const tier = RARITY_TIERS[rarity]
  if (rarity === 'common') return null
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-black uppercase tracking-wider"
      style={{
        background: `${tier.glow}`,
        color: tier.color,
        border: `1px solid ${tier.color}60`,
        textShadow: `0 0 8px ${tier.color}`,
      }}
    >
      {rarity === 'legendary' ? '✨' : rarity === 'epic' ? '💜' : rarity === 'rare' ? '💙' : '💚'}
      {tier.label}
    </span>
  )
}

function AvatarOrInitial({ photoUrl, name, size = 36 }: { photoUrl?: string | null; name: string; size?: number }) {
  const [imgErr, setImgErr] = useState(false)
  if (photoUrl && !imgErr) {
    return (
      <img
        src={photoUrl}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ border: '2px solid #4c1d95' }}
        onError={() => setImgErr(true)}
      />
    )
  }
  const initials = name.slice(0, 2).toUpperCase()
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white"
      style={{
        width: size, height: size, fontSize: size * 0.35,
        background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
        border: '2px solid #4c1d95',
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  )
}

function formatAmount(n: number): string {
  if (n >= 1000) return n.toFixed(0)
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(4)
  return n.toFixed(8)
}

// ── Profile Modal (with Achievements tab + Wallet tab) ──────────────────────
function ProfileModal({
  open, onClose, user, balances, tgId,
}: {
  open: boolean; onClose: () => void
  user: UserState; balances: Balance[]; tgId: string
}) {
  const [tab, setTab] = useState<'profile' | 'badges'>('profile')
  const allAchievements = Object.values(ACHIEVEMENTS)
  const unlocked = user.achievements.filter(Boolean)
  const done = allAchievements.filter(a => unlocked.includes(a.id))
  const todo = allAchievements.filter(a => !unlocked.includes(a.id))
  const pct = Math.round((done.length / allAchievements.length) * 100)

  if (!open) return null
  return (
    <>
      <div onClick={onClose} className="modal-backdrop" />
      <div className="modal-sheet" style={{ maxHeight: '88dvh' }}>
        <div className="modal-handle"><div className="modal-handle-bar" /></div>

        {/* Tab selector */}
        <div style={{ display: 'flex', gap: 8, padding: '10px 16px 0', flexShrink: 0 }}>
          {(['profile', 'badges'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
                background: tab === t ? 'linear-gradient(135deg,#7c3aed,#5b21b6)' : '#1a1a30',
                color: tab === t ? '#fff' : '#6b7280',
              }}>
              {t === 'profile' ? '👤 Profile' : '🎖️ Badges'}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {tab === 'profile' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Big avatar + info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <AvatarOrInitial photoUrl={user.photoUrl} name={user.firstName} size={64} />
                <div>
                  <p style={{ fontWeight: 800, fontSize: 18, color: '#fff', marginBottom: 4 }}>
                    {user.username ? `@${user.username}` : user.firstName}
                  </p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', color: '#fff', fontWeight: 800, fontSize: 11, padding: '3px 9px', borderRadius: 6 }}>LVL {user.level}</span>
                    {user.dailyStreak > 0 && <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 13 }}>🔥 {user.dailyStreak} day streak</span>}
                  </div>
                </div>
              </div>

              {/* XP bar */}
              <XPBar xp={user.xp} level={user.level} />

              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { icon: '⭐', val: user.stars.toLocaleString(), lbl: 'Stars', color: '#fbbf24' },
                  { icon: '🎡', val: user.spinCount.toLocaleString(), lbl: 'Spins', color: '#a78bfa' },
                  { icon: '📺', val: user.adsWatched.toLocaleString(), lbl: 'Ads', color: '#60a5fa' },
                ].map(s => (
                  <div key={s.lbl} style={{ background: '#13132b', border: '1px solid #2e2e60', borderRadius: 12, padding: '12px 8px', textAlign: 'center' }}>
                    <p style={{ fontSize: 16, fontWeight: 900, color: s.color }}>{s.icon} {s.val}</p>
                    <p style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>{s.lbl}</p>
                  </div>
                ))}
              </div>

              {/* Recent achievements preview */}
              {done.length > 0 && (
                <div style={{ background: '#13132b', border: '1px solid #2e2e60', borderRadius: 12, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <p style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Achievements</p>
                    <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700 }}>{done.length}/{allAchievements.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {done.slice(0, 6).map(a => (
                      <span key={a.id} title={a.label} style={{ fontSize: 26 }}>{a.emoji}</span>
                    ))}
                    {done.length > 6 && <span style={{ fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>+{done.length - 6}</span>}
                  </div>
                  <button onClick={() => setTab('badges')}
                    style={{ marginTop: 10, width: '100%', background: '#1a1a30', border: '1px solid #2e2e60', borderRadius: 8, padding: '7px', color: '#a78bfa', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    View all badges →
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'badges' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Progress */}
              <div style={{ background: '#13132b', border: '1px solid #2e2e60', borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
                  <span>Progress</span><span style={{ color: '#a78bfa', fontWeight: 700 }}>{pct}%</span>
                </div>
                <div style={{ height: 8, background: '#1e1e40', borderRadius: 20, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#7c3aed,#a78bfa)', borderRadius: 20, transition: 'width 0.5s ease' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 12 }}>
                  {[{ v: done.length, l: 'Unlocked', c: '#a78bfa' }, { v: user.xp.toLocaleString(), l: 'Total XP', c: '#fbbf24' }, { v: `Lv.${user.level}`, l: 'Level', c: '#fff' }].map(s => (
                    <div key={s.l} style={{ textAlign: 'center' }}>
                      <p style={{ fontWeight: 900, fontSize: 18, color: s.c }}>{s.v}</p>
                      <p style={{ fontSize: 11, color: '#6b7280' }}>{s.l}</p>
                    </div>
                  ))}
                </div>
              </div>

              {done.length > 0 && (
                <>
                  <p style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: -6 }}>✅ Unlocked</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {done.map(a => (
                      <div key={a.id} style={{ background: 'linear-gradient(135deg,#1a2a1a,#0d1a0d)', border: '1px solid #16a34a', borderRadius: 14, padding: 12, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                        <span style={{ fontSize: 28 }}>{a.emoji}</span>
                        <p style={{ fontSize: 11, fontWeight: 700, color: '#4ade80' }}>{a.label}</p>
                        <p style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.4 }}>{a.desc}</p>
                        <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700 }}>+{a.xp} XP</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {todo.length > 0 && (
                <>
                  <p style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: -6 }}>🔒 Locked</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, opacity: 0.5 }}>
                    {todo.map(a => (
                      <div key={a.id} style={{ background: '#13132b', border: '1px solid #2e2e60', borderRadius: 14, padding: 12, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                        <span style={{ fontSize: 28, filter: 'grayscale(1)' }}>{a.emoji}</span>
                        <p style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af' }}>{a.label}</p>
                        <p style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.4 }}>{a.desc}</p>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>+{a.xp} XP</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}


// ── Wallet Drawer ────────────────────────────────────────────────────────────
function WalletDrawer({
  open, onClose, tgId,
  balances, setBalances,
  stars, setStars,
}: {
  open: boolean
  onClose: () => void
  tgId: string
  balances: Balance[]
  setBalances: (b: Balance[]) => void
  stars: number
  setStars: (s: number) => void
}) {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [wallet, setWallet] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<{ amount: number; token: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drawerLoading, setDrawerLoading] = useState(false)

  const getBalancesFn = useServerFn(getBalances)
  const requestFn = useServerFn(requestWithdrawal)
  const getWithdrawalsFn = useServerFn(getWithdrawals)
  const getUserFn = useServerFn(getUser)

  useEffect(() => {
    if (!open) return
    setDrawerLoading(true)
    Promise.all([
      getWithdrawalsFn({ data: { telegramId: tgId } }),
      getUserFn({ data: { telegramId: tgId } }),
    ]).then(([wds, usr]) => {
      setWithdrawals(wds as Withdrawal[])
      if (usr) setStars(usr.stars ?? 0)
    }).finally(() => setDrawerLoading(false))
  }, [open])

  const handleWithdraw = async () => {
    if (!selected || !wallet.trim()) return
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await requestFn({ data: { telegramId: tgId, token: selected, walletAddress: wallet.trim() } })
      setSuccess({ amount: result.amount, token: selected })
      hapticSuccess()
      const [bals, wds, usr] = await Promise.all([
        getBalancesFn({ data: { telegramId: tgId } }),
        getWithdrawalsFn({ data: { telegramId: tgId } }),
        getUserFn({ data: { telegramId: tgId } }),
      ])
      setBalances(bals)
      setWithdrawals(wds as Withdrawal[])
      if (usr) setStars(usr.stars ?? 0)
      setWallet('')
      setSelected(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed'
      if (msg.startsWith('MIN_BALANCE:')) {
        setError(`Min balance needed: ${msg.split(':')[1]}`)
      } else if (msg.startsWith('NOT_ENOUGH_STARS:')) {
        setError(`Not enough stars: ${msg.split(':')[1]}`)
      } else {
        setError(msg)
      }
      hapticError()
    } finally {
      setSubmitting(false)
    }
  }

  const selectedCfg = selected ? TOKENS[selected as keyof typeof TOKENS] : null
  const selectedBalance = balances.find((b) => b.token === selected)

  const statusColor: Record<string, string> = {
    pending: '#f59e0b', processing: '#3b82f6', completed: '#22c55e', rejected: '#ef4444',
  }
  const statusEmoji: Record<string, string> = {
    pending: '⏳', processing: '🔄', completed: '✅', rejected: '❌',
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          zIndex: 100, backdropFilter: 'blur(4px)',
        }}
      />
      {/* Sheet */}
      <div
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          maxWidth: 480, margin: '0 auto',
          background: '#0d0d1a',
          borderTop: '2px solid #3b3b70',
          borderRadius: '24px 24px 0 0',
          zIndex: 101,
          maxHeight: '85dvh',
          overflowY: 'auto',
          padding: '0 16px 32px',
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div style={{ width: 40, height: 4, borderRadius: 2, background: '#3b3b70' }} />
        </div>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black shimmer-text">💰 Wallet</h2>
          <button
            onClick={onClose}
            className="text-gray-400 text-xl leading-none"
            style={{ padding: '4px 8px' }}
          >
            ✕
          </button>
        </div>

        {/* Stars */}
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2 mb-4"
          style={{ background: '#1e1e40', border: '1px solid #3b3b70' }}
        >
          <span className="text-xl">⭐</span>
          <div>
            <p className="text-xs text-gray-400 leading-none">Stars balance</p>
            <p className="font-black text-yellow-400 text-lg leading-tight">{stars.toLocaleString()}</p>
          </div>
        </div>

        {/* Balances */}
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Token Balances</p>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {Object.entries(TOKENS).map(([key, cfg]) => {
            const bal = balances.find((b) => b.token === key)
            const amount = bal?.amount ?? 0
            const hasEnough = amount >= cfg.withdrawThreshold
            const isSelected = selected === key
            return (
              <button
                key={key}
                onClick={() => setSelected(isSelected ? null : key)}
                className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all"
                style={{
                  background: isSelected ? cfg.bg : '#12122a',
                  border: isSelected ? `2px solid ${cfg.color}` : '1px solid #1e1e40',
                }}
              >
                <TokenIcon token={key} size={28} />
                <span className="text-xs font-bold" style={{ color: cfg.color }}>{key}</span>
                <span
                  className="font-mono text-center"
                  style={{ fontSize: '0.55rem', color: hasEnough ? '#4ade80' : '#9ca3af' }}
                >
                  {formatAmount(amount)}
                </span>
                <span className="text-gray-500" style={{ fontSize: '0.5rem' }}>
                  min: {cfg.withdrawThreshold}
                </span>
              </button>
            )
          })}
        </div>

        {/* Withdraw form */}
        {selectedCfg && (
          <div
            className="rounded-xl p-3 mb-3"
            style={{ background: '#1a1040', border: '1px solid #4c1d95' }}
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-bold text-white">{selectedCfg.name} Withdrawal</p>
                <p className="text-xs text-gray-400">
                  Balance: {formatAmount(selectedBalance?.amount ?? 0)} {selected}
                </p>
              </div>
              <div className="text-right">
                <p className="text-yellow-400 font-black text-lg">
                  ⭐{Math.ceil(selectedCfg.starsCost * (1 + WITHDRAWAL_STAR_FEE_PCT))}
                </p>
                <p className="text-gray-500" style={{ fontSize: '0.6rem' }}>incl. 10% fee</p>
              </div>
            </div>
            {(selectedBalance?.amount ?? 0) < selectedCfg.withdrawThreshold && (
              <div
                className="mb-2 rounded-lg p-2 text-xs text-yellow-300"
                style={{ background: '#2a1800', border: '1px solid #92400e' }}
              >
                ⚠️ Need {(selectedCfg.withdrawThreshold - (selectedBalance?.amount ?? 0)).toFixed(8)} more {selected}
              </div>
            )}
            <p className="text-xs text-gray-400 mb-1">TON Wallet Address</p>
            <input
              type="text"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="EQ... or UQ..."
              className="w-full rounded-xl px-3 py-2.5 text-sm font-mono mb-2"
              style={{
                background: '#0d0d1a',
                border: '1px solid #2e2e60',
                color: '#e2e8f0',
                outline: 'none',
              }}
            />
            <button
              className="btn-primary"
              onClick={handleWithdraw}
              disabled={submitting || !wallet.trim()}
            >
              {submitting
                ? '⏳ Processing...'
                : `Withdraw ${selected} — ⭐${Math.ceil(selectedCfg.starsCost * (1 + WITHDRAWAL_STAR_FEE_PCT))}`}
            </button>
          </div>
        )}

        {success && (
          <div className="bounce-in rounded-xl p-3 text-center mb-3"
            style={{ background: '#1a3a1a', border: '1px solid #16a34a' }}>
            <p className="text-green-400 font-bold">🎉 Withdrawal Submitted!</p>
            <p className="text-sm text-gray-300 mt-1">
              {formatAmount(success.amount)} {success.token} → pending review
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-xl p-3 text-center text-red-400 text-sm mb-3"
            style={{ background: '#2a0a0a', border: '1px solid #7f1d1d' }}>
            {error}
          </div>
        )}

        {/* History */}
        {withdrawals.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Withdrawal History</p>
            <div className="flex flex-col gap-2">
              {withdrawals.map((w) => {
                const cfg = TOKENS[w.token as keyof typeof TOKENS]
                return (
                  <div
                    key={w.id}
                    className="flex items-center gap-2 p-2 rounded-xl"
                    style={{ background: '#0d0d1a', border: '1px solid #1e1e40' }}
                  >
                    <span className="text-base">{statusEmoji[w.status] ?? '❓'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white">
                        {cfg?.emoji} {parseFloat(w.amount).toFixed(4)} {w.token}
                      </p>
                      <p className="text-gray-500 font-mono truncate" style={{ fontSize: '0.55rem' }}>
                        {w.walletAddress}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold" style={{ color: statusColor[w.status] ?? '#6b7280' }}>
                        {w.status}
                      </p>
                      <p className="text-gray-500" style={{ fontSize: '0.55rem' }}>-{w.starsCost}⭐</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </>
  )
}



// ── SpinCounter ──────────────────────────────────────────────────────────────
function SpinCounter({
  count, onWatchAd, loading, adCooldown,
  stars, onBuyBoost, onBuyCharm, boostLoading, charmLoading,
}: {
  count: number
  onWatchAd: () => void
  loading: boolean
  adCooldown: number
  stars: number
  onBuyBoost: () => void
  onBuyCharm: () => void
  boostLoading: boolean
  charmLoading: boolean
}) {
  const adReady = adCooldown <= 0
  return (
    <div className="flex flex-col gap-2 rounded-2xl px-4 py-3" style={{ background: '#13132b', border: '1px solid #2e2e60' }}>
      {/* Row 1: spin count + ad button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎫</span>
          <div>
            <p className="text-xs text-gray-400 leading-none mb-0.5">Spins available</p>
            <p className="font-black text-xl" style={{ color: count > 0 ? '#a78bfa' : '#6b7280', lineHeight: 1 }}>{count}</p>
          </div>
        </div>
        <button
          onClick={onWatchAd}
          disabled={loading || !adReady}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
          style={{
            background: adReady ? '#2d1b4e' : '#1a1a2e',
            border: `1px solid ${adReady ? '#6d28d9' : '#3b3b60'}`,
            color: adReady ? '#c4b5fd' : '#6b7280',
          }}
        >
          {loading ? '⏳ Loading...' : adReady ? '📺 Watch ad +1' : `⏳ ${adCooldown}s`}
        </button>
      </div>

      {/* Row 2: Boosts */}
      <div className="flex gap-2 pt-1 border-t" style={{ borderColor: '#2e2e60' }}>
        <button
          onClick={onBuyBoost}
          disabled={boostLoading || stars < SPIN_BOOST_COST_STARS}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-xs font-bold transition-all"
          style={{
            background: stars >= SPIN_BOOST_COST_STARS ? '#1a2d1a' : '#1a1a2e',
            border: `1px solid ${stars >= SPIN_BOOST_COST_STARS ? '#22c55e40' : '#3b3b60'}`,
            color: stars >= SPIN_BOOST_COST_STARS ? '#86efac' : '#6b7280',
          }}
        >
          ⚡ Boost <span style={{ color: '#fbbf24' }}>({SPIN_BOOST_COST_STARS}⭐)</span>
        </button>
        <button
          onClick={onBuyCharm}
          disabled={charmLoading || stars < LUCKY_CHARM_COST_STARS}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-xs font-bold transition-all"
          style={{
            background: stars >= LUCKY_CHARM_COST_STARS ? '#2d1b1a' : '#1a1a2e',
            border: `1px solid ${stars >= LUCKY_CHARM_COST_STARS ? '#f59e0b40' : '#3b3b60'}`,
            color: stars >= LUCKY_CHARM_COST_STARS ? '#fcd34d' : '#6b7280',
          }}
        >
          🍀 Charm <span style={{ color: '#fbbf24' }}>({LUCKY_CHARM_COST_STARS}⭐)</span>
        </button>
      </div>
    </div>
  )
}

export function SpinPage() {
  const [user, setUser] = useState<UserState | null>(null)
  const [balances, setBalances] = useState<Balance[]>([])
  const [isSpinning, setIsSpinning] = useState(false)
  const [spinResult, setSpinResult] = useState<string | null>(null)
  const [reward, setReward] = useState<{ token: string; amount: number; starsEarned: number; xpEarned: number; rarity: Rarity; newAchievements: string[]; leveledUp: boolean } | null>(null)
  const [showReward, setShowReward] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [adLoading, setAdLoading] = useState(false)
  // Alternates between 'adsgram' and 'monetag' on each tap
  const adNetworkRef = useRef<'adsgram' | 'monetag'>('adsgram')
  const [adCooldown, setAdCooldown] = useState(0)
  const [boostLoading, setBoostLoading] = useState(false)
  const [charmLoading, setCharmLoading] = useState(false)
  const [activeBoost, setActiveBoost] = useState(false)
  const [activeCharm, setActiveCharm] = useState(false)
  const [showLevelUp, setShowLevelUp] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  const initUserFn    = useServerFn(initUser)
  const spinWheelFn   = useServerFn(spinWheel)
  const getSpinStatFn = useServerFn(getSpinStatus)
  const getBalsFn     = useServerFn(getBalances)
  const buyBoostFn    = useServerFn(purchaseSpinBoost)
  const buyCharmFn    = useServerFn(purchaseLuckyCharm)

  const tgId = getTelegramUserId()

  useEffect(() => {
    initTelegramApp()
    const tgUser = getTelegramUser()
    const startP = getTelegramStartParam()

    async function bootstrap() {
      try {
        const deviceFingerprint = await buildDeviceFingerprint()
        const u = await initUserFn({
          data: {
            telegramId: tgId,
            username:   tgUser?.username,
            firstName:  tgUser?.first_name,
            photoUrl:   tgUser?.photo_url,
            referralCode: startP ?? undefined,
            deviceFingerprint,
          },
        })
        setUser({
          id:             u.id,
          stars:          u.stars,
          xp:             u.xp ?? 0,
          level:          u.level ?? 1,
          firstName:      u.firstName ?? tgUser?.first_name ?? 'User',
          username:       u.username ?? tgUser?.username,
          photoUrl:       u.photoUrl ?? tgUser?.photo_url,
          dailyStreak:    u.dailyStreak ?? 0,
          spinCount:      u.spinCount ?? 0,
          spinsAvailable: u.spinsAvailable ?? 3,
          adsWatched:     (u as any).adsWatched ?? 0,
          achievements:   (u.achievements ?? []).filter(Boolean),
        })
        const bals = await getBalsFn({ data: { telegramId: tgId } })
        setBalances(bals)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    bootstrap()
  }, [])

  // Call earnSpinsFromAd directly (bypasses stale useServerFn hook closure)
  // Preload Monetag ad on mount so it shows instantly when tapped
  useEffect(() => {
    moneTagAdHandler({ type: 'preload', ymid: tgId })
      .then(() => setMonetagReady(true))
      .catch(() => { /* preload failed, will try on tap */ })
  }, [])

  const handleAdRewarded = useCallback((id: string) => {
    earnSpinsFromAd({ data: { telegramId: id } })
      .then((result) => {
        setUser(u => u ? {
          ...u,
          spinsAvailable: result.newSpinsAvailable,
          xp: result.newXP,
          level: result.newLevel,
        } : u)
        setAdCooldown(30)
        hapticSuccess()
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : 'Failed'
        if (msg.startsWith('AD_COOLDOWN:')) {
          const secs = parseInt(msg.split(':')[1] ?? '30', 10)
          setAdCooldown(secs)
          setError(`Please wait ${secs}s before watching another ad`)
        } else {
          setError(msg)
        }
        hapticError()
      })
      .finally(() => setAdLoading(false))
  }, [])

  // Adsgram: init on first use, reuse the controller
  const adsgramControllerRef = useRef<any>(null)
  const getAdsgramController = () => {
    if (!adsgramControllerRef.current) {
      adsgramControllerRef.current = (window as any).Adsgram?.init({
        blockId: import.meta.env.VITE_ADSGRAM_REWARD_BLOCK_ID,
      })
    }
    return adsgramControllerRef.current
  }

  const handleSpin = useCallback(async () => {
    if (isSpinning || !user || user.spinsAvailable <= 0) return
    setError(null)
    setShowReward(false)
    setIsSpinning(true)
    hapticImpact('medium')

    try {
      const result = await spinWheelFn({ data: { telegramId: tgId, useSpinBoost: activeBoost, useLuckyCharm: activeCharm } })
      setSpinResult(result.token)
      setReward({
        token:           result.token,
        amount:          result.amount,
        starsEarned:     result.starsEarned,
        xpEarned:        result.xpEarned,
        rarity:          result.rarity as Rarity,
        newAchievements: result.newAchievements,
        leveledUp:       result.leveledUp,
      })
      setUser(u => u ? {
        ...u,
        stars:          result.newStars,
        xp:             result.newXP,
        level:          result.newLevel,
        spinCount:      u.spinCount + 1,
        spinsAvailable: result.spinsRemaining,
      } : u)
      setActiveBoost(false)
      setActiveCharm(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Spin failed'
      if (!msg.startsWith('NO_SPINS')) setError(msg)
      hapticError()
      setIsSpinning(false)
    }
  }, [isSpinning, user, activeBoost, activeCharm, tgId])

  const handleSpinComplete = useCallback(async () => {
    setIsSpinning(false)
    setShowReward(true)
    hapticSuccess()
    const bals = await getBalsFn({ data: { telegramId: tgId } })
    setBalances(bals)
    if (reward?.leveledUp) {
      setTimeout(() => { setShowLevelUp(true); setTimeout(() => setShowLevelUp(false), 3000) }, 500)
    }
  }, [reward, tgId])

  const handleWatchAd = async () => {
    if (adLoading || adCooldown > 0) return
    setError(null)
    setAdLoading(true)
    hapticSelect()

    // Alternate networks each tap
    const network = adNetworkRef.current
    adNetworkRef.current = network === 'adsgram' ? 'monetag' : 'adsgram'

    if (network === 'monetag') {
      try {
        await moneTagAdHandler({ ymid: tgId })
        handleAdRewarded(tgId)
      } catch {
        // Monetag failed/skipped — always fall back to Adsgram
        try {
          const ctrl = getAdsgramController()
          if (!ctrl) throw new Error('Adsgram not ready')
          const result = await ctrl.show()
          if (result.done) handleAdRewarded(tgId)
          else setAdLoading(false) // skipped
        } catch {
          setAdLoading(false)
          setError('No ads available right now, try again later')
        }
      }
    } else {
      try {
        const ctrl = getAdsgramController()
        if (!ctrl) throw new Error('Adsgram not ready')
        const result = await ctrl.show()
        if (result.done) handleAdRewarded(tgId)
        else setAdLoading(false) // user skipped — no fallback, no reward
      } catch {
        // Adsgram error/no-fill — fall back to Monetag
        try {
          await moneTagAdHandler({ ymid: tgId })
          handleAdRewarded(tgId)
        } catch {
          setAdLoading(false)
          setError('No ads available right now, try again later')
        }
      }
    }
  }

  useEffect(() => {
    if (adCooldown <= 0) return
    const timer = setInterval(() => setAdCooldown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(timer)
  }, [adCooldown])

  const handleBuyBoost = async () => {
    if (boostLoading || !user || user.stars < SPIN_BOOST_COST_STARS) return
    setBoostLoading(true)
    hapticSelect()
    try {
      const result = await buyBoostFn({ data: { telegramId: tgId } })
      setUser(u => u ? { ...u, stars: result.newStars } : u)
      setActiveBoost(true)
      hapticSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Purchase failed')
      hapticError()
    } finally {
      setBoostLoading(false)
    }
  }

  const handleBuyCharm = async () => {
    if (charmLoading || !user || user.stars < LUCKY_CHARM_COST_STARS) return
    setCharmLoading(true)
    hapticSelect()
    try {
      const result = await buyCharmFn({ data: { telegramId: tgId } })
      setUser(u => u ? { ...u, stars: result.newStars } : u)
      setActiveCharm(true)
      hapticSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Purchase failed')
      hapticError()
    } finally {
      setCharmLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: '100dvh' }}>
        <div className="text-center">
          <div className="text-5xl mb-4" style={{ animation: 'spin-slow 1s linear infinite', display: 'inline-block' }}>🎡</div>
          <p className="text-gray-400 text-sm mt-2">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-3 px-3 pt-3 pb-4">

        {/* ── TOP HEADER ── */}
        <div
          className="rounded-2xl p-3"
          style={{ background: 'linear-gradient(135deg, #13132b, #0d0d1a)', border: '1px solid #2e2e60' }}
        >
          {/* Row 1: Logo + Stars */}
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎡</span>
              <span className="font-black text-base shimmer-text tracking-tight">LootPad</span>
            </div>
            <div className="flex items-center gap-3">
              {(user?.dailyStreak ?? 0) > 0 && (
                <div className="flex items-center gap-1" style={{ color: '#f59e0b' }}>
                  <span className="text-base">🔥</span>
                  <span className="font-black text-sm">{user?.dailyStreak}</span>
                </div>
              )}
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                style={{ background: '#1e1e40', border: '1px solid #3b3b70' }}
              >
                <span className="text-sm">⭐</span>
                <span className="font-black text-yellow-400 text-sm">{user?.stars ?? 0}</span>
              </div>
            </div>
          </div>

          {/* Row 2: Avatar (tappable → wallet) + Name + Level */}
          <div className="flex items-center gap-2.5 mb-2.5">
            <button
              onClick={() => setProfileOpen(true)}
              className="relative flex-shrink-0"
              style={{ borderRadius: '50%' }}
              title="View Profile & Badges"
            >
              <AvatarOrInitial
                photoUrl={user?.photoUrl}
                name={user?.firstName ?? 'U'}
                size={44}
              />
              {/* Small wallet badge */}
              <div
                className="absolute -bottom-0.5 -right-0.5 rounded-full flex items-center justify-center"
                style={{
                  width: 18, height: 18,
                  background: '#1e1e40',
                  border: '1.5px solid #6d28d9',
                  fontSize: '0.6rem',
                }}
              >
                👤
              </div>
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-bold text-sm text-white truncate">
                  {user?.username ? `@${user.username}` : (user?.firstName ?? 'User')}
                </p>
                <span
                  className="text-xs font-black px-1.5 py-0.5 rounded-md flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', color: 'white' }}
                >
                  LVL {user?.level ?? 1}
                </span>
              </div>
              <p className="text-xs text-gray-500 leading-none mt-0.5">
                {user?.spinCount ?? 0} spins · tap for profile & wallet
              </p>
            </div>
          </div>

          {user && <XPBar xp={user.xp} level={user.level} />}
        </div>

        {/* ── LEVEL UP TOAST ── */}
        {showLevelUp && (
          <div
            className="bounce-in rounded-2xl p-3 text-center"
            style={{ background: 'linear-gradient(135deg, #2d1b4e, #1a1040)', border: '2px solid #a78bfa' }}
          >
            <p className="text-2xl mb-1">🎉</p>
            <p className="font-black text-lg shimmer-text">LEVEL UP!</p>
            <p className="text-gray-300 text-sm">You reached Level {user?.level}</p>
          </div>
        )}

        {/* ── SPIN COUNTER ── */}
        <SpinCounter
          count={user?.spinsAvailable ?? 0}
          onWatchAd={handleWatchAd}
          loading={adLoading}
          adCooldown={adCooldown}
          stars={user?.stars ?? 0}
          onBuyBoost={handleBuyBoost}
          onBuyCharm={handleBuyCharm}
          boostLoading={boostLoading}
          charmLoading={charmLoading}
        />

        {/* ── WHEEL CARD ── */}
        <div className="card p-4 flex flex-col items-center gap-3">
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase tracking-widest mb-0.5">Spin to Earn</p>
            <p className="text-xs text-purple-400">Win crypto • earn ⭐ stars • unlock achievements</p>
          </div>

          <SpinWheel
            isSpinning={isSpinning}
            result={spinResult}
            onSpinComplete={handleSpinComplete}
          />

          {/* ── BALANCES UNDER WHEEL ── */}
          {balances.length > 0 && (
            <div className="w-full">
              <div className="grid grid-cols-3 gap-1.5">
                {balances.map((b) => {
                  const cfg = TOKENS[b.token as keyof typeof TOKENS]
                  if (!cfg) return null
                  return (
                    <div
                      key={b.token}
                      className="rounded-xl p-2 flex flex-col items-center gap-0.5"
                      style={{ background: cfg.bg, border: `1px solid ${cfg.color}30` }}
                    >
                      <TokenIcon token={b.token} size={22} />
                      <p className="text-xs font-bold" style={{ color: cfg.color }}>{b.token}</p>
                      <p className="text-gray-300 font-mono" style={{ fontSize: '0.55rem' }}>
                        {formatAmount(b.amount)}
                      </p>
                    </div>
                  )
                })}
              </div>
              <button
                onClick={() => setWalletOpen(true)}
                className="w-full mt-2 py-1.5 rounded-xl text-xs font-bold text-gray-400 transition-all active:scale-95"
                style={{ background: '#13132b', border: '1px solid #2e2e60' }}
              >
                💰 Withdraw funds →
              </button>
            </div>
          )}

          {showReward && reward && (
            <div className="bounce-in text-center w-full">
              <div
                className="rounded-xl p-3 flex flex-col items-center gap-1.5"
                style={{
                  background: '#1a1a3a',
                  border: `1px solid ${RARITY_TIERS[reward.rarity].color}50`,
                  boxShadow: `0 0 20px ${RARITY_TIERS[reward.rarity].glow}`,
                }}
              >
                <RarityBadge rarity={reward.rarity} />
                <div className="flex items-center gap-3">
                  <TokenIcon token={reward.token} size={36} />
                  <div>
                    <p className="text-green-400 font-bold text-sm">You won!</p>
                    <p className="text-white font-bold">
                      {TOKENS[reward.token as keyof typeof TOKENS]?.emoji} {reward.token}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-yellow-400 font-black">+{reward.starsEarned} ⭐ Stars</span>
                  <span className="text-purple-400 font-bold">+{reward.xpEarned} XP</span>
                </div>
                {reward.newAchievements.length > 0 && (
                  <div className="flex flex-wrap gap-1 justify-center mt-1">
                    {reward.newAchievements.map(id => {
                      const a = ACHIEVEMENTS[id as keyof typeof ACHIEVEMENTS]
                      return a ? (
                        <span key={id} className="text-xs px-2 py-0.5 rounded-full font-bold"
                          style={{ background: '#2d1b4e', border: '1px solid #6d28d9', color: '#c4b5fd' }}>
                          {a.emoji} {a.label}
                        </span>
                      ) : null
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {(activeBoost || activeCharm) && (
            <div className="flex gap-2 justify-center">
              {activeBoost && (
                <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: '#1a2d1a', border: '1px solid #22c55e', color: '#86efac' }}>
                  ⚡ 2× Boost active
                </span>
              )}
              {activeCharm && (
                <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: '#2d1b1a', border: '1px solid #f59e0b', color: '#fcd34d' }}>
                  🍀 Charm active
                </span>
              )}
            </div>
          )}

          <div className="w-full">
            {user && user.spinsAvailable > 0 ? (
              <button
                className="btn-primary glow-purple"
                onClick={handleSpin}
                disabled={isSpinning}
              >
                {isSpinning ? '🎡 Spinning...' : `🎡 SPIN (${user.spinsAvailable} left)`}
              </button>
            ) : (
              <button className="btn-primary" disabled>
                🎫 No spins — watch an ad!
              </button>
            )}
          </div>

          {error && <p className="text-red-400 text-xs text-center">{error}</p>}
          <p className="text-gray-500 text-xs">+{2} ⭐ +{5} XP per spin • Earn spins via ads & referrals</p>
        </div>

        {/* ── LIVE ACTIVITY ── */}
        <ActivityFeed />
      </div>

      {/* ── PROFILE MODAL ── */}
      {user && (
        <ProfileModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          user={user}
          balances={balances}
          tgId={tgId}
        />
      )}

      {/* ── WALLET DRAWER ── */}
      <WalletDrawer
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
        tgId={tgId}
        balances={balances}
        setBalances={setBalances}
        stars={user?.stars ?? 0}
        setStars={(s) => setUser(u => u ? { ...u, stars: s } : u)}
      />

    </>
  )
}
