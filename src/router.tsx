import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

// router.tsx MUST export `getRouter` as a function — NOT a router constant.
// TanStack Start loads this file as the '#tanstack-router-entry' virtual module
// and calls entries.routerEntry.getRouter() on every request.
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  })

  return router
}

// Register router type for type-safe navigation throughout the app
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
