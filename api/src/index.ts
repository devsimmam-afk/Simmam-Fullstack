import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import helmet from 'helmet'
import compression from 'compression'
import morgan from 'morgan'
import * as Sentry from '@sentry/node'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { requireTurnstile } from './middleware/turnstile'
import { publicLimiter, authLimiter, registrationLimiter, adminLimiter, resetRateLimitCounts } from './middleware/rateLimiter'
import { cacheMiddleware } from './middleware/cacheMiddleware'
import {
  adminRegistrationCreateBodySchema,
  adminSettingsBodySchema,
  announcementBodySchema,
  authBodySchema,
  checkinBodySchema,
  eventCreateBodySchema,
  eventUpdateBodySchema,
  exportQuerySchema,
  leaderboardAdjustBodySchema,
  paramsSchemas,
  publicRegistrationBodySchema,
  registrationsListQuerySchema,
  registrationUpdateBodySchema,
  ruleBodySchema,
  userCreateBodySchema,
  userUpsertBodySchema,
  validateRequest,
} from './validation'

dotenv.config()

require('./instrument')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000
const FRONTEND_URL = process.env.FRONTEND_URL
const IS_PROD = process.env.NODE_ENV === 'production'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE in env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

const app = express()
app.set('trust proxy', 1)
const localDevOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/
const allowedOrigins = new Set<string>()
if (FRONTEND_URL) allowedOrigins.add(FRONTEND_URL)
if (!IS_PROD) {
  allowedOrigins.add('http://localhost:5173')
  allowedOrigins.add('http://localhost:8080')
  allowedOrigins.add('http://127.0.0.1:5173')
  allowedOrigins.add('http://127.0.0.1:8080')
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true)
      return
    }

    if (allowedOrigins.has(origin) || (!IS_PROD && localDevOriginPattern.test(origin))) {
      callback(null, true)
      return
    }

    const corsError = new Error(`CORS blocked origin: ${origin}`) as Error & { statusCode?: number; code?: string }
    corsError.statusCode = 403
    corsError.code = 'cors_blocked'
    callback(corsError)
  },
  credentials: false,
  optionsSuccessStatus: 204,
}

app.use(
  cors(corsOptions),
)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}))
app.disable('x-powered-by')
app.options('*', cors(corsOptions))
app.use(express.json({ limit: '1mb' }))
app.use((req, res, next) => {
  ;(req as any).requestId = req.headers['x-request-id'] || randomUUID()
  res.setHeader('x-request-id', String((req as any).requestId))
  next()
})
// Compression to reduce response sizes (gzip/deflate)
app.use(compression({ threshold: 1024 }))

// Structured access logs in production and concise logs in development.
app.use(
  morgan(IS_PROD ? 'combined' : 'dev', {
    skip: (req) => req.path === '/api/health',
  }),
)

// File uploads removed because the application will not accept user media uploads.

type AuthenticatedUser = {
  id: string
  email: string
  name?: string | null
}

type AdminContext = AuthenticatedUser & {
  role: string
  assignedEventId?: string | null
}

const getBearerToken = (req: express.Request) => {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

const respondValidationError = (res: express.Response, details: unknown) =>
  res.status(400).json({ error: 'validation_failed', details })

const authenticateSession = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = getBearerToken(req)
  if (!token) {
    return res.status(401).json({ error: 'missing_auth_token' })
  }

  const { data, error } = await supabase.auth.getUser(token)
  const user = data?.user
  if (error || !user?.email || !user.id) {
    return res.status(401).json({ error: 'invalid_auth_token' })
  }

  ;(req as any).authenticatedUser = {
    id: user.id,
    email: user.email.toLowerCase(),
    name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
  } satisfies AuthenticatedUser

  next()
}

const attachAdminContext = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authUser = (req as any).authenticatedUser as AuthenticatedUser | undefined
  if (!authUser?.email) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const { data, error } = await supabase
    .from('users')
    .select('id,name,email,admins!inner(role,assigned_event_id)')
    .ilike('email', authUser.email)
    .limit(1)

  if (error) {
    return res.status(500).json({ error: error.message || 'unknown' })
  }

  const userRow = Array.isArray(data) ? data[0] : data
  const adminRow = getSingleRelationsRow(userRow?.admins as any)
  if (!userRow || !adminRow || typeof adminRow !== 'object' || !('role' in adminRow)) {
    return res.status(403).json({ error: 'admin_required' })
  }

  ;(req as any).adminContext = {
    id: userRow.id,
    name: userRow.name || authUser.name || authUser.email,
    email: userRow.email,
    role: String((adminRow as any).role),
    assignedEventId: (adminRow as any).assigned_event_id || null,
  } satisfies AdminContext

  next()
}

const requireSignedInUser = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = getBearerToken(req)
  if (!token) {
    return res.status(401).json({ error: 'missing_auth_token' })
  }

  const { data, error } = await supabase.auth.getUser(token)
  const user = data?.user
  if (error || !user?.email) {
    return res.status(401).json({ error: 'invalid_auth_token' })
  }

  const authEmail = user.email.toLowerCase()
  const routeEmail = String((req.params?.email as string | undefined) || (req.body?.email as string | undefined) || '').trim().toLowerCase()
  if (routeEmail && routeEmail !== authEmail) {
    return res.status(403).json({ error: 'email_mismatch' })
  }

  ;(req as any).authenticatedUser = {
    id: user.id,
    email: authEmail,
    name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
  } satisfies AuthenticatedUser

  next()
}

app.use('/api/wch1925', authenticateSession, async (req, res, next) => {
  if (req.path === '/auth') {
    return next()
  }

  return attachAdminContext(req, res, next)
})

