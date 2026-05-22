const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '')

const stripTrailingApiSegment = (value: string) => value.replace(/\/api$/i, '')

export const resolveApiBase = (rawValue?: string): string => {
  const raw = (rawValue || '').trim()
  if (!raw) return '/api'

  const withoutSlashes = trimTrailingSlashes(raw)
  if (withoutSlashes === '/api' || withoutSlashes.endsWith('/api')) {
    return withoutSlashes
  }

  return `${stripTrailingApiSegment(withoutSlashes)}/api`
}

export const resolveAdminApiBase = (rawValue?: string): string => `${resolveApiBase(rawValue)}/wch1925`