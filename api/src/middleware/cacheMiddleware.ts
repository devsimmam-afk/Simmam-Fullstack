import { Request, Response, NextFunction } from 'express'
import IORedis from 'ioredis'
import { Redis as UpstashRedis } from '@upstash/redis'

// In-memory cache store (suitable for single-instance deployment)
interface CacheEntry {
  data: any
  expiry: number
}

const cache: Record<string, CacheEntry> = {}
const IS_PROD = process.env.NODE_ENV === 'production'
const redisUrl = process.env.REDIS_URL || process.env.REDIS_TLS_URL || ''
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || ''
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || ''
const cachePrefix = process.env.REDIS_CACHE_PREFIX || 'cache:'

let redis: IORedis | null = null
let upstash: UpstashRedis | null = null
if (redisUrl) {
  try {
    redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    })
    redis.on('error', (err: Error) => {
      console.error('Redis cache error', err)
    })
  } catch (err) {
    console.error('Failed to initialize Redis cache client, falling back to memory cache', err)
    redis = null
  }
} else if (upstashUrl && upstashToken) {
  try {
    upstash = new UpstashRedis({
      url: upstashUrl,
      token: upstashToken,
    })
  } catch (err) {
    console.error('Failed to initialize Upstash cache client, falling back to memory cache', err)
    upstash = null
  }
}

const hasSharedStore = Boolean(redis || upstash)
if (IS_PROD && !hasSharedStore) {
  throw new Error('Redis is required for production cache middleware (set REDIS_URL or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN)')
}

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

    if (redis) {
      try {
        const cached = await redis.get(cacheKey)
        if (cached) {
          res.setHeader('X-Cache', 'HIT')
          return res.json(JSON.parse(cached))
        }
      } catch (err) {
        console.error('Redis cache read failed; falling back to memory cache', err)
      }
    }

    if (upstash) {
      try {
        const cached = await upstash.get<string>(cacheKey)
        if (cached) {
          res.setHeader('X-Cache', 'HIT')
          return res.json(JSON.parse(cached))
        }
      } catch (err) {
        console.error('Upstash cache read failed; falling back to memory cache', err)
      }
    }

    if (IS_PROD) {
      console.error('Cache middleware unavailable in production: Redis/Upstash not configured or unreachable')
      return next()
    }

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

      if (redis) {
        redis
          .set(cacheKey, JSON.stringify(data), 'EX', ttlSeconds)
          .catch((err: unknown) => console.error('Redis cache write failed', err))
      }

      if (upstash) {
        upstash
          .set(cacheKey, JSON.stringify(data), { ex: ttlSeconds })
          .catch((err: unknown) => console.error('Upstash cache write failed', err))
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
