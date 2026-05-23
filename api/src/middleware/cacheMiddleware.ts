import { Request, Response, NextFunction } from 'express'

// In-memory cache store (suitable for single-instance deployment)
interface CacheEntry {
  data: any
  expiry: number
}

const cache: Record<string, CacheEntry> = {}
const cachePrefix = process.env.REDIS_CACHE_PREFIX || 'cache:'

const stableStringify = (input: unknown): string => {
  if (input === null || typeof input !== 'object') return JSON.stringify(input)
  if (Array.isArray(input)) return `[${input.map(stableStringify).join(',')}]`

  const entries = Object.entries(input as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `"${key}":${stableStringify(value)}`)

  return `{${entries.join(',')}}`
}

export function cacheMiddleware(ttlSeconds: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next()
    }

    const cacheKey = `${cachePrefix}${req.path}:${stableStringify(req.query || {})}`
    const now = Date.now()

    // Check if cached entry exists and is not expired
    if (cache[cacheKey] && cache[cacheKey].expiry > now) {
      res.setHeader('X-Cache', 'HIT')
      return res.json(cache[cacheKey].data)
    }

    // Store original res.json
    const originalJson = res.json.bind(res)

    // Override res.json to cache the response
    res.json = function (data: any) {
      cache[cacheKey] = {
        data,
        expiry: now + ttlSeconds * 1000,
      }

      res.setHeader('X-Cache', 'MISS')
      return originalJson(data)
    }

    next()
  }
}

// Cleanup expired cache entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  let cleaned = 0
  for (const key in cache) {
    if (cache[key].expiry < now) {
      delete cache[key]
      cleaned++
    }
  }
  if (cleaned > 0) {
    console.log(`Cache cleanup: removed ${cleaned} expired entries`)
  }
}, 5 * 60 * 1000)
