const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function getAppUrl(pathname = '/'): string {
  const configuredBase = (import.meta.env.VITE_APP_URL as string | undefined)?.trim()
  const base = configuredBase && isHttpUrl(configuredBase)
    ? configuredBase.replace(/\/$/, '')
    : typeof window !== 'undefined' && isHttpUrl(window.location.origin)
      ? window.location.origin.replace(/\/$/, '')
      : 'http://localhost:5173'

  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${base}${normalizedPath}`
}