// Clear any in-memory rate limiter counts when server starts (useful during dev/test)
try {
  resetRateLimitCounts()
} catch (e) {
  // ignore
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

const getSingleRelationsRow = (relation: unknown) => (Array.isArray(relation) ? relation[0] : relation)

const csvEscape = (value: unknown) => {
  const text = String(value ?? '')
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

const DEFAULT_ADMIN_SETTINGS = {
  festival_status: 'pre',
  registrations_open: true,
  coordinator_assignments: {},
}

let adminSettingsTableMissing = false

const isMissingAdminSettingsTableError = (error: any) =>
  error?.code === 'PGRST205' || error?.message?.includes('admin_settings')

type EventCatalogItem = {
  name: string
  category: string
  mainCategory: string
  rules: string[]
}

const getEventCatalogPath = (): string | null => {
  const candidates = [
    path.resolve(process.cwd(), '../src/lib/eventsData.ts'),
    path.resolve(__dirname, '../../src/lib/eventsData.ts'),
    path.resolve(process.cwd(), 'src/lib/eventsData.ts'),
  ]

  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

const extractEventCatalog = (): EventCatalogItem[] => {
  const catalogPath = getEventCatalogPath()
  if (!catalogPath) {
    return []
  }

  const source = fs.readFileSync(catalogPath, 'utf8')
  const arrayStart = source.indexOf('export const allEvents: Event[] = [')
  const arrayEnd = source.lastIndexOf('];')

  if (arrayStart < 0 || arrayEnd < 0 || arrayEnd <= arrayStart) {
    throw new Error('Unable to parse event catalog from eventsData.ts')
  }

  const arrayText = source.slice(arrayStart, arrayEnd)
  const objectPattern = /\{\s*name:\s*"([^"]+)"[\s\S]*?category:\s*"([^"]+)"[\s\S]*?mainCategory:\s*"([^"]+)"[\s\S]*?rules:\s*\[([\s\S]*?)\]\s*\}/g
  const rulePattern = /"((?:[^"\\]|\\.)*)"/g

  const catalog: EventCatalogItem[] = []
  for (const match of arrayText.matchAll(objectPattern)) {
    const [, name, category, mainCategory, rulesRaw] = match
    const rules = Array.from(rulesRaw.matchAll(rulePattern), (ruleMatch) => ruleMatch[1].replace(/\\"/g, '"'))
    catalog.push({ name, category, mainCategory, rules })
  }

  if (catalog.length === 0) {
    throw new Error('No events were parsed from the event catalog')
  }

  return catalog
}

const seedMissingEvents = async () => {
  const catalog = extractEventCatalog()
  if (catalog.length === 0) {
    console.warn('Skipping event catalog seeding: src/lib/eventsData.ts is not available in this deployment')
    return
  }

  const { data: existingRows, error: existingErr } = await supabase.from('events').select('slug')
  if (existingErr) throw existingErr

  const existingSlugs = new Set((existingRows || []).map((row: any) => String(row.slug || '').toLowerCase()))
  const missingRowsBySlug = new Map<string, any>()

  for (const event of catalog) {
    const slug = slugify(event.name)
    if (existingSlugs.has(slug) || missingRowsBySlug.has(slug)) {
      continue
    }

    missingRowsBySlug.set(slug, {
      name: event.name,
      slug,
      description: '',
      category: event.category,
      main_category: event.mainCategory,
      registration_open: false,
      checkin_enabled: false,
      is_floated: false,
      is_live_tomorrow: false,
      status: 'upcoming',
      capacity: null,
      prize_info: null,
    })
  }

  const missingRows = Array.from(missingRowsBySlug.values())

  if (missingRows.length === 0) {
    console.log(`Event catalog already seeded (${catalog.length} events)`)
    return
  }

  const { error: insertErr } = await supabase.from('events').insert(missingRows as any)
  if (insertErr) throw insertErr

  console.log(`Seeded ${missingRows.length} missing events from the catalog (${catalog.length} total catalog events)`)
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() })
})

