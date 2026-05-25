import { useEffect } from 'react'

const ZONE_ID = (import.meta.env.VITE_MONETAG_ZONE_ID as string | undefined)?.trim() ?? '11049772'
const SDK_FN  = `show_${ZONE_ID}`
const SDK_SRC = `https://libtl.com/sdk.js?zone=${ZONE_ID}&sdk=${SDK_FN}`

/**
 * Loads the Monetag Rewarded Interstitial SDK after Telegram.WebApp.ready()
 * has been called, so the SDK can detect the safe visual area correctly.
 *
 * Must be rendered once near the root (already in RootDocument).
 * Idempotent — won't add a second script tag if already loaded.
 */
export function MonetagLoader() {
  useEffect(() => {
    // Already loaded
    if (typeof (window as any)[SDK_FN] === 'function') return
    if (document.querySelector(`script[src="${SDK_SRC}"]`)) return

    // Signal Telegram SDK readiness before injecting Monetag
    try { window.Telegram?.WebApp?.ready() } catch { /* ignore */ }

    const script = document.createElement('script')
    script.src   = SDK_SRC
    script.async = true
    script.onerror = () => console.warn('[Monetag] SDK failed to load')
    document.head.appendChild(script)
  }, [])

  return null
}
