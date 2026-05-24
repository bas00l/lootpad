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
import { getBalances, requestWithdrawal, getWithdrawals } from '../server/withdraw.functions.js'
import { getUser } from '../server/user.functions.js'
import { getTelegramUserId, hapticSuccess, hapticError } from '../lib/telegram.js'
import { TOKENS, WITHDRAWAL_STAR_FEE_PCT } from '../lib/constants.js'
import { TokenIcon } from '../components/TokenIcon.js'

export const Route = createFileRoute('/withdraw')({
  component: WithdrawPage,
})

interface Balance { token: string; amount: number }
interface Withdrawal {
  id: number; token: string; amount: string; starsCost: number;
  walletAddress: string; status: string; createdAt: string | null
}

function WithdrawPage() {
  const [balances, setBalances] = useState<Balance[]>([])
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [stars, setStars] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [wallet, setWallet] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<{ amount: number; token: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const getBalancesFn = useServerFn(getBalances)
  const requestFn = useServerFn(requestWithdrawal)
  const getWithdrawalsFn = useServerFn(getWithdrawals)
  const getUserFn = useServerFn(getUser)

  const tgId = getTelegramUserId()

  const loadData = async () => {
    const [bals, wds, usr] = await Promise.all([
      getBalancesFn({ data: { telegramId: tgId } }),
      getWithdrawalsFn({ data: { telegramId: tgId } }),
      getUserFn({ data: { telegramId: tgId } }),
    ])
    setBalances(bals)
    setWithdrawals(wds as Withdrawal[])
    // Stars are authoritative from DB — never trust localStorage
    if (usr) setStars(usr.stars ?? 0)
  }

  useEffect(() => {
    loadData().finally(() => setLoading(false))
  }, [])

  const handleWithdraw = async () => {
    if (!selected || !wallet.trim()) return
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await requestFn({ data: { telegramId: tgId, token: selected, walletAddress: wallet.trim() } })
      setSuccess({ amount: result.amount, token: selected })
      hapticSuccess()
      await loadData()
      setWallet('')
      setSelected(null)
    } catch (e) {
      const msg = getServerErrMsg(e, 'Failed')
      if (msg.startsWith('MIN_BALANCE:')) {
        setError(`Minimum balance required: ${msg.split(':')[1]}`)
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
    pending: '#f59e0b',
    processing: '#3b82f6',
    completed: '#22c55e',
    rejected: '#ef4444',
  }

  const statusEmoji: Record<string, string> = {
    pending: '⏳',
    processing: '🔄',
    completed: '✅',
    rejected: '❌',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-3xl animate-spin">⏳</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 px-3 pt-4">
      <div className="text-center">
        <h1 className="text-xl font-bold shimmer-text">Withdraw</h1>
        <p className="text-gray-400 text-sm">Withdraw real crypto to your TON wallet</p>
      </div>

      {/* Token selection */}
      <div className="card p-4">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Select Token</p>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(TOKENS).map(([key, cfg]) => {
            const bal = balances.find((b) => b.token === key)
            const amount = bal?.amount ?? 0
            const hasEnough = amount >= cfg.withdrawThreshold
            const isSelected = selected === key

            return (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl transition-all"
                style={{
                  background: isSelected ? cfg.bg : '#12122a',
                  border: isSelected ? `2px solid ${cfg.color}` : '1px solid #1e1e40',
                  opacity: 1,
                }}
              >
                <TokenIcon token={key} size={32} />
                <span className="text-xs font-bold" style={{ color: cfg.color }}>{key}</span>
                <span
                  className="font-mono text-center leading-tight"
                  style={{ fontSize: '0.6rem', color: hasEnough ? '#4ade80' : '#9ca3af' }}
                >
                  {formatAmount(amount)}
                </span>
                <span className="text-gray-500 leading-none" style={{ fontSize: '0.55rem' }}>
                  min: {cfg.withdrawThreshold}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Stars cost info */}
      {selectedCfg && (
        <div
          className="rounded-xl p-3 slide-up"
          style={{ background: '#1a1040', border: '1px solid #4c1d95' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-white">{selectedCfg.name} Withdrawal</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Balance: {formatAmount(selectedBalance?.amount ?? 0)} {selected}
              </p>
              <p className="text-xs text-gray-400">
                Minimum: {selectedCfg.withdrawThreshold} {selected}
              </p>
            </div>
            <div className="text-right">
              <p className="text-yellow-400 font-black text-xl">
                ⭐{Math.ceil(selectedCfg.starsCost * (1 + WITHDRAWAL_STAR_FEE_PCT))}
              </p>
              <p className="text-gray-500 text-xs">stars total (incl. 10% fee)</p>
            </div>
          </div>
          {(selectedBalance?.amount ?? 0) < selectedCfg.withdrawThreshold && (
            <div
              className="mt-2 rounded-lg p-2 text-xs text-yellow-300"
              style={{ background: '#2a1800', border: '1px solid #92400e' }}
            >
              ⚠️ Need {(selectedCfg.withdrawThreshold - (selectedBalance?.amount ?? 0)).toFixed(8)} more {selected} to withdraw
            </div>
          )}
        </div>
      )}

      {/* Wallet input */}
      {selected && (
        <div className="card p-4 slide-up">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">TON Wallet Address</p>
          <input
            type="text"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="EQ... or UQ..."
            className="w-full rounded-xl px-3 py-3 text-sm font-mono"
            style={{
              background: '#0d0d1a',
              border: '1px solid #2e2e60',
              color: '#e2e8f0',
              outline: 'none',
            }}
          />
          <p className="text-xs text-gray-500 mt-1.5">
            ⚠️ Only TON network addresses supported. Double-check your address.
          </p>
          <button
            className="btn-primary mt-3"
            onClick={handleWithdraw}
            disabled={submitting || !wallet.trim()}
          >
            {submitting
              ? '⏳ Processing...'
              : `Withdraw ${selected} — ⭐${selectedCfg ? Math.ceil(selectedCfg.starsCost * (1 + WITHDRAWAL_STAR_FEE_PCT)) : ''}`}
          </button>
        </div>
      )}

      {success && (
        <div className="bounce-in rounded-xl p-4 text-center"
          style={{ background: '#1a3a1a', border: '1px solid #16a34a' }}>
          <p className="text-2xl mb-1">🎉</p>
          <p className="text-green-400 font-bold">Withdrawal Submitted!</p>
          <p className="text-sm text-gray-300 mt-1">
            {formatAmount(success.amount)} {success.token} → pending review
          </p>
          <p className="text-xs text-gray-500 mt-1">Processed within 24–72 hours</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl p-3 text-center text-red-400 text-sm"
          style={{ background: '#2a0a0a', border: '1px solid #7f1d1d' }}>
          {error}
        </div>
      )}

      {/* Withdrawal history */}
      {withdrawals.length > 0 && (
        <div className="card p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">History</p>
          <div className="flex flex-col gap-2">
            {withdrawals.map((w) => {
              const cfg = TOKENS[w.token as keyof typeof TOKENS]
              return (
                <div
                  key={w.id}
                  className="flex items-center gap-2 p-2 rounded-xl"
                  style={{ background: '#0d0d1a', border: '1px solid #1e1e40' }}
                >
                  <span className="text-lg">{statusEmoji[w.status] ?? '❓'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white">
                      {cfg?.emoji} {parseFloat(w.amount).toFixed(4)} {w.token}
                    </p>
                    <p className="text-gray-500 font-mono truncate" style={{ fontSize: '0.6rem' }}>
                      {w.walletAddress}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold" style={{ color: statusColor[w.status] ?? '#6b7280' }}>
                      {w.status}
                    </p>
                    <p className="text-gray-500" style={{ fontSize: '0.6rem' }}>
                      -{w.starsCost}⭐
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="card p-3 mb-2">
        <p className="text-xs font-bold text-purple-300 mb-2">📋 Withdrawal Rules</p>
        <ul className="space-y-1">
          {[
            'Stars are deducted when submitting a request',
            'Full balance is withdrawn (no partial withdrawals)',
            'TON network wallets only',
            'Processing takes 24–72 hours',
            'Fraudulent accounts are disqualified',
          ].map((rule) => (
            <li key={rule} className="flex items-start gap-2 text-xs text-gray-400">
              <span className="text-purple-400">•</span> {rule}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function formatAmount(n: number): string {
  if (n >= 1000) return n.toFixed(0)
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(4)
  return n.toFixed(8)
}