// Get events
app.get('/api/events', publicLimiter, cacheMiddleware(300), async (req, res) => {
  try {
    const category = req.query.category as string | undefined
    const date = req.query.date as string | undefined

    let query = supabase
      .from('events')
      .select('id,name,slug,description,category,main_category,venue,date,time_slot,end_time,registration_open,checkin_enabled,is_floated,is_live_tomorrow,status,capacity,prize_info,created_by,created_at,updated_at')

    if (category) query = query.eq('main_category', category)
    if (date) query = query.eq('date', date)

    const { data, error } = await query.order('date', { ascending: true }).order('time_slot', { ascending: true })
    if (error) throw error
    res.json({ data: data || [] })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

// Get houses
app.get('/api/houses', publicLimiter, cacheMiddleware(300), async (_req, res) => {
  try {
    const { data, error } = await supabase.from('houses').select('id,name,accent,points,created_at,updated_at').order('name', { ascending: true })
    if (error) throw error
    res.json({ data: data || [] })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.get('/api/announcements', publicLimiter, cacheMiddleware(120), async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('announcements')
      .select('id,title,body,pinned,starts_at,ends_at,created_at,updated_at')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error

    const now = new Date().toISOString()
    const activeAnnouncements = (data || []).filter((item: any) => {
      const startsAt = item.starts_at ? new Date(item.starts_at).toISOString() : ''
      const endsAt = item.ends_at ? new Date(item.ends_at).toISOString() : ''
      return (!startsAt || startsAt <= now) && (!endsAt || endsAt >= now)
    })

    res.json({ data: activeAnnouncements })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.get('/api/rules', publicLimiter, cacheMiddleware(120), async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('rules_and_regulations')
      .select('id,title,body,pinned,starts_at,ends_at,created_at,updated_at')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    const now = new Date().toISOString()
    const activeRules = (data || []).filter((item: any) => {
      const startsAt = item.starts_at ? new Date(item.starts_at).toISOString() : ''
      const endsAt = item.ends_at ? new Date(item.ends_at).toISOString() : ''
      return (!startsAt || startsAt <= now) && (!endsAt || endsAt >= now)
    })

    res.json({ data: activeRules })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

// Leaderboard
app.get('/api/leaderboard', publicLimiter, cacheMiddleware(60), async (_req, res) => {
  try {
    const { data, error } = await supabase.from('leaderboard').select('house_id,house_name,accent,base_points,bonus_points,total_points')
    if (error) throw error
    res.json({ data: data || [] })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

// Admin leaderboard
app.get('/api/wch1925/leaderboard', adminLimiter, cacheMiddleware(60), async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('house_id,house_name,accent,base_points,bonus_points,total_points')
      .order('total_points', { ascending: false })
    if (error) throw error
    res.json({ data: data || [] })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.get('/api/wch1925/events', adminLimiter, cacheMiddleware(60), async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('events')
      .select('id,name,slug,description,category,main_category,venue,date,time_slot,end_time,registration_open,checkin_enabled,is_floated,is_live_tomorrow,status,capacity,prize_info,created_by,created_at,updated_at')
      .order('date', { ascending: true })
      .order('time_slot', { ascending: true })
    if (error) throw error
    res.json({ data: data || [] })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.get('/api/wch1925/houses', adminLimiter, cacheMiddleware(60), async (_req, res) => {
  try {
    const { data, error } = await supabase.from('houses').select('id,name,accent,points,created_at,updated_at').order('name', { ascending: true })
    if (error) throw error
    res.json({ data: data || [] })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.post('/api/wch1925/auth', publicLimiter, async (req, res) => {
  try {
    const parsedBody = validateRequest(authBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const authUser = (req as any).authenticatedUser as AuthenticatedUser | undefined
    const email = String(parsedBody.data.email || authUser?.email || '').trim().toLowerCase()
    const role = parsedBody.data.role.trim()
    if (!email) {
      return res.status(400).json({ error: 'missing_email' })
    }
    if (!role) {
      return res.status(400).json({ error: 'missing_role' })
    }

    if (authUser?.email && email !== authUser.email) {
      return res.status(403).json({ error: 'email_mismatch' })
    }

    const { data, error } = await supabase
      .from('users')
      .select('id,name,email,admins!inner(role,assigned_event_id)')
      .ilike('email', email)
      .eq('admins.role', role)
      .limit(1)

    if (error) {
      throw error
    }

    const user = Array.isArray(data) ? data[0] : data
    if (!user || !user.admins) {
      return res.status(401).json({ error: 'not_admin' })
    }

    const admin = getSingleRelationsRow(user.admins as any)
    if (!admin || typeof admin !== 'object' || !('role' in admin)) {
      return res.status(401).json({ error: 'not_admin' })
    }

    if ((admin as any).role !== role) {
      return res.status(403).json({ error: 'role_mismatch' })
    }

    res.json({
      user: {
        id: user.id,
        name: user.name || user.email,
        email: user.email,
        role: (admin as any).role,
        assignedEvent: (admin as any).assigned_event_id || undefined,
      },
    })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

let inMemoryAdminSettings = {
  festival_status: 'pre',
  registrations_open: true,
  coordinator_assignments: {} as any,
}

app.get('/api/wch1925/settings', async (_req, res) => {
  try {
    if (adminSettingsTableMissing) {
      return res.json({
        settings: {
          festivalStatus: inMemoryAdminSettings.festival_status,
          registrationsOpen: inMemoryAdminSettings.registrations_open,
          coordinatorAssignments: inMemoryAdminSettings.coordinator_assignments,
        },
      })
    }

    const { data, error } = await supabase
      .from('admin_settings')
      .select('festival_status,registrations_open,coordinator_assignments')
      .limit(1)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return res.json({ settings: DEFAULT_ADMIN_SETTINGS })
      }
      if (isMissingAdminSettingsTableError(error)) {
        adminSettingsTableMissing = true
        return res.json({
          settings: {
            festivalStatus: inMemoryAdminSettings.festival_status,
            registrationsOpen: inMemoryAdminSettings.registrations_open,
            coordinatorAssignments: inMemoryAdminSettings.coordinator_assignments,
          },
        })
      }
      throw error
    }

    res.json({
      settings: {
        festivalStatus: data?.festival_status ?? DEFAULT_ADMIN_SETTINGS.festival_status,
        registrationsOpen: data?.registrations_open ?? DEFAULT_ADMIN_SETTINGS.registrations_open,
        coordinatorAssignments: data?.coordinator_assignments || DEFAULT_ADMIN_SETTINGS.coordinator_assignments,
      },
    })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.post('/api/wch1925/settings', adminLimiter, async (req, res) => {
  try {
    const parsedBody = validateRequest(adminSettingsBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const { festivalStatus, registrationsOpen, coordinatorAssignments } = parsedBody.data

    const payload = {
      id: 'singleton',
      festival_status: festivalStatus,
      registrations_open: registrationsOpen,
      coordinator_assignments: coordinatorAssignments || {},
    }

    if (adminSettingsTableMissing) {
      inMemoryAdminSettings = {
        festival_status: festivalStatus,
        registrations_open: registrationsOpen,
        coordinator_assignments: coordinatorAssignments || {},
      }
      return res.json({
        settings: {
          festivalStatus: inMemoryAdminSettings.festival_status,
          registrationsOpen: inMemoryAdminSettings.registrations_open,
          coordinatorAssignments: inMemoryAdminSettings.coordinator_assignments,
        },
      })
    }

    const { data, error } = await supabase
      .from('admin_settings')
      .upsert(payload, { onConflict: 'id' })
      .select('festival_status,registrations_open,coordinator_assignments')
      .single()

    if (error) {
      if (isMissingAdminSettingsTableError(error)) {
        adminSettingsTableMissing = true
        inMemoryAdminSettings = {
          festival_status: festivalStatus,
          registrations_open: registrationsOpen,
          coordinator_assignments: coordinatorAssignments || {},
        }
        return res.json({
          settings: {
            festivalStatus: inMemoryAdminSettings.festival_status,
            registrationsOpen: inMemoryAdminSettings.registrations_open,
            coordinatorAssignments: inMemoryAdminSettings.coordinator_assignments,
          },
        })
      }
      throw error
    }

    res.json({
      settings: {
        festivalStatus: data?.festival_status,
        registrationsOpen: data?.registrations_open,
        coordinatorAssignments: data?.coordinator_assignments || {},
      },
    })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.post('/api/wch1925/leaderboard/adjust', adminLimiter, async (req, res) => {
  try {
    const parsedBody = validateRequest(leaderboardAdjustBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const { house_id, points, reason } = parsedBody.data

    const { data: house, error: houseErr } = await supabase.from('houses').select('id').eq('id', house_id).single()
    if (houseErr) throw houseErr
    if (!house) {
      return res.status(404).json({ error: 'house_not_found' })
    }

    const { data, error } = await supabase
      .from('points_history')
      .insert({ house_id, points, reason })
      .select('id,house_id,points,reason,issued_by,created_at')
      .single()

    if (error) throw error

    const { data: leaderboardRow, error: leaderboardErr } = await supabase
      .from('leaderboard')
      .select('house_id,house_name,accent,base_points,bonus_points,total_points')
      .eq('house_id', house_id)
      .single()

    if (leaderboardErr && leaderboardErr.code !== 'PGRST116') throw leaderboardErr

    res.status(201).json({ data, leaderboard: leaderboardRow || null })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

// Admin dashboard summary
app.get('/api/wch1925/dashboard-summary', async (_req, res) => {
  try {
    const nowDate = new Date().toISOString().slice(0, 10)

    const [usersCountRes, eventsCountRes, registrationsCountRes, attendanceCountRes, upcomingRes, recentRes] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('events').select('id', { count: 'exact', head: true }),
      supabase.from('registrations').select('id', { count: 'exact', head: true }),
      supabase.from('checkins').select('id', { count: 'exact', head: true }),
      supabase.from('events').select('id,name,date,time_slot,venue').gte('date', nowDate).order('date', { ascending: true }).limit(8),
      supabase
        .from('user_dashboard_registrations')
        .select('registration_id,registered_at,status,user_name,email,event_name,date,time_slot')
        .order('registered_at', { ascending: false })
        .limit(10),
    ])

    if (usersCountRes.error) throw usersCountRes.error
    if (eventsCountRes.error) throw eventsCountRes.error
    if (registrationsCountRes.error) throw registrationsCountRes.error
    if (attendanceCountRes.error) throw attendanceCountRes.error
    if (upcomingRes.error) throw upcomingRes.error
    if (recentRes.error) throw recentRes.error

    res.json({
      totals: {
        users: usersCountRes.count || 0,
        events: eventsCountRes.count || 0,
        registrations: registrationsCountRes.count || 0,
        attendance: attendanceCountRes.count || 0,
      },
      upcomingEvents: upcomingRes.data || [],
      recentRegistrations: (recentRes.data || []).map((row: any) => ({
        id: row.registration_id,
        registration_date: row.registered_at,
        registration_status: row.status,
        participant_name: row.user_name || '',
        user_email: row.email || '',
        event_name: row.event_name || '',
        event_date: row.date || '',
        event_time: row.time_slot || '',
      })),
    })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

// User management list with search/filter
app.get('/api/wch1925/users', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase()
    const house = String(req.query.house || '').trim()

    let query = supabase.from('users').select('id,name,email,mobile_number,register_number,house,created_at').order('created_at', { ascending: false })
    if (house) query = query.eq('house', house)

    const { data, error } = await query.limit(500)
    if (error) throw error

    let rows = data || []
    if (search) {
      rows = rows.filter(
        (row: any) =>
          String(row.name || '').toLowerCase().includes(search) ||
          String(row.email || '').toLowerCase().includes(search) ||
          String(row.register_number || '').toLowerCase().includes(search),
      )
    }

    const users = rows.map((row: any) => ({
      user_id: row.id,
      name: row.name,
      email: row.email,
      mobile_number: row.mobile_number || '',
      house: row.house || '',
      register_number: row.register_number || '',
      created_at: row.created_at,
    }))

    res.json({ data: users })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.post('/api/wch1925/users', adminLimiter, async (req, res) => {
  try {
    const parsedBody = validateRequest(userCreateBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const { name, email, mobile_number, register_number, house, picture_url } = parsedBody.data

    const { data, error } = await supabase
      .from('users')
      .upsert(
        {
          name,
          email: String(email).toLowerCase(),
          mobile_number: mobile_number === undefined || mobile_number === null ? null : String(mobile_number).trim(),
          register_number: register_number ? String(register_number).trim().toUpperCase() : null,
          house: house ? String(house).trim() : null,
          picture_url: picture_url || null,
        },
        { onConflict: 'email' },
      )
      .select('id,name,email,mobile_number,register_number,house,created_at')
      .single()

    if (error) throw error

    res.status(201).json({
      user: {
        user_id: data.id,
        name: data.name || '',
        email: data.email || '',
        house: data.house || '',
        register_number: data.register_number || '',
        created_at: data.created_at,
      },
    })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.get('/api/wch1925/announcements', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('announcements')
      .select('id,title,body,pinned,starts_at,ends_at,created_by,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error
    res.json({ data: data || [] })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.post('/api/wch1925/announcements', adminLimiter, async (req, res) => {
  try {
    const parsedBody = validateRequest(announcementBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const { title, body, pinned, starts_at, ends_at } = parsedBody.data

    const { data, error } = await supabase
      .from('announcements')
      .insert({
        title: String(title).trim(),
        body,
        pinned,
        starts_at,
        ends_at,
      })
      .select('id,title,body,pinned,starts_at,ends_at,created_at,updated_at')
      .single()

    if (error) throw error
    res.status(201).json({ data })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

  // Media upload endpoint removed per project requirements (no user media uploads).
  // If you need server-side media management in future, reintroduce a secure
  // admin-only endpoint with strict validation and storage rules.

app.get('/api/wch1925/rules', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('rules_and_regulations')
      .select('id,title,body,pinned,starts_at,ends_at,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error
    res.json({ data: data || [] })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.post('/api/wch1925/rules', adminLimiter, async (req, res) => {
  try {
    const parsedBody = validateRequest(ruleBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const { title, body, pinned, starts_at, ends_at } = parsedBody.data

    const { data, error } = await supabase
      .from('rules_and_regulations')
      .insert({
        title: String(title).trim(),
        body,
        pinned,
        starts_at,
        ends_at,
      })
      .select('id,title,body,pinned,starts_at,ends_at,created_at,updated_at')
      .single()

    if (error) throw error
    res.status(201).json({ data })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.put('/api/wch1925/rules/:id', adminLimiter, async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.id, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const parsedBody = validateRequest(ruleBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const { id } = parsedParams.data
    const { title, body, pinned, starts_at, ends_at } = parsedBody.data

    const { data, error } = await supabase
      .from('rules_and_regulations')
      .update({
        title: String(title).trim(),
        body,
        pinned,
        starts_at,
        ends_at,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id,title,body,pinned,starts_at,ends_at,created_at,updated_at')
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return res.status(404).json({ error: 'rule_not_found' })
    }

    res.json({ data })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.delete('/api/wch1925/rules/:id', adminLimiter, async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.id, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const { id } = parsedParams.data
    const { error } = await supabase.from('rules_and_regulations').delete().eq('id', id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.put('/api/wch1925/announcements/:id', adminLimiter, async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.id, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const parsedBody = validateRequest(announcementBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const { id } = parsedParams.data
    const { title, body, pinned, starts_at, ends_at } = parsedBody.data

    const { data, error } = await supabase
      .from('announcements')
      .update({
        title: String(title).trim(),
        body,
        pinned,
        starts_at,
        ends_at,
      })
      .eq('id', id)
      .select('id,title,body,pinned,starts_at,ends_at,created_by,created_at,updated_at')
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return res.status(404).json({ error: 'announcement_not_found' })
    }

    res.json({ data })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.delete('/api/wch1925/announcements/:id', adminLimiter, async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.id, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const { id } = parsedParams.data
    const { error } = await supabase.from('announcements').delete().eq('id', id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.get('/api/wch1925/users/:id', async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.id, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const { id } = parsedParams.data

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id,name,email,mobile_number,register_number,house,created_at')
      .eq('id', id)
      .single()

    if (userErr) {
      if (userErr.code === 'PGRST116') return res.status(404).json({ error: 'user_not_found' })
      throw userErr
    }
    const { data: registrations, error: regErr } = await supabase
      .from('registrations')
      .select('id,status,registered_at,events(name,date,time_slot)')
      .eq('user_id', id)
      .order('registered_at', { ascending: false })

    if (regErr) throw regErr

    res.json({
      user: {
        user_id: user.id,
        name: user.name,
        email: user.email,
        mobile_number: user.mobile_number || '',
        house: user.house || '',
        register_number: user.register_number || '',
        created_at: user.created_at,
      },
      registrations: registrations || [],
    })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.delete('/api/wch1925/users/:id', adminLimiter, async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.id, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const { id } = parsedParams.data
    const { data: registrations, error: regErr } = await supabase.from('registrations').select('id').eq('user_id', id)
    if (regErr) throw regErr

    const registrationIds = (registrations || []).map((row: any) => row.id)
    if (registrationIds.length > 0) {
      const { error: checkinErr } = await supabase.from('checkins').delete().in('registration_id', registrationIds)
      if (checkinErr) throw checkinErr

      const { error: deleteRegsErr } = await supabase.from('registrations').delete().eq('user_id', id)
      if (deleteRegsErr) throw deleteRegsErr
    }

    const { error } = await supabase.from('users').delete().eq('id', id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.put('/api/wch1925/users/:id', adminLimiter, async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.id, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const parsedBody = validateRequest(userCreateBodySchema.partial(), req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const { id } = parsedParams.data
    const { name, email, mobile_number, register_number, house, picture_url } = parsedBody.data

    const payload: any = {}
    if (name) payload.name = name
    if (email) payload.email = String(email).toLowerCase()
    if (mobile_number !== undefined) payload.mobile_number = mobile_number
    if (register_number) payload.register_number = register_number
    if (house) payload.house = house
    if (picture_url) payload.picture_url = picture_url

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'No update data provided' })
    }

    const { data, error } = await supabase
      .from('users')
      .update(payload)
      .eq('id', id)
      .select('id,name,email,mobile_number,register_number,house,picture_url,created_at,updated_at')
      .single()

    if (error) throw error
    res.json({ user: data })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})


// Registration management list + search/filter
app.get('/api/wch1925/registrations', async (req, res) => {
  try {
    const parsedQuery = validateRequest(registrationsListQuerySchema, req.query)
    if (!parsedQuery.ok) {
      return respondValidationError(res, parsedQuery.error)
    }

    const search = String(parsedQuery.data.search || '').trim().toLowerCase()
    const eventName = String(parsedQuery.data.event || '').trim().toLowerCase()
    const date = String(parsedQuery.data.date || '').trim()

    const { data, error } = await supabase
      .from('registrations')
      .select('id,status,registered_at,users(id,name,email,house,register_number),events(id,name,date,time_slot)')
      .order('registered_at', { ascending: false })
      .limit(1000)

        if (error) throw error
    const { data: checkins, error: checkinsErr } = await supabase.from('checkins').select('registration_id')
    if (checkinsErr) throw checkinsErr
    const checkedInSet = new Set((checkins || []).map((item: any) => item.registration_id))

    let rows = (data || []).map((row: any) => ({
      registration_id: row.id,
      user_id: row.users?.id || '',
      participant_name: row.users?.name || '',
      email: row.users?.email || '',
      reg_no: row.users?.register_number || '',
      house: row.users?.house || '',
      event_id: row.events?.id || '',
      event_name: row.events?.name || '',
      event_date: row.events?.date || '',
      registration_date: row.registered_at,
      registration_status: row.status,
      checked_in: checkedInSet.has(row.id),
    }))

    if (eventName) rows = rows.filter((row) => row.event_name.toLowerCase().includes(eventName))
    if (date) rows = rows.filter((row) => row.event_date === date)
    if (search) {
      rows = rows.filter(
        (row) =>
          row.participant_name.toLowerCase().includes(search) ||
          row.email.toLowerCase().includes(search) ||
          row.event_name.toLowerCase().includes(search),
      )
    }

    res.json({ data: rows })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.post('/api/wch1925/registrations', adminLimiter, async (req, res) => {
  try {
    const parsedBody = validateRequest(adminRegistrationCreateBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const { email, name, register_number, house, event_id, event_name } = parsedBody.data

    let resolvedEventId = event_id as string | undefined
    if (!resolvedEventId && event_name) {
      const { data: eventRows, error: eventErr } = await supabase
        .from('events')
        .select('id')
        .ilike('name', String(event_name).trim())
        .limit(1)
      if (eventErr) throw eventErr
      const eventRow = Array.isArray(eventRows) ? eventRows[0] : eventRows
      if (!eventRow?.id) {
        return res.status(404).json({ error: 'event_not_found' })
      }
      resolvedEventId = eventRow.id
    }
    const { data: rpcData, error: rpcErr } = await supabase.rpc('create_registration', {
      p_email: String(email).toLowerCase(),
      p_name: name,
      p_register_number: register_number,
      p_house: house,
      p_event_id: resolvedEventId,
    })

    if (rpcErr) {
      if (rpcErr.message?.includes('already_registered')) {
        return res.status(409).json({ error: 'already_registered' })
      }
      if (rpcErr.message?.includes('event_not_found')) {
        return res.status(404).json({ error: 'event_not_found' })
      }
      throw rpcErr
    }

    const registration = Array.isArray(rpcData) ? rpcData[0] : rpcData
    if (!registration) {
      return res.status(500).json({ error: 'registration_failed' })
    }

    const { data: rowData, error: rowErr } = await supabase
      .from('registrations')
      .select('id,status,registered_at,users(id,name,email,house,register_number),events(id,name,date,time_slot)')
      .eq('id', registration.id)
      .single()

    if (rowErr) throw rowErr

    const users = getSingleRelationsRow(rowData.users) as Record<string, any> | undefined
    const events = getSingleRelationsRow(rowData.events) as Record<string, any> | undefined

    return res.status(201).json({
      data: {
        registration_id: rowData.id,
        user_id: users?.id || '',
        participant_name: users?.name || '',
        email: users?.email || '',
        reg_no: users?.register_number || '',
        house: users?.house || '',
        event_id: events?.id || '',
        event_name: events?.name || '',
        event_date: events?.date || '',
        registration_date: rowData.registered_at,
        registration_status: rowData.status,
        checked_in: false,
      },
    })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.put('/api/wch1925/registrations/:id', adminLimiter, async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.id, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const parsedBody = validateRequest(registrationUpdateBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const { id } = parsedParams.data
    const { status, event_id, event_name, email, name, register_number, house } = parsedBody.data

    const { data: registrationData, error: registrationErr } = await supabase
      .from('registrations')
      .select('id,user_id,event_id')
      .eq('id', id)
      .single()

    if (registrationErr) {
      if (registrationErr.code === 'PGRST116') {
        return res.status(404).json({ error: 'registration_not_found' })
      }
      throw registrationErr
    }

    let resolvedEventId = event_id as string | undefined
    if (!resolvedEventId && event_name) {
      const { data: eventRows, error: eventErr } = await supabase
        .from('events')
        .select('id')
        .ilike('name', String(event_name).trim())
        .limit(1)
      if (eventErr) throw eventErr
      const eventRow = Array.isArray(eventRows) ? eventRows[0] : eventRows
      if (!eventRow?.id) {
        return res.status(404).json({ error: 'event_not_found' })
      }
      resolvedEventId = eventRow.id
    }

    if (email || name || register_number || house) {
      const userPayload: any = {}
      if (email) userPayload.email = String(email).toLowerCase()
      if (name) userPayload.name = name
      if (register_number) userPayload.register_number = register_number
      if (house) userPayload.house = house

      if (Object.keys(userPayload).length > 0) {
        const { error: userErr } = await supabase
          .from('users')
          .update(userPayload)
          .eq('id', registrationData.user_id)
        if (userErr) throw userErr
      }
    }

    const payload: any = {}
    if (typeof status === 'string') payload.status = status
    if (resolvedEventId) payload.event_id = resolvedEventId

    if (Object.keys(payload).length > 0) {
      const { error: updateErr } = await supabase.from('registrations').update(payload).eq('id', id)
      if (updateErr) throw updateErr
    }

    const { data: rowData, error: rowErr } = await supabase
      .from('registrations')
      .select('id,status,registered_at,users(id,name,email,house,register_number),events(id,name,date,time_slot)')
      .eq('id', id)
      .single()

    if (rowErr) throw rowErr

    const users = getSingleRelationsRow(rowData.users) as Record<string, any> | undefined
    const events = getSingleRelationsRow(rowData.events) as Record<string, any> | undefined

    const { data: checkinData, error: checkinErr } = await supabase
      .from('checkins')
      .select('registration_id')
      .eq('registration_id', id)
      .limit(1)

    if (checkinErr) throw checkinErr

    return res.json({
      data: {
        registration_id: rowData.id,
        user_id: users?.id || '',
        participant_name: users?.name || '',
        email: users?.email || '',
        reg_no: users?.register_number || '',
        house: users?.house || '',
        event_id: events?.id || '',
        event_name: events?.name || '',
        event_date: events?.date || '',
        registration_date: rowData.registered_at,
        registration_status: rowData.status,
        checked_in: (checkinData || []).length > 0,
      },
    })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.delete('/api/wch1925/registrations/:id', adminLimiter, async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.id, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const { id } = parsedParams.data
    const { error: checkinErr } = await supabase.from('checkins').delete().eq('registration_id', id)
    if (checkinErr) throw checkinErr

    const { error } = await supabase.from('registrations').delete().eq('id', id)
    if (error) throw error

    res.json({ ok: true })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.get('/api/wch1925/registrations/export.csv', async (req, res) => {
  try {
    const parsedQuery = validateRequest(exportQuerySchema, req.query)
    if (!parsedQuery.ok) {
      return respondValidationError(res, parsedQuery.error)
    }

    const search = String(parsedQuery.data.search || '')
    const eventName = String(parsedQuery.data.event || '')
    const date = String(parsedQuery.data.date || '')
    // use query params directly (removed internal localhost URL construction)

    const { data, error } = await supabase
      .from('registrations')
      .select('id,status,registered_at,users(id,name,email,house,register_number),events(id,name,date,time_slot)')
      .order('registered_at', { ascending: false })
      .limit(1000)

    if (error) throw error

    const { data: checkins, error: checkinsErr } = await supabase.from('checkins').select('registration_id')
    if (checkinsErr) throw checkinsErr
    const checkedInSet = new Set((checkins || []).map((item: any) => item.registration_id))

    let rows = (data || []).map((row: any) => ({
      registration_id: row.id,
      user_id: row.users?.id || '',
      participant_name: row.users?.name || '',
      email: row.users?.email || '',
      reg_no: row.users?.register_number || '',
      house: row.users?.house || '',
      event_id: row.events?.id || '',
      event_name: row.events?.name || '',
      event_date: row.events?.date || '',
      registration_date: row.registered_at,
      registration_status: row.status,
      checked_in: checkedInSet.has(row.id),
    }))

    const searchLower = String(parsedQuery.data.search || '').toLowerCase()
    const eventLower = String(parsedQuery.data.event || '').toLowerCase()
    const dateValue = String(parsedQuery.data.date || '')

    if (eventLower) rows = rows.filter((row) => row.event_name.toLowerCase().includes(eventLower))
    if (dateValue) rows = rows.filter((row) => row.event_date === dateValue)
    if (searchLower) {
      rows = rows.filter(
        (row) =>
          row.participant_name.toLowerCase().includes(searchLower) ||
          row.email.toLowerCase().includes(searchLower) ||
          row.event_name.toLowerCase().includes(searchLower),
      )
    }

    const header = [
      'Registration ID',
      'User ID',
      'Participant Name',
      'Email',
      'Register Number',
      'House',
      'Event Name',
      'Event Date',
      'Registration Date',
      'Registration Status',
      'Checked In',
    ]

    const lines = [
      header.join(','),
      ...rows.map((row) =>
        [
          csvEscape(row.registration_id),
          csvEscape(row.user_id),
          csvEscape(row.participant_name),
          csvEscape(row.email),
          csvEscape(row.reg_no || ''),
          csvEscape(row.house),
          csvEscape(row.event_name),
          csvEscape(row.event_date),
          csvEscape(row.registration_date),
          csvEscape(row.registration_status),
          csvEscape(row.checked_in ? 'yes' : 'no'),
        ].join(','),
      ),
    ]

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="registrations.csv"')
    res.send(lines.join('\n'))
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

// Admin events CRUD
app.post('/api/wch1925/events', adminLimiter, async (req, res) => {
  try {
    const parsedBody = validateRequest(eventCreateBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const {
      name,
      description,
      category,
      main_category,
      date,
      time_slot,
      end_time,
      venue,
      capacity,
      is_live_tomorrow,
    } = parsedBody.data

    const { data, error } = await supabase
      .from('events')
      .insert({
        name,
        slug: slugify(name),
        description,
        category,
        main_category: main_category || category,
        date,
        time_slot,
        end_time,
        venue,
        capacity,
        is_live_tomorrow: is_live_tomorrow ?? false,
      } as any)
      .select('id,name,slug,description,category,main_category,venue,date,time_slot,end_time,registration_open,checkin_enabled,is_floated,is_live_tomorrow,status,capacity,prize_info,created_by,created_at,updated_at')
      .single()

    if (error) throw error
    res.status(201).json({ data })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.put('/api/wch1925/events/:id', adminLimiter, async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.id, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const parsedBody = validateRequest(eventUpdateBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    if (Object.keys(parsedBody.data).length === 0) {
      return res.status(400).json({ error: 'at_least_one_field_required' })
    }

    const { id } = parsedParams.data
    const {
      name,
      description,
      category,
      main_category,
      date,
      time_slot,
      end_time,
      venue,
      capacity,
      registration_open,
      checkin_enabled,
      is_floated,
      is_live_tomorrow,
      status,
    } = parsedBody.data

    const payload: any = {
      name,
      description,
      category,
      main_category,
      date,
      time_slot,
      end_time,
      venue,
      capacity,
      registration_open,
      checkin_enabled,
      is_floated,
      is_live_tomorrow,
      status,
    }

    if (name) payload.slug = slugify(name)

    const { data, error } = await supabase
      .from('events')
      .update(payload)
      .eq('id', id)
      .select('id,name,slug,description,category,main_category,venue,date,time_slot,end_time,registration_open,checkin_enabled,is_floated,is_live_tomorrow,status,capacity,prize_info,created_by,created_at,updated_at')
      .single()
    if (error) throw error
    res.json({ data })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.delete('/api/wch1925/events/:id', adminLimiter, async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.id, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const { id } = parsedParams.data
    const { error } = await supabase.from('events').delete().eq('id', id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.post('/api/wch1925/events/:id/close-registration', adminLimiter, async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.id, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const { id } = parsedParams.data
    const { data, error } = await supabase
      .from('events')
      .update({ registration_open: false })
      .eq('id', id)
      .select('id,name,registration_open')
      .single()
    if (error) throw error
    res.json({ data })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

// Attendance/check-in
app.post('/api/wch1925/checkin', adminLimiter, async (req, res) => {
  try {
    const parsedBody = validateRequest(checkinBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const { registration_id, device_info } = parsedBody.data

    const { data: existingCheckin, error: existingErr } = await supabase
      .from('checkins')
      .select('id')
      .eq('registration_id', registration_id)
      .limit(1)

    if (existingErr) throw existingErr
    if (existingCheckin && existingCheckin.length > 0) {
      return res.status(409).json({ error: 'already_checked_in' })
    }

    const { data, error } = await supabase
      .from('checkins')
      .insert({ registration_id, device_info })
      .select('id,registration_id,checked_in_by,checked_in_at,device_info')
      .single()

    if (error) throw error
    res.status(201).json({ data })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.delete('/api/wch1925/checkin/:registration_id', adminLimiter, async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.registrationId, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const { registration_id } = parsedParams.data
    const { error } = await supabase.from('checkins').delete().eq('registration_id', registration_id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

app.get('/api/wch1925/attendance-report', async (_req, res) => {
  try {
    const { data: eventRegs, error: regErr } = await supabase
      .from('user_dashboard_registrations')
      .select('registration_id,event_id,event_name,date')

    if (regErr) throw regErr

    const { data: checkins, error: checkinErr } = await supabase.from('checkins').select('registration_id')
    if (checkinErr) throw checkinErr

    const checkedInSet = new Set((checkins || []).map((item: any) => item.registration_id))
    const eventMap = new Map<string, { event_name: string; event_date: string; total: number; checked_in: number }>()

    for (const row of eventRegs || []) {
      const key = row.event_id
      const current = eventMap.get(key) || {
        event_name: row.event_name || '',
        event_date: row.date || '',
        total: 0,
        checked_in: 0,
      }
      current.total += 1
      if (checkedInSet.has(row.registration_id)) current.checked_in += 1
      eventMap.set(key, current)
    }

    const rows = Array.from(eventMap.values()).map((item) => ({
      ...item,
      attendance_rate: item.total > 0 ? Number(((item.checked_in / item.total) * 100).toFixed(2)) : 0,
    }))

    res.json({ data: rows })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

// Upsert user profile
app.post('/api/users/upsert', authLimiter, requireSignedInUser, async (req, res) => {
  try {
    const parsedBody = validateRequest(userUpsertBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const { email, name, mobile_number, register_number, house, picture_url } = parsedBody.data
    const normalizedMobileNumber = mobile_number === undefined || mobile_number === null ? undefined : String(mobile_number).trim()

    const { data, error } = await supabase
      .from('users')
      .upsert(
        {
          email: String(email).toLowerCase(),
          name,
          mobile_number: normalizedMobileNumber,
          register_number,
          house,
          picture_url,
        },
        { onConflict: 'email' },
      )
      .select('id,name,email,mobile_number,register_number,house,picture_url,created_at,updated_at')
      .limit(1)

    if (error) throw error
    res.json({ user: Array.isArray(data) ? data[0] : data })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

// Create registration: upsert user then insert registration
app.post('/api/registrations', registrationLimiter, requireSignedInUser, requireTurnstile, async (req, res) => {
  try {
    const parsedBody = validateRequest(publicRegistrationBodySchema, req.body)
    if (!parsedBody.ok) {
      return respondValidationError(res, parsedBody.error)
    }

    const { email, name, register_number, house, event_id, event_name } = parsedBody.data

    let resolvedEventId = event_id as string | undefined

    if (!resolvedEventId && event_name) {
      const { data: eventRows, error: eventErr } = await supabase
        .from('events')
        .select('id')
        .ilike('name', String(event_name).trim())
        .limit(1)
      if (eventErr) throw eventErr
      const eventRow = Array.isArray(eventRows) ? eventRows[0] : eventRows
      if (!eventRow?.id) {
        return res.status(404).json({ error: 'event_not_found' })
      }
      resolvedEventId = eventRow.id
    }

    // Use service-role RPC that accepts user id to avoid client-side RPC bypass
    const userId = (req as any).authenticatedUser?.id
    const { data: rpcData, error: rpcErr } = await supabase.rpc('create_registration_safe', {
      p_user_id: userId,
      p_event_id: resolvedEventId,
    })

    if (rpcErr) {
      if (rpcErr.message?.includes('already_registered')) {
        return res.status(409).json({ error: 'already_registered' })
      }
      if (rpcErr.message?.includes('event_not_found')) {
        return res.status(404).json({ error: 'event_not_found' })
      }
      throw rpcErr
    }

    const registration = Array.isArray(rpcData) ? rpcData[0] : rpcData
    if (!registration) {
      return res.status(500).json({ error: 'registration_failed' })
    }

    res.status(201).json(registration)
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

// Get user's registrations
app.get('/api/users/:email/registrations', publicLimiter, requireSignedInUser, cacheMiddleware(60), async (req, res) => {
  try {
    const parsedParams = validateRequest(paramsSchemas.email, req.params)
    if (!parsedParams.ok) {
      return respondValidationError(res, parsedParams.error)
    }

    const email = parsedParams.data.email.toLowerCase()
    const { data: userData, error: userErr } = await supabase.from('users').select('id,name,email,mobile_number,house,register_number,picture_url').eq('email', email).limit(1)
    if (userErr) throw userErr
    const user = Array.isArray(userData) ? userData[0] : userData
    if (!user) return res.json({ user: null, registrations: [] })

    const { data: regs, error: regErr } = await supabase
      .from('registrations')
      .select('id, event_id, ticket_code, status, registered_at, events(name, category, date, time_slot, end_time, venue)')
      .eq('user_id', user.id)
      .order('registered_at', { ascending: false })

    if (regErr) throw regErr

    const regIds = (regs || []).map((r: any) => r.id)
    let checkedInSet = new Set<string>()
    if (regIds.length > 0) {
      const { data: checkins } = await supabase.from('checkins').select('registration_id').in('registration_id', regIds)
      checkedInSet = new Set((checkins || []).map((c: any) => c.registration_id))
    }

    const registrations = (regs || []).map((row: any) => ({
      registration_id: row.id,
      event_id: row.event_id,
      event_name: row.events?.name || '',
      category: row.events?.category || '',
      date: row.events?.date || '',
      time_slot: row.events?.time_slot || '',
      end_time: row.events?.end_time || '',
      venue: row.events?.venue || '',
      ticket_code: row.ticket_code,
      status: row.status,
      registered_at: row.registered_at,
      checked_in: checkedInSet.has(row.id),
    }))

    res.json({
      user,
      registrations,
    })
  } catch (err: any) {
    console.error(err)
    res.status(500).json({ error: err.message || 'unknown' })
  }
})

const bootstrap = async () => {
  try {
    await seedMissingEvents()
  } catch (err: any) {
    console.error('Failed to seed event catalog:', err?.message || err)
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`API server listening on http://0.0.0.0:${PORT}`)
  })
}

bootstrap()

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' })
})

Sentry.setupExpressErrorHandler(app)

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const error = err as Error & { statusCode?: number; code?: string; type?: string }
  const statusCode = error.statusCode || (error.type === 'entity.too.large' ? 413 : 500)
  const code = error.code || (error.type === 'entity.too.large' ? 'payload_too_large' : 'internal_server_error')

  if (statusCode >= 500) {
    Sentry.captureException(err)
  }

  console.error({
    requestId: (req as any).requestId,
    method: req.method,
    path: req.path,
    statusCode,
    code,
    message: error?.message,
  })

  if (res.headersSent) {
    return next(err)
  }

  res.status(statusCode).json({ error: code, requestId: (req as any).requestId })
})
