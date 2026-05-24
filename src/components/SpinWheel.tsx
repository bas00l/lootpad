import { useEffect, useRef, useState } from 'react'
import { TOKENS, TOKEN_KEYS } from '../lib/constants.js'

interface SpinWheelProps {
  isSpinning: boolean
  result: string | null
  onSpinComplete: () => void
}

const SEGMENT_COUNT = TOKEN_KEYS.length
const SEGMENT_ANGLE = 360 / SEGMENT_COUNT

export function SpinWheel({ isSpinning, result, onSpinComplete }: SpinWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rotation, setRotation] = useState(0)
  const animRef = useRef<number | null>(null)
  const startRotRef = useRef(0)
  const targetRotRef = useRef(0)
  const startTimeRef = useRef(0)
  const durationRef = useRef(3000)

  function drawWheel(ctx: CanvasRenderingContext2D, size: number, rot: number) {
    const cx = size / 2, cy = size / 2
    const radius = size / 2 - 4
    ctx.clearRect(0, 0, size, size)

    TOKEN_KEYS.forEach((key, i) => {
      const cfg = TOKENS[key]
      const startAngle = ((i * SEGMENT_ANGLE - 90) * Math.PI) / 180 + (rot * Math.PI) / 180
      const endAngle = startAngle + (SEGMENT_ANGLE * Math.PI) / 180

      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, radius, startAngle, endAngle)
      ctx.closePath()
      ctx.fillStyle = i % 2 === 0 ? cfg.bg : '#1a1a2e'
      ctx.fill()
      ctx.strokeStyle = cfg.color + '80'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Emoji label
      const midAngle = startAngle + (SEGMENT_ANGLE * Math.PI) / 360
      const labelR = radius * 0.65
      const lx = cx + Math.cos(midAngle) * labelR
      const ly = cy + Math.sin(midAngle) * labelR
      ctx.save()
      ctx.translate(lx, ly)
      ctx.font = `${size * 0.085}px serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(cfg.emoji, 0, 0)
      ctx.restore()

      // Token symbol
      const symbolR = radius * 0.38
      const sx = cx + Math.cos(midAngle) * symbolR
      const sy = cy + Math.sin(midAngle) * symbolR
      ctx.save()
      ctx.translate(sx, sy)
      ctx.rotate(midAngle + Math.PI / 2)
      ctx.font = `bold ${size * 0.054}px system-ui`
      ctx.fillStyle = cfg.color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(cfg.symbol, 0, 0)
      ctx.restore()
    })

    // Center circle
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 0.14, 0, Math.PI * 2)
    ctx.fillStyle = '#0d0d1a'
    ctx.fill()
    ctx.strokeStyle = '#4c1d95'
    ctx.lineWidth = 2
    ctx.stroke()

    // Outer ring
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.strokeStyle = isSpinning ? '#7c3aed' : '#4c1d95'
    ctx.lineWidth = isSpinning ? 4 : 2
    ctx.stroke()

    // Pointer
    const pw = size * 0.055, ph = size * 0.09
    ctx.beginPath()
    ctx.moveTo(cx, cy - radius - 2)
    ctx.lineTo(cx - pw / 2, cy - radius + ph)
    ctx.lineTo(cx + pw / 2, cy - radius + ph)
    ctx.closePath()
    ctx.fillStyle = '#f59e0b'
    ctx.fill()
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  function getTargetRotation(tokenKey: string): number {
    const idx = TOKEN_KEYS.indexOf(tokenKey as any)
    if (idx === -1) return 0
    const segCenter = idx * SEGMENT_ANGLE + SEGMENT_ANGLE / 2
    const targetAngle = (360 - segCenter) % 360
    const fullSpins = 5 + Math.floor(Math.random() * 3)
    return fullSpins * 360 + targetAngle
  }

  function easeOut(t: number): number { return 1 - Math.pow(1 - t, 4) }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawWheel(ctx, canvas.width, rotation)
  }, [rotation, isSpinning])

  useEffect(() => {
    if (isSpinning && result) {
      if (animRef.current) cancelAnimationFrame(animRef.current)
      startRotRef.current = rotation % 360
      targetRotRef.current = getTargetRotation(result)
      startTimeRef.current = performance.now()
      durationRef.current = 3200 + Math.random() * 800

      function animate(now: number) {
        const elapsed = now - startTimeRef.current
        const progress = Math.min(elapsed / durationRef.current, 1)
        const newRot = startRotRef.current + (targetRotRef.current - startRotRef.current) * easeOut(progress)
        setRotation(newRot)
        if (progress < 1) {
          animRef.current = requestAnimationFrame(animate)
        } else {
          setRotation(targetRotRef.current % 360)
          onSpinComplete()
        }
      }
      animRef.current = requestAnimationFrame(animate)
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [isSpinning, result])

  return (
    <div className="relative flex items-center justify-center">
      <canvas
        ref={canvasRef}
        width={280}
        height={280}
        className="drop-shadow-2xl"
        style={{
          filter: isSpinning
            ? 'drop-shadow(0 0 20px #7c3aed) drop-shadow(0 0 40px #4c1d9560)'
            : 'drop-shadow(0 0 8px #4c1d9540)',
          transition: 'filter 0.3s',
        }}
      />
    </div>
  )
}
