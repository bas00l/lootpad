import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { claimDailyReward, getDailyStatus } from '../server/daily.functions.js'
import { earnSpinsFromAd } from '../server/spin.functions.js'
import { getTelegramUserId, hapticSuccess, hapticError, hapticSelect } from '../lib/telegram.js'
import { DAILY_REWARD_STARS, TOKENS } from '../lib/constants.js'

export const Route = createFileRoute('/daily')({
  component: DailyPage,
})

// ── Monetag interstitial ─────────────────────────────────────────────────────
// Zone ID is read from env so it can be swapped without touching code.
// Falls back to the hardcoded zone already in __root.tsx (11049772).
const MONETAG_ZONE = (import.meta.env.VITE_MONETAG_ZONE_ID as string | undefined)?.trim() ?? '11049772'
const MONETAG_FN   = `show_${MONETAG_ZONE}`

/** Returns true if the Monetag SDK function is already on window. */
function moneTagReady(): boolean {
  return typeof (window as any)[MONETAG_FN] === 'function'
}

/** Show a Monetag interstitial. Resolves when the ad completes, rejects on error / no fill. */
function showMonetagInterstitial(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!moneTagReady()) { reject(new Error('SDK not ready')); return }
    ;(window as any)[MONETAG_FN]().then(resolve).catch(reject)
  })
}

// Bonus for watching a Monetag ad on the daily page
const MONETAG_BONUS_STARS = 5
const MONETAG_DAILY_LIMIT = 3     // max ad rewards per calendar day
const MONETAG_COOLDOWN_S  = 120   // 2-minute cooldown between ads

