declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string
        initDataUnsafe: {
          user?: {
            id: number
            first_name: string
            last_name?: string
            username?: string
            language_code?: string
            photo_url?: string
          }
          start_param?: string
        }
        colorScheme: 'light' | 'dark'
        themeParams: {
          bg_color?: string
          text_color?: string
          hint_color?: string
          link_color?: string
          button_color?: string
          button_text_color?: string
          secondary_bg_color?: string
        }
        isExpanded: boolean
        viewportHeight: number
        MainButton: {
          text: string
          show: () => void
          hide: () => void
          onClick: (fn: () => void) => void
        }
        BackButton: {
          show: () => void
          hide: () => void
          onClick: (fn: () => void) => void
        }
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void
          selectionChanged: () => void
        }
        expand: () => void
        close: () => void
        ready: () => void
        openTelegramLink: (url: string) => void
        openLink: (url: string) => void
      }
    }
  }
}

export function getTelegramUser() {
  if (typeof window === 'undefined') return null
  return window.Telegram?.WebApp?.initDataUnsafe?.user ?? null
}

export function getTelegramUserId(): string {
  const user = getTelegramUser()
  if (user) return String(user.id)
  return 'demo_' + (localStorage.getItem('demo_uid') ?? (() => {
    const id = String(Math.floor(Math.random() * 900000) + 100000)
    localStorage.setItem('demo_uid', id)
    return id
  })())
}

export function getTelegramStartParam(): string | null {
  if (typeof window === 'undefined') return null
  return window.Telegram?.WebApp?.initDataUnsafe?.start_param ?? null
}

/** Returns theme colors from Telegram or sensible dark-mode fallbacks */
export function getTelegramTheme() {
  const tp = window.Telegram?.WebApp?.themeParams
  return {
    bgColor:        tp?.bg_color           ?? '#0a0a1a',
    textColor:      tp?.text_color         ?? '#e2e8f0',
    hintColor:      tp?.hint_color         ?? '#6b7280',
    linkColor:      tp?.link_color         ?? '#a78bfa',
    buttonColor:    tp?.button_color       ?? '#7c3aed',
    buttonText:     tp?.button_text_color  ?? '#ffffff',
    secondaryBg:    tp?.secondary_bg_color ?? '#13132b',
    isDark:         (window.Telegram?.WebApp?.colorScheme ?? 'dark') === 'dark',
  }
}

export function hapticImpact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'medium') {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style)
}
export function hapticSuccess() {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success')
}
export function hapticError() {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error')
}
export function hapticWarning() {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('warning')
}
export function hapticSelect() {
  window.Telegram?.WebApp?.HapticFeedback?.selectionChanged()
}

export function initTelegramApp() {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
    window.Telegram.WebApp.ready()
    window.Telegram.WebApp.expand()
  }
}

export function openTelegramShare(url: string, text: string) {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(shareUrl)
  } else {
    window.open(shareUrl, '_blank')
  }
}
