import { TOKENS } from '../lib/constants.js'

type TokenSymbol = keyof typeof TOKENS

interface TokenIconProps {
  token: string
  size?: number
  showName?: boolean
}

export function TokenIcon({ token, size = 40, showName = false }: TokenIconProps) {
  const cfg = TOKENS[token as TokenSymbol]
  if (!cfg) return null

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="rounded-full flex items-center justify-center font-bold shadow-lg"
        style={{
          width: size,
          height: size,
          backgroundColor: cfg.bg,
          border: `2px solid ${cfg.color}`,
          fontSize: size * 0.42,
          boxShadow: `0 0 8px ${cfg.color}40`,
        }}
      >
        {cfg.emoji}
      </div>
      {showName && (
        <span className="text-xs font-semibold" style={{ color: cfg.color }}>
          {cfg.symbol}
        </span>
      )}
    </div>
  )
}

export function TokenBadge({ token, size = 24 }: { token: string; size?: number }) {
  const cfg = TOKENS[token as TokenSymbol]
  if (!cfg) return <span className="text-xs text-gray-400">{token}</span>
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40` }}
    >
      <span style={{ fontSize: size * 0.6 }}>{cfg.emoji}</span>
      {cfg.symbol}
    </span>
  )
}
