import { Link, useRouterState } from '@tanstack/react-router'

/**
 * Bottom navigation layout — 5 tabs:
 *   Daily | Tasks | [SPIN — center, raised] | Ranks | Frens
 *
 * Achievements moved into profile modal on the spin page (via avatar tap).
 * Wallet accessible via the 💰 button in the header.
 * "Refer" renamed to "Frens" and moved to the far right.
 * Spin sits in the center as a raised focal button.
 */

const SIDE_TABS = {
  left: [
    { to: '/daily',       label: 'Daily',  icon: '🎁' },
    { to: '/tasks',       label: 'Tasks',  icon: '✅' },
  ],
  right: [
    { to: '/leaderboard', label: 'Ranks',  icon: '🏆' },
    { to: '/referral',    label: 'Frens',  icon: '👥' },
  ],
}

const NAV_HEIGHT = 72          // px — overall bar height
const SPIN_SIZE  = 58          // px — raised center button diameter
const SPIN_LIFT  = 16          // px — how far above the bar the button pops

export function BottomNav() {
  const { location } = useRouterState()
  const path = location.pathname
  const isSpinActive = path === '/'

  return (
    <>
      {/* ── Spacer so page content doesn't hide behind nav ── */}
      <div style={{ height: NAV_HEIGHT + SPIN_LIFT }} />

      <nav
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 60,
          height: NAV_HEIGHT,
          display: 'flex',
          alignItems: 'stretch',
          background: 'linear-gradient(180deg, rgba(8,8,18,0.97) 0%, #090912 100%)',
          borderTop: '1px solid #1e1e40',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          /* safe-area for iPhone home bar */
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* ── Left tabs ── */}
        {SIDE_TABS.left.map(tab => (
          <NavTab key={tab.to} tab={tab} active={path === tab.to} />
        ))}

        {/* ── Center SPIN button ── */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 0 }}>
          <Link
            to="/"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              width: SPIN_SIZE,
              height: SPIN_SIZE,
              borderRadius: '50%',
              /* lifted above the bar */
              marginTop: -(SPIN_SIZE - NAV_HEIGHT / 2 + SPIN_LIFT / 2),
              background: isSpinActive
                ? 'linear-gradient(145deg, #9333ea, #6d28d9, #4c1d95)'
                : 'linear-gradient(145deg, #7c3aed, #5b21b6, #3b0f8c)',
              border: isSpinActive
                ? '2.5px solid #c4b5fd'
                : '2px solid #7c3aed80',
              boxShadow: isSpinActive
                ? '0 -4px 24px #7c3aed90, 0 0 0 5px rgba(124,58,237,0.15)'
                : '0 -2px 14px #7c3aed50',
              transition: 'all 0.2s cubic-bezier(0.34,1.56,0.64,1)',
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 26, lineHeight: 1, filter: isSpinActive ? 'drop-shadow(0 0 8px rgba(196,181,253,0.9))' : 'none' }}>🎡</span>
            <span style={{ fontSize: 9, fontWeight: 800, color: isSpinActive ? '#e9d5ff' : '#c4b5fd', letterSpacing: '0.06em', lineHeight: 1 }}>SPIN</span>
          </Link>
        </div>

        {/* ── Right tabs ── */}
        {SIDE_TABS.right.map(tab => (
          <NavTab key={tab.to} tab={tab} active={path === tab.to} />
        ))}
      </nav>
    </>
  )
}

function NavTab({ tab, active }: { tab: { to: string; label: string; icon: string }; active: boolean }) {
  return (
    <Link
      to={tab.to}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        textDecoration: 'none',
        padding: '0 2px',
        position: 'relative',
        transition: 'opacity 0.15s',
        opacity: active ? 1 : 0.48,
      }}
    >
      {/* Active top bar */}
      {active && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: '22%',
          right: '22%',
          height: 2,
          borderRadius: '0 0 2px 2px',
          background: 'linear-gradient(90deg, #7c3aed, #a78bfa)',
          boxShadow: '0 0 8px #7c3aed',
        }} />
      )}

      {/* Icon */}
      <span style={{
        fontSize: 24,
        lineHeight: 1,
        transform: active ? 'scale(1.18) translateY(-1px)' : 'scale(1)',
        transition: 'transform 0.22s cubic-bezier(0.34,1.56,0.64,1)',
        filter: active ? 'drop-shadow(0 0 5px rgba(167,139,250,0.75))' : 'none',
      }}>
        {tab.icon}
      </span>

      {/* Label */}
      <span style={{
        fontSize: 10,
        fontWeight: active ? 800 : 600,
        color: active ? '#c4b5fd' : '#6b7280',
        letterSpacing: '0.01em',
        lineHeight: 1,
        fontFamily: 'inherit',
      }}>
        {tab.label}
      </span>
    </Link>
  )
}
