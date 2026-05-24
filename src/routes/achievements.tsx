import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { getUser } from '../server/user.functions.js'
import { getTelegramUserId } from '../lib/telegram.js'
import { ACHIEVEMENTS, LEVEL_XP_THRESHOLDS, getLevelFromXP, DAILY_QUESTS } from '../lib/constants.js'

export const Route = createFileRoute('/achievements')({
  component: AchievementsPage,
})

function AchievementsPage() {
  const [unlocked, setUnlocked] = useState<string[]>([])
  const [xp, setXp] = useState(0)
  const [level, setLevel] = useState(1)
  const [spinCount, setSpinCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const getUserFn = useServerFn(getUser)

  useEffect(() => {
    getUserFn({ data: { telegramId: getTelegramUserId() } }).then(u => {
      if (u) {
        setUnlocked((u.achievements ?? []).filter(Boolean))
        setXp(u.xp ?? 0)
        setLevel(u.level ?? 1)
        setSpinCount(u.spinCount ?? 0)
      }
    }).finally(() => setLoading(false))
  }, [])

  const allAchievements = Object.values(ACHIEVEMENTS)
  const done  = allAchievements.filter(a => unlocked.includes(a.id))
  const todo  = allAchievements.filter(a => !unlocked.includes(a.id))
  const pct   = Math.round((done.length / allAchievements.length) * 100)

  return (
    <div className="page">

      <div className="text-center">
        <h1 className="text-xl font-bold shimmer-text">🎖️ Badges</h1>
        <p className="text-gray-400 text-sm mt-1">{done.length}/{allAchievements.length} unlocked</p>
      </div>

      {/* Progress */}
      <div className="card p-4">
        <div className="flex justify-between text-xs text-gray-400 mb-1.5">
          <span>Overall Progress</span>
          <span className="text-purple-400 font-bold">{pct}%</span>
        </div>
        <div className="rounded-full overflow-hidden h-2" style={{ background: '#1e1e40' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#7c3aed,#a78bfa)' }}
          />
        </div>
        <div className="flex justify-between mt-3 text-center">
          <div>
            <p className="text-xl font-black text-purple-400">{done.length}</p>
            <p className="text-xs text-gray-500">Unlocked</p>
          </div>
          <div>
            <p className="text-xl font-black text-yellow-400">{xp.toLocaleString()}</p>
            <p className="text-xs text-gray-500">Total XP</p>
          </div>
          <div>
            <p className="text-xl font-black text-white">Lv.{level}</p>
            <p className="text-xs text-gray-500">Level</p>
          </div>
        </div>
      </div>

      {/* Daily Quests */}
      <div className="card p-4">
        <p className="text-xs font-bold text-yellow-400 uppercase tracking-wider mb-3">📅 Daily Quests</p>
        <div className="flex flex-col gap-2">
          {DAILY_QUESTS.map(q => {
            // Rough progress calculation based on available stats
            let progress = 0
            if (q.id === 'dq_spin3' || q.id === 'dq_spin5') progress = Math.min(q.target, spinCount % q.target)
            return (
              <div
                key={q.id}
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: '#13132b', border: '1px solid #2e2e60' }}
              >
                <div className="flex-1">
                  <p className="text-sm font-semibold text-white">{q.label}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-yellow-400 text-xs">+{q.rewardStars}⭐</span>
                    <span className="text-purple-400 text-xs">+{q.rewardXP} XP</span>
                  </div>
                </div>
                <div className="text-xs text-gray-500">Resets daily</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Unlocked */}
      {done.length > 0 && (
        <>
          <p className="text-xs text-gray-400 uppercase tracking-wider px-1">✅ Unlocked</p>
          <div className="grid grid-cols-2 gap-2">
            {done.map(a => (
              <div
                key={a.id}
                className="flex flex-col items-center text-center p-3 rounded-2xl gap-1.5"
                style={{ background: 'linear-gradient(135deg, #1a2a1a, #0d1a0d)', border: '1px solid #16a34a' }}
              >
                <span className="text-3xl">{a.emoji}</span>
                <p className="text-xs font-bold text-green-400">{a.label}</p>
                <p className="text-xs text-gray-500 leading-tight">{a.desc}</p>
                <span className="text-xs text-purple-400 font-bold">+{a.xp} XP</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Locked */}
      {todo.length > 0 && (
        <>
          <p className="text-xs text-gray-400 uppercase tracking-wider px-1 mt-1">🔒 Locked</p>
          <div className="grid grid-cols-2 gap-2">
            {todo.map(a => (
              <div
                key={a.id}
                className="flex flex-col items-center text-center p-3 rounded-2xl gap-1.5 opacity-50"
                style={{ background: '#13132b', border: '1px solid #2e2e60' }}
              >
                <span className="text-3xl grayscale">{a.emoji}</span>
                <p className="text-xs font-bold text-gray-400">{a.label}</p>
                <p className="text-xs text-gray-600 leading-tight">{a.desc}</p>
                <span className="text-xs text-gray-600">+{a.xp} XP</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="h-2" />
    </div>
  )
}
