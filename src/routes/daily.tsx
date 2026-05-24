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
import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { claimDailyReward, getDailyStatus } from '../server/daily.functions.js'
import { getTelegramUserId, hapticSuccess, hapticError } from '../lib/telegram.js'
import { DAILY_REWARD_STARS, TOKENS } from '../lib/constants.js'

export const Route = createFileRoute('/daily')({
  component: DailyPage,
})

function DailyPage() {
  const [streak, setStreak] = useState(0)
  const [canClaim, setCanClaim] = useState(false)
  const [nextIn, setNextIn] = useState(0)
  const [claiming, setClaiming] = useState(false)
  const [result, setResult] = useState<{
    starsReward: number; newStreak: number; bonusToken: string; bonusAmount: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const getDailyStatusFn = useServerFn(getDailyStatus)
  const claimFn = useServerFn(claimDailyReward)

  useEffect(() => {
    const tgId = getTelegramUserId()
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
      const r = await claimFn({ data: { telegramId: getTelegramUserId() } })
      setResult(r)
      setStreak(r.newStreak)
      setCanClaim(false)
      setNextIn(86400)
      hapticSuccess()
    } catch (e) {
      const msg = getServerErrMsg(e, 'Failed')
      if (msg.startsWith('ALREADY_CLAIMED:')) {
        setNextIn(parseInt(msg.split(':')[1]))
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
    day: i + 1,
    stars,
    done: i < streak,
    current: i === streak,
  }))

  return (
    <div className="page">
      <div className="text-center">
        <h1 className="text-xl font-bold shimmer-text">Daily Rewards</h1>
        <p className="text-gray-400 text-sm mt-1">Claim every day to build your streak</p>
      </div>

      {/* Streak display */}
      <div className="card p-4 text-center">
        <div className="text-5xl font-black mb-1"
          style={{ color: streak > 0 ? '#f59e0b' : '#6b7280' }}>
          🔥 {streak}
        </div>
        <p className="text-gray-300 text-sm font-semibold">Day Streak</p>
        {streak >= 7 && (
          <p className="text-purple-400 text-xs mt-1">🎉 Weekly bonus unlocked!</p>
        )}
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
                border: d.done
                  ? '1px solid #16a34a'
                  : d.current
                  ? '1px solid #7c3aed'
                  : '1px solid #1e1e40',
              }}
            >
              <span className="text-lg">{d.done ? '✅' : d.current ? '🎁' : '🔒'}</span>
              <span className="text-xs font-bold text-gray-300">Day {d.day}</span>
              <span className="text-yellow-400 font-bold" style={{ fontSize: '0.65rem' }}>
                ⭐{d.stars}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Claim button */}
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

      {/* Bonus info */}
      <div className="card p-3">
        <p className="text-xs font-bold text-purple-300 mb-2">💡 How it works</p>
        <ul className="space-y-1.5">
          {[
            'Claim every day to build your streak',
            'Stars unlock withdrawal requests',
            'Day 7 gives 50 ⭐ + bonus tokens',
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

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
