import { Request, Response, NextFunction } from 'express'
import IORedis from 'ioredis'
import { Redis as UpstashRedis } from '@upstash/redis'

// In-memory store for development (replace with Redis for production)
const requestCounts: Record<string, { count: number; resetTime: number }> = {}
const IS_PROD = process.env.NODE_ENV === 'production'

// Redis client (optional). If REDIS_URL is set, use Redis for counters across instances.
const redisUrl = process.env.REDIS_URL || process.env.REDIS_TLS_URL || ''
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || ''
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || ''
let redis: any = null
let upstash: UpstashRedis | null = null
if (redisUrl) {
  try {
    redis = new IORedis(redisUrl)
      redis.on('error', (e: Error) => console.error('Redis error', e))
  } catch (e) {
    console.error('Failed to create Redis client', e)
    redis = null
  }
} else if (upstashUrl && upstashToken) {
  try {
    upstash = new UpstashRedis({
      url: upstashUrl,
      token: upstashToken,
    })
  } catch (e) {
    console.error('Failed to create Upstash Redis client', e)
    upstash = null
  }
}

const hasSharedStore = Boolean(redis || upstash)
if (IS_PROD && !hasSharedStore) {
  throw new Error('Redis is required for production rate limiting (set REDIS_URL or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN)')
}

function getClientIp(req: any): string {
  const cloudflareIp = req.headers['cf-connecting-ip'] as string | undefined
  const realIp = req.headers['x-real-ip'] as string | undefined
  const forwardedIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]
  return cloudflareIp || realIp || forwardedIp || req.socket.remoteAddress || 'unknown'
}

function getRouteKey(req: any): string {
  const routePath = req?.route?.path ? String(req.route.path) : req.path || 'unknown'
  return `${req.method || 'GET'}:${routePath}`
}

function setRateLimitHeaders(res: Response, limit: number, remaining: number, resetSeconds: number) {
  res.setHeader('RateLimit-Limit', String(limit))
  res.setHeader('RateLimit-Remaining', String(Math.max(0, remaining)))
  res.setHeader('RateLimit-Reset', String(Math.max(1, resetSeconds)))
  res.setHeader('X-RateLimit-Limit', String(limit))
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)))
  res.setHeader('X-RateLimit-Reset', String(Math.max(1, resetSeconds)))
}

export function createSimpleLimiter(bucket: string, windowMs: number, max: number, message: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `${bucket}:${getClientIp(req)}:${getRouteKey(req)}`
    const now = Date.now()

    // If Redis is available, use it for atomic increments with expiry so counts are shared across instances.
    if (redis) {
      try {
        const r = redis.multi()
        r.incr(key)
        r.pttl(key)
        const execRes = await r.exec()
        const incrRes = execRes?.[0]
        const pttlRes = execRes?.[1]
        const count = Number(incrRes?.[1] ?? 0)
        let pttl = Number(pttlRes?.[1] ?? -1)
        if (pttl < 0) {
          // set TTL
          await redis.pexpire(key, windowMs)
          pttl = windowMs
        }
        const resetSeconds = Math.ceil(pttl / 1000)
        if (count > max) {
          res.setHeader('Retry-After', String(resetSeconds))
          setRateLimitHeaders(res, max, 0, resetSeconds)
          return res.status(429).json({ error: message })
        }
        setRateLimitHeaders(res, max, max - count, resetSeconds)
        return next()
      } catch (e) {
        console.error('Redis rate limiter error, falling back to memory', e)
        // fallthrough to in-memory
      }
    }

    if (upstash) {
      try {
        const count = Number(await upstash.incr(key))
        let ttlSeconds = Number(await upstash.ttl(key))
        if (ttlSeconds < 0) {
          ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000))
          await upstash.expire(key, ttlSeconds)
        }

        if (count > max) {
          res.setHeader('Retry-After', String(ttlSeconds))
          setRateLimitHeaders(res, max, 0, ttlSeconds)
          return res.status(429).json({ error: message })
        }

        setRateLimitHeaders(res, max, max - count, ttlSeconds)
        return next()
      } catch (e) {
        console.error('Upstash rate limiter error, falling back to memory', e)
      }
    }

    if (IS_PROD) {
      console.error('Rate limiter unavailable in production: Redis/Upstash not configured or unreachable')
      return res.status(503).json({ error: 'rate_limiter_unavailable' })
    }

    // In-memory fallback (single-instance development only)
    if (!requestCounts[key]) {
      requestCounts[key] = { count: 0, resetTime: now + windowMs }
    }
    if (now > requestCounts[key].resetTime) {
      requestCounts[key] = { count: 0, resetTime: now + windowMs }
    }
    requestCounts[key].count += 1
    if (requestCounts[key].count > max) {
      const retryAfterSeconds = Math.ceil((requestCounts[key].resetTime - now) / 1000)
      res.setHeader('Retry-After', String(retryAfterSeconds))
      setRateLimitHeaders(res, max, 0, retryAfterSeconds)
      return res.status(429).json({ error: message })
    }
    const resetSeconds = Math.ceil((requestCounts[key].resetTime - now) / 1000)
    setRateLimitHeaders(res, max, max - requestCounts[key].count, resetSeconds)
    next()
  }
}

// Public endpoints: 600 requests per 15 min per IP per route
export const publicLimiter = createSimpleLimiter(
  'public',
  15 * 60 * 1000,
  600,
  'Too many requests, please try again later'
)

// Auth/Write endpoints: 120 requests per 15 min per IP per route
export const authLimiter = createSimpleLimiter(
  'auth',
  15 * 60 * 1000,
  120,
  'Too many auth attempts, please try again later'
)

// Registration endpoint: 20 per hour per IP per route
export const registrationLimiter = createSimpleLimiter(
  'registration',
  60 * 60 * 1000,
  20,
  'Registration limit exceeded, try again in 1 hour'
)

// Admin endpoints: 1200 per 15 min per IP per route.
// Admin dashboard polls multiple resources periodically, so this needs a higher ceiling.
export const adminLimiter = createSimpleLimiter(
  'admin',
  15 * 60 * 1000,
  1200,
  'Admin request limit exceeded'
)

export function resetRateLimitCounts() {
  for (const k of Object.keys(requestCounts)) delete requestCounts[k]
}

