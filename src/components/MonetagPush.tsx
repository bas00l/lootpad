import { useEffect, useRef } from 'react'

/**
 * Monetag In-Page Push — passive CPM unit that renders real DOM nodes.
 * Works inside Telegram WebView because it doesn't use iframes.
 *
 * Zone ID is read from VITE_MONETAG_PUSH_ZONE_ID env var.
 * Set this in Vercel → Project → Settings → Environment Variables.
 *
 * To get your zone ID:
 *   1. partner.monetag.com → Sites → Add Site
 *   2. Create an "In-Page Push" ad unit
 *   3. Copy the numeric zone ID from the generated script tag
 */
const PUSH_ZONE = (import.meta.env.VITE_MONETAG_PUSH_ZONE_ID as string | undefined)?.trim()

export function MonetagPush() {
  const ref       = useRef<HTMLDivElement>(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!PUSH_ZONE)            return   // env var not set — render nothing
    if (loadedRef.current)     return   // already injected
    if (!ref.current)          return
    loadedRef.current = true

    const src = `https://pl.propellerads.com/sdk/app/in-page-push?zone=${PUSH_ZONE}`

    // Avoid duplicate scripts (React StrictMode double-invoke)
    if (document.querySelector(`script[src="${src}"]`)) return

    const script    = document.createElement('script')
    script.src      = src
    script.async    = true
    script.setAttribute('data-cfasync', 'false')
    document.body.appendChild(script)

    return () => {
      // Don't remove on cleanup — SDK only needs to load once per session
    }
  }, [])

  if (!PUSH_ZONE) return null

  // The SDK will render its push widget into the page body automatically.
  // This div is a mount hint only — actual rendering is handled by the SDK.
  return <div ref={ref} id="monetag-push-mount" style={{ display: 'none' }} />
}
