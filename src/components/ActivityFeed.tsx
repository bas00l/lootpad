import { useEffect, useState } from 'react'
import { getActivityFeed } from '../server/activity.functions.js'
import { useServerFn } from '@tanstack/react-start'
import { TOKENS } from '../lib/constants.js'

interface FeedItem {
  id: number
  displayText: string
  token: string
  createdAt: string
}

export function ActivityFeed() {
  const [items, setItems] = useState<FeedItem[]>([])
  const fetchFeed = useServerFn(getActivityFeed)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const data = await fetchFeed()
        if (mounted) setItems(data as FeedItem[])
      } catch {
        // ignore
      }
    }
    load()
    const interval = setInterval(load, 12_000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  // Inject fake entries periodically to simulate live activity
  useEffect(() => {
    const fakeNames = ['Alex', 'Maria', 'Pavel', 'Yuki', 'Carlos', 'Mia', 'Arjun', 'Zoe']
    const tokens = Object.keys(TOKENS) as (keyof typeof TOKENS)[]
    const interval = setInterval(() => {
      const name = fakeNames[Math.floor(Math.random() * fakeNames.length)]
      const token = tokens[Math.floor(Math.random() * tokens.length)]
      const cfg = TOKENS[token]
      const newItem: FeedItem = {
        id: -Date.now(),
        displayText: `${name} won ${cfg.emoji} ${token}`,
        token,
        createdAt: new Date().toISOString(),
      }
      setItems((prev) => [newItem, ...prev].slice(0, 20))
    }, 8_000 + Math.random() * 7_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: '#0d0d1a', border: '1px solid #1e1e40' }}
    >
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid #1e1e40' }}>
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-xs font-bold text-green-400">LIVE ACTIVITY</span>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: 160 }}>
        {items.map((item, idx) => {
          const cfg = TOKENS[item.token as keyof typeof TOKENS]
          return (
            <div
              key={item.id}
              className="flex items-center gap-2 px-3 py-1.5 text-xs transition-all"
              style={{
                borderBottom: '1px solid #1a1a30',
                opacity: 1 - idx * 0.04,
                animationName: idx === 0 ? 'fadeInDown' : undefined,
                animationDuration: '0.4s',
              }}
            >
              <span className="text-base">{cfg?.emoji ?? '🎁'}</span>
              <span className="text-gray-300 flex-1">{item.displayText}</span>
              <span className="text-gray-500 text-xs">
                {timeAgo(item.createdAt)}
              </span>
            </div>
          )
        })}
        {items.length === 0 && (
          <div className="px-3 py-4 text-center text-gray-500 text-xs">Loading...</div>
        )}
      </div>
    </div>
  )
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 5) return 'now'
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  return `${Math.floor(diff / 3600)}h`
}
