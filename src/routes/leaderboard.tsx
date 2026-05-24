import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { getLeaderboard } from '../server/user.functions.js'
import { getTelegramUserId, hapticSelect } from '../lib/telegram.js'

export const Route = createFileRoute('/leaderboard')({
  component: LeaderboardPage,
})

type Category = 'top_inviters' | 'highest_streak' | 'most_spins' | 'weekly_xp' | 'top_level'

const CATEGORIES: { id: Category; label: string; emoji: string; unit: string }[] = [
  { id: 'top_inviters',  label: 'Top Inviters',   emoji: '👥', unit: 'invites'  },
  { id: 'highest_streak',label: 'Best Streak',    emoji: '🔥', unit: 'days'     },
  { id: 'most_spins',    label: 'Most Spins',     emoji: '🎡', unit: 'spins'    },
  { id: 'weekly_xp',     label: 'Top XP',         emoji: '⚡', unit: 'XP'       },
  { id: 'top_level',     label: 'Highest Level',  emoji: '👑', unit: 'level'    },
]

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

function LeaderboardPage() {
  const [category, setCategory] = useState<Category>('most_spins')
  const [entries, setEntries] = useState<{ rank: number; displayName: string; score: number; telegramId: string }[]>([])
  const [loading, setLoading] = useState(true)
  const myId = getTelegramUserId()
  const getLeaderFn = useServerFn(getLeaderboard)

  useEffect(() => {
    setLoading(true)
    getLeaderFn({ data: { category } })
      .then(setEntries)
      .finally(() => setLoading(false))
  }, [category])

  const myRank = entries.findIndex(e => e.telegramId === myId) + 1
  const currentCat = CATEGORIES.find(c => c.id === category)!

  return (
    <div className="page">

      <div className="text-center">
        <h1 className="text-xl font-bold shimmer-text">Leaderboard</h1>
        <p className="text-gray-400 text-sm mt-1">Compete with players worldwide</p>
      </div>

      {/* Category selector */}
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => { setCategory(cat.id); hapticSelect() }}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
            style={{
              background:  category === cat.id ? 'linear-gradient(135deg,#7c3aed,#5b21b6)' : '#13132b',
              border:      category === cat.id ? '1px solid #6d28d9' : '1px solid #2e2e60',
              color:       category === cat.id ? 'white' : '#9ca3af',
            }}
          >
            {cat.emoji} {cat.label}
          </button>
        ))}
      </div>

      {/* My rank callout */}
      {myRank > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
          style={{ background: '#1a1040', border: '1px solid #4c1d95' }}
        >
          <span className="text-xl">🎯</span>
          <p className="text-sm text-purple-300">
            Your rank: <strong className="text-white">#{myRank}</strong> in {currentCat.label}
          </p>
        </div>
      )}

      {/* List */}
      <div className="card p-3">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">{currentCat.emoji}</span>
          <p className="text-sm font-bold text-white">{currentCat.label}</p>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">
            <div className="text-3xl mb-2 animate-spin">⏳</div>
            Loading...
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-3xl mb-2">🏆</p>
            <p className="text-sm">No data yet. Be the first!</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {entries.map((entry, i) => {
              const isMe = entry.telegramId === myId
              return (
                <div
                  key={entry.telegramId + i}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
                  style={{
                    background: isMe
                      ? 'linear-gradient(135deg, #2d1b4e, #1a1040)'
                      : entry.rank <= 3 ? '#1a1a2e' : '#0d0d1a',
                    border: isMe
                      ? '1px solid #6d28d9'
                      : entry.rank <= 3 ? '1px solid #2e2e60' : '1px solid #1a1a30',
                  }}
                >
                  {/* Rank */}
                  <div className="w-7 text-center flex-shrink-0">
                    {MEDAL[entry.rank] ? (
                      <span className="text-xl">{MEDAL[entry.rank]}</span>
                    ) : (
                      <span className="text-xs font-mono text-gray-500">#{entry.rank}</span>
                    )}
                  </div>

                  {/* Avatar initial */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-xs flex-shrink-0"
                    style={{ background: isMe ? 'linear-gradient(135deg,#7c3aed,#5b21b6)' : '#2a2a50' }}
                  >
                    {(entry.displayName ?? '?').slice(0, 2).toUpperCase()}
                  </div>

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: isMe ? '#c4b5fd' : '#e2e8f0' }}>
                      {entry.displayName ?? 'Anonymous'} {isMe && <span className="text-xs text-purple-400">(you)</span>}
                    </p>
                  </div>

                  {/* Score */}
                  <div className="text-right flex-shrink-0">
                    <p className="font-black text-sm" style={{ color: entry.rank === 1 ? '#f59e0b' : entry.rank === 2 ? '#9ca3af' : entry.rank === 3 ? '#b45309' : '#a78bfa' }}>
                      {entry.score.toLocaleString()}
                    </p>
                    <p className="text-gray-600" style={{ fontSize: '0.6rem' }}>{currentCat.unit}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {myRank === 0 && (
        <p className="text-center text-xs text-gray-600 pb-2">
          Keep spinning to appear on the leaderboard!
        </p>
      )}
    </div>
  )
}
