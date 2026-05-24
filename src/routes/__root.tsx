import { HeadContent, Scripts, createRootRoute, Outlet } from '@tanstack/react-router'
import { BottomNav } from '../components/BottomNav.js'
import '../styles.css'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' },
      { title: 'LootPad' },
      { name: 'theme-color', content: '#0d0d1a' },
    ],
    links: [{ rel: 'icon', href: '/favicon.ico' }],
    scripts: [
      { src: 'https://telegram.org/js/telegram-web-app.js' },
      { src: 'https://sad.adsgram.ai/js/sad.min.js' },
      { src: 'https://libtl.com/sdk.js?zone=11049772&sdk=show_11049772' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body style={{ margin: 0, background: '#0a0a1a', color: '#e2e8f0', overscrollBehavior: 'none' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100dvh', position: 'relative' }}>
          {children}
          <BottomNav />
        </div>
        <Scripts />
      </body>
    </html>
  )
}