// ── Helper ───────────────────────────────────────────────────────────────────
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// ── Monetag Ad Button ─────────────────────────────────────────────────────────
function MonetagAdButton({ tgId, onRewarded }: { tgId: string; onRewarded: (stars: number) => void }) {
  const [state, setState]       = useState<'idle' | 'loading' | 'cooldown' | 'limit'>('idle')
  const [cooldown, setCooldown] = useState(0)
  const [adsToday, setAdsToday] = useState(0)
  const [errMsg, setErrMsg]     = useState('')
  const timerRef                = useRef<ReturnType<typeof setInterval> | null>(null)
  const earnSpinsFn             = useServerFn(earnSpinsFromAd)

  // Restore today's ad count from sessionStorage (resets on browser close = new session = new day)
  useEffect(() => {
    const key  = `monetag_daily_${new Date().toDateString()}`
    const saved = parseInt(sessionStorage.getItem(key) ?? '0', 10)
    if (saved >= MONETAG_DAILY_LIMIT) setState('limit')
    setAdsToday(saved)
  }, [])

  // Cooldown tick
  useEffect(() => {
    if (cooldown <= 0) { timerRef.current && clearInterval(timerRef.current); return }
    timerRef.current = setInterval(() => {
      setCooldown(c => {
        if (c <= 1) { setState('idle'); return 0 }
        return c - 1
      })
    }, 1000)
    return () => { timerRef.current && clearInterval(timerRef.current) }
  }, [cooldown])

  const handleWatch = useCallback(async () => {
    if (state !== 'idle') return
    setErrMsg('')
    setState('loading')
    hapticSelect()

    try {
      await showMonetagInterstitial()

      // Ad completed — credit reward
      // Also call earnSpinsFromAd so the server tracks the watch
      try {
        await earnSpinsFn({ data: { telegramId: tgId } })
      } catch { /* spin credit is best-effort */ }

      const newCount = adsToday + 1
      setAdsToday(newCount)
      const key = `monetag_daily_${new Date().toDateString()}`
      sessionStorage.setItem(key, String(newCount))

      if (newCount >= MONETAG_DAILY_LIMIT) {
        setState('limit')
      } else {
        setCooldown(MONETAG_COOLDOWN_S)
        setState('cooldown')
      }

      onRewarded(MONETAG_BONUS_STARS)
      hapticSuccess()

    } catch (err) {
      const msg = String((err as any)?.message ?? err)
      console.warn('Monetag daily ad error:', msg)
      // Don't penalise user for no-fill — just go back to idle
      setState('idle')
      if (!msg.includes('SDK not ready')) setErrMsg('No ad available right now — try again later')
      hapticError()
    }
  }, [state, adsToday, tgId, onRewarded, earnSpinsFn])

  if (state === 'limit') return null   // silently hide once daily limit reached

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a1030, #12082a)',
      border: '1px solid #6d28d930',
      borderRadius: 14,
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Icon */}
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: '#2d1b4e', border: '1px solid #7c3aed40',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22,
        }}>
          📺
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 700, fontSize: 13, color: '#fff', margin: '0 0 3px' }}>
            Watch an ad for bonus stars
          </p>
          <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 7px', lineHeight: 1.4 }}>
            {MONETAG_DAILY_LIMIT - adsToday} watch{MONETAG_DAILY_LIMIT - adsToday !== 1 ? 'es' : ''} remaining today
          </p>
          <div style={{ display: 'flex', gap: 5 }}>
            <span style={{ background: '#2d2000', color: '#fbbf24', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
              +{MONETAG_BONUS_STARS} ⭐
            </span>
            <span style={{ background: '#1e1040', color: '#c4b5fd', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
              +1 🎫 spin
            </span>
          </div>
          {errMsg && <p style={{ fontSize: 10, color: '#f87171', marginTop: 5, fontStyle: 'italic' }}>{errMsg}</p>}
        </div>

        {/* Button */}
        <div style={{ flexShrink: 0 }}>
          {state === 'loading' ? (
            <div style={{ padding: '9px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, background: '#1a1a3a', color: '#a78bfa', whiteSpace: 'nowrap' }}>
              ⏳ Loading…
            </div>
          ) : state === 'cooldown' ? (
            <div style={{ padding: '9px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, background: '#13132b', color: '#6b7280', border: '1px solid #2e2e60', whiteSpace: 'nowrap', textAlign: 'center' }}>
              ⏰ {formatTime(cooldown)}
            </div>
          ) : (
            <button
              onClick={handleWatch}
              style={{
                padding: '9px 18px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
                color: '#fff', border: '1px solid #6d28d9',
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >
              ▶ Watch
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
function DailyPage() {
  const [streak, setStreak]   = useState(0)
  const [canClaim, setCanClaim] = useState(false)
  const [nextIn, setNextIn]   = useState(0)
  const [claiming, setClaiming] = useState(false)
  const [result, setResult]   = useState<{
    starsReward: number; newStreak: number; bonusToken: string; bonusAmount: number
  } | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [bonusStars, setBonusStars] = useState(0)   // accumulated from Monetag watches today

  const getDailyStatusFn = useServerFn(getDailyStatus)
  const claimFn          = useServerFn(claimDailyReward)

  const tgId = getTelegramUserId()

  useEffect(() => {
    getDailyStatusFn({ data: { telegramId: tgId } }).then((s) => {
      setStreak(s.streak)
      setCanClaim(s.canClaim)
      setNextIn(s.nextClaimIn)
    })
  }, [])

  useEffect(() => {
    if (nextIn <= 0) return
    const t = setTimeout(() => setNextIn((n) => Math.max(0, n - 1)), 1000)
    return () => clearTimeout(t)
  }, [nextIn])

  const handleClaim = async () => {
    setClaiming(true)
    setError(null)
    try {
      const r = await claimFn({ data: { telegramId: tgId } })
      setResult(r)
      setStreak(r.newStreak)
      setCanClaim(false)
      setNextIn(86400)
      hapticSuccess()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed'
      if (msg.startsWith('ALREADY_CLAIMED:')) {
        setNextIn(parseInt(msg.split(':')[1] ?? '0', 10))
        setCanClaim(false)
      } else {
        setError(msg)
        hapticError()
      }
    } finally {
      setClaiming(false)
    }
  }

  const streakDays = DAILY_REWARD_STARS.map((stars, i) => ({
    day: i + 1, stars, done: i < streak, current: i === streak,
  }))

  return (
    <div className="page">
      <div className="text-center">
        <h1 className="text-xl font-bold shimmer-text">Daily Rewards</h1>
        <p className="text-gray-400 text-sm mt-1">Claim every day to build your streak</p>
      </div>

      {/* Streak */}
      <div className="card p-4 text-center">
        <div className="text-5xl font-black mb-1" style={{ color: streak > 0 ? '#f59e0b' : '#6b7280' }}>
          🔥 {streak}
        </div>
        <p className="text-gray-300 text-sm font-semibold">Day Streak</p>
        {streak >= 7 && <p className="text-purple-400 text-xs mt-1">🎉 Weekly bonus unlocked!</p>}
      </div>

      {/* Day grid */}
      <div className="card p-4">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Reward Schedule</p>
        <div className="grid grid-cols-4 gap-2">
          {streakDays.map((d) => (
            <div
              key={d.day}
              className="flex flex-col items-center gap-1 rounded-xl p-2 text-center"
              style={{
                background: d.done ? '#1a3a1a' : d.current ? '#2a1a4a' : '#12122a',
                border:     d.done ? '1px solid #16a34a' : d.current ? '1px solid #7c3aed' : '1px solid #1e1e40',
              }}
            >
              <span className="text-lg">{d.done ? '✅' : d.current ? '🎁' : '🔒'}</span>
              <span className="text-xs font-bold text-gray-300">Day {d.day}</span>
              <span className="text-yellow-400 font-bold" style={{ fontSize: '0.65rem' }}>⭐{d.stars}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Claim / result */}
      <div>
        {result ? (
          <div className="bounce-in card p-4 text-center">
            <p className="text-2xl mb-2">🎉</p>
            <p className="text-green-400 font-bold text-lg">Claimed!</p>
            <p className="text-yellow-400 font-bold">+{result.starsReward} ⭐ Stars</p>
            {result.bonusAmount > 0 && (
              <p className="text-gray-300 text-sm mt-1">
                +{result.bonusAmount} {TOKENS[result.bonusToken as keyof typeof TOKENS]?.emoji} {result.bonusToken}
              </p>
            )}
            <p className="text-gray-400 text-xs mt-2">Day {result.newStreak} streak!</p>
          </div>
        ) : canClaim ? (
          <button className="btn-primary glow-purple" onClick={handleClaim} disabled={claiming}>
            {claiming ? '⏳ Claiming...' : `🎁 Claim Day ${streak + 1} Reward`}
          </button>
        ) : (
          <button className="btn-primary" disabled>
            ⏰ Next reward in {formatTime(nextIn)}
          </button>
        )}
        {error && <p className="text-red-400 text-xs text-center mt-2">{error}</p>}
      </div>

      {/* ── Monetag bonus ad section ────────────────────────────────────────── */}
      <div>
        <p style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: '#7c3aed', marginBottom: 8,
        }}>
          💜 Bonus Stars
        </p>

        <MonetagAdButton
          tgId={tgId}
          onRewarded={(stars) => {
            setBonusStars(b => b + stars)
          }}
        />

        {/* Running tally of bonus stars earned today */}
        {bonusStars > 0 && (
          <div className="bounce-in" style={{
            marginTop: 8,
            background: '#2d2000', border: '1px solid #f59e0b50',
            borderRadius: 10, padding: '8px 14px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 18 }}>⭐</span>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', margin: 0 }}>
              +{bonusStars} bonus stars earned today!
            </p>
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="card p-3">
        <p className="text-xs font-bold text-purple-300 mb-2">💡 How it works</p>
        <ul className="space-y-1.5">
          {[
            'Claim every day to build your streak',
            'Stars unlock withdrawal requests',
            'Day 7 gives 50 ⭐ + bonus tokens',
            'Watch bonus ads for extra stars',
            'Missing a day resets your streak',
          ].map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-xs text-gray-400">
              <span className="text-purple-400 mt-0.5">•</span>
              {tip}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
