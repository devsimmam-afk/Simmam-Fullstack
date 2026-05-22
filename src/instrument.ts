const dsn = import.meta.env.VITE_SENTRY_DSN
const tracesSampleRate = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0.1)

if (typeof window !== 'undefined' && dsn) {
  const _sentryModule = ['@', 'sentry', '/react'].join('')
  void import(_sentryModule).then((Sentry) => {
    Sentry.init({
      dsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE || 'development',
      release: import.meta.env.VITE_SENTRY_RELEASE,
      tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.1,
      sendDefaultPii: true,
    })
  }).catch(() => {
    // If @sentry/react isn't present, ignore — instrumentation is optional.
  })
}
