import { createRouter, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
// Dynamically import Sentry in client-only code to avoid server-side module resolution
import { routeTree } from "./routeTree.gen";

const AUTO_RELOAD_KEY = "simmam_error_auto_reload_attempted"

function isAutoReloadableError(error: Error) {
  const message = `${error?.message || ""} ${error?.name || ""}`.toLowerCase()
  return (
    message.includes("minified react error #130") ||
    message.includes("chunkloaderror") ||
    message.includes("loading chunk") ||
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("importing a module script failed")
  )
}

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    // Sentry removed — log to console for diagnostics
    try { console.error(error) } catch (_) {}

    if (typeof window === 'undefined') return

    const shouldAutoReload = isAutoReloadableError(error)
    const alreadyReloaded = window.sessionStorage.getItem(AUTO_RELOAD_KEY) === 'true'

    if (shouldAutoReload && !alreadyReloaded) {
      window.sessionStorage.setItem(AUTO_RELOAD_KEY, 'true')
      const timer = window.setTimeout(() => {
        window.location.reload()
      }, 2500)

      return () => window.clearTimeout(timer)
    }
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Recovering the page</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page hit a temporary loading error. We will retry automatically.
        </p>
        <p className="mt-2 text-xs text-muted-foreground/80">
          If the page still does not recover, use Reload now.
        </p>
        {import.meta.env.DEV && error.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.sessionStorage.removeItem(AUTO_RELOAD_KEY)
              }
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Reload now
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
