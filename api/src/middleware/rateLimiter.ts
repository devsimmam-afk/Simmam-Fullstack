import { Request, Response, NextFunction } from 'express'

// In-memory store for single-instance deployments
const requestCounts: Record<string, { count: number; resetTime: number }> = {}

function getClientIp(req: any): string {
  const cloudflareIp = req.headers['cf-connecting-ip'] as string | undefined
  const realIp = req.headers['x-real-ip'] as string | undefined
  const forwardedIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]
  return cloudflareIp || realIp || forwardedIp || req.socket?.remoteAddress || 'unknown'
}

function getRouteKey(req: any): string {
  const routePath = req?.route?.path ? String(req.route.path) : req.path || 'unknown'
  return `${req.method || 'GET'}:${routePath}`
}

export function createSimpleLimiter(bucket: string, windowMs: number, max: number, message: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${bucket}:${getClientIp(req)}:${getRouteKey(req)}`
    const now = Date.now()

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
      res.setHeader('RateLimit-Remaining', '0')
      return res.status(429).json({ error: message })
    }
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - requestCounts[key].count)))
    return next()
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
export const adminLimiter = createSimpleLimiter(
  'admin',
  15 * 60 * 1000,
  1200,
  'Admin request limit exceeded'
)

export function resetRateLimitCounts() {
  for (const k of Object.keys(requestCounts)) delete requestCounts[k]
}
