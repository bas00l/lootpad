import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { getReferralStats } from '../server/referral.functions.js'
import { getTelegramUserId, hapticSuccess, openTelegramShare } from '../lib/telegram.js'
import { REFERRAL_BONUS_STARS, REFERRAL_BONUS_SPINS, BOT_NAME as BOT_USERNAME } from '../lib/constants.js'

export const Route = createFileRoute('/referral')({
  component: ReferralPage,
})

function ReferralPage() {
  const [stats, setStats] = useState({
    referralCode: '',
    referralCount: 0,
    totalStarsEarned: 0,
    totalSpinsEarned: 0,
    recent: [] as { name: string; starsAwarded: number; createdAt: string }[],
  })
  const [copied, setCopied] = useState(false)
  const getFn = useServerFn(getReferralStats)

  useEffect(() => {
    getFn({ data: { telegramId: getTelegramUserId() } }).then(setStats as any)
  }, [])

  const referralLink = `https://t.me/${BOT_USERNAME}?start=${stats.referralCode}`

  const handleCopy = async () => {
    await navigator.clipboard.writeText(referralLink)
    setCopied(true)
    hapticSuccess()
    setTimeout(() => setCopied(false), 2000)
  }

  const handleShare = () => {
    openTelegramShare(
      referralLink,
      `🎡 Earn free crypto every day!\n\nJoin LootPad – spin the wheel, complete tasks, win TON, USDT & more!\n\nYou get ${Math.floor(REFERRAL_BONUS_STARS / 2)} bonus ⭐ when you join with my link 👇`,
    )
    hapticSuccess()
  }

  function timeAgo(iso: string) {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (d < 60) return 'just now'
    if (d < 3600) return `${Math.floor(d / 60)}m ago`
    if (d < 86400) return `${Math.floor(d / 3600)}h ago`
    return `${Math.floor(d / 86400)}d ago`
  }

  return (
    <div className="page">
      <div className="text-center">
        <h1 className="text-xl font-bold shimmer-text">👥 Frens</h1>
        <p className="text-gray-400 text-sm mt-1">Invite frens — earn stars & spins</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="card p-3 text-center">
          <p className="text-2xl font-black text-purple-400">{stats.referralCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">Invited</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-2xl font-black text-yellow-400">{stats.totalStarsEarned}</p>
          <p className="text-xs text-gray-400 mt-0.5">Stars earned*</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-2xl font-black text-green-400">{stats.totalSpinsEarned}</p>
          <p className="text-xs text-gray-400 mt-0.5">Spins earned</p>
        </div>
      </div>

      <p className="text-gray-500 text-center" style={{fontSize:'0.6rem'}}>* Stars credited after your friend completes 5 spins &amp; 3 ads</p>

      {/* Reward info */}
      <div
        className="rounded-2xl p-4"
        style={{ background: 'linear-gradient(135deg, #2d1b4e, #1a1040)', border: '1px solid #4c1d95' }}
      >
        <p className="text-center font-bold text-purple-300 mb-3">🎁 Per Referral Bonus</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-2 rounded-xl" style={{ background: '#1e1e40' }}>
            <p className="text-xs text-gray-400 mb-1">You receive</p>
            <p className="text-xl font-black text-yellow-400">+{REFERRAL_BONUS_STARS}⭐</p>
            <p className="text-green-400 font-bold text-sm">+{REFERRAL_BONUS_SPINS} 🎫 spins</p>
          </div>
          <div className="text-center p-2 rounded-xl" style={{ background: '#1e1e40' }}>
            <p className="text-xs text-gray-400 mb-1">Friend receives</p>
            <p className="text-xl font-black text-green-400">+{Math.floor(REFERRAL_BONUS_STARS / 2)}⭐</p>
            <p className="text-gray-500 text-xs mt-1">Welcome bonus</p>
          </div>
        </div>
      </div>

      {/* Referral code */}
      <div className="card p-4">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Your Invite Link</p>
        <div
          className="flex items-center gap-2 p-3 rounded-xl mb-3"
          style={{ background: '#0d0d1a', border: '1px solid #2e2e60' }}
        >
          <span className="font-mono text-purple-300 font-bold tracking-widest flex-1 text-xs truncate">
            {stats.referralCode ? referralLink : '--------'}
          </span>
          <button
            onClick={handleCopy}
            className="text-xs px-2 py-1 rounded-lg transition-all flex-shrink-0"
            style={{ background: copied ? '#1a3a1a' : '#2a1a4a', color: copied ? '#4ade80' : '#a78bfa' }}
          >
            {copied ? '✅' : '📋'}
          </button>
        </div>
        <button className="btn-primary" onClick={handleShare}>
          📤 Share via Telegram
        </button>
      </div>

      {/* Recent referrals */}
      {stats.recent.length > 0 && (
        <div className="card p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Recent Recruits</p>
          <div className="flex flex-col gap-2">
            {stats.recent.map((r, i) => (
              <div key={i} className="flex items-center gap-2 py-1">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: '#2a1a4a', color: '#c4b5fd' }}>
                  {r.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-200 font-semibold">{r.name}</p>
                  <p className="text-xs text-gray-500">{timeAgo(r.createdAt)}</p>
                </div>
                <p className="text-yellow-400 text-xs font-bold">+{r.starsAwarded}⭐</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="card p-4">
        <p className="text-xs font-bold text-purple-300 mb-3">How referrals work</p>
        <div className="space-y-2.5">
          {[
            { icon: '1️⃣', text: 'Tap "Share via Telegram" to send your invite link' },
            { icon: '2️⃣', text: 'Friend opens the link and joins LootPad' },
            { icon: `3️⃣`, text: `Once your friend completes 5 spins + 3 ads, you get ${REFERRAL_BONUS_STARS} ⭐ + ${REFERRAL_BONUS_SPINS} free spins` },
            { icon: '4️⃣', text: 'More friends = more spins & higher leaderboard rank' },
          ].map((step) => (
            <div key={step.icon} className="flex items-start gap-3">
              <span className="text-lg">{step.icon}</span>
              <p className="text-sm text-gray-300">{step.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
