import { z } from 'zod'

const nonEmptyString = z.string().trim().min(1)
const optionalText = z.union([z.string(), z.null(), z.undefined()]).transform((value) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
})

export const authBodySchema = z.object({
  email: z.string().email().optional(),
  role: nonEmptyString,
})

export const adminSettingsBodySchema = z.object({
  festivalStatus: z.enum(['pre', 'live', 'post']),
  registrationsOpen: z.boolean(),
  coordinatorAssignments: z.record(z.string(), z.unknown()).optional().default({}),
})

export const leaderboardAdjustBodySchema = z.object({
  house_id: z.string().uuid(),
  points: z.coerce.number().int().min(-100000).max(100000),
  reason: optionalText,
})

export const userCreateBodySchema = z.object({
  name: nonEmptyString.max(120),
  email: z.string().email(),
  mobile_number: z.union([z.string(), z.number()]).optional().nullable(),
  register_number: z.union([z.string(), z.null(), z.undefined()]).optional(),
  house: z.union([z.string(), z.null(), z.undefined()]).optional(),
  picture_url: z.union([z.string(), z.null(), z.undefined()]).optional(),
})

export const announcementBodySchema = z.object({
  title: nonEmptyString.max(200),
  body: optionalText,
  pinned: z.boolean().optional().default(false),
  starts_at: optionalText,
  ends_at: optionalText,
})

export const ruleBodySchema = announcementBodySchema

export const eventCreateBodySchema = z.object({
  name: nonEmptyString.max(160),
  description: optionalText,
  category: nonEmptyString.max(120),
  main_category: z.union([z.string(), z.null(), z.undefined()]).optional(),
  date: nonEmptyString.max(32),
  time_slot: nonEmptyString.max(64),
  end_time: optionalText,
  venue: nonEmptyString.max(120),
  capacity: z.coerce.number().int().min(0).optional().nullable(),
  is_live_tomorrow: z.boolean().optional().default(false),
})

export const eventUpdateBodySchema = eventCreateBodySchema.extend({
  registration_open: z.boolean().optional(),
  checkin_enabled: z.boolean().optional(),
  is_floated: z.boolean().optional(),
  status: z.union([z.string(), z.null(), z.undefined()]).optional(),
}).partial()

export const checkinBodySchema = z.object({
  registration_id: z.string().uuid(),
  device_info: optionalText,
})

export const userUpsertBodySchema = z.object({
  email: z.string().email(),
  name: nonEmptyString.max(120),
  mobile_number: z.union([z.string(), z.number()]).optional().nullable(),
  register_number: z.union([z.string(), z.null(), z.undefined()]).optional(),
  house: z.union([z.string(), z.null(), z.undefined()]).optional(),
  picture_url: z.union([z.string(), z.null(), z.undefined()]).optional(),
})

export const publicRegistrationBodySchema = z.object({
  email: z.string().email(),
  name: nonEmptyString.max(120),
  register_number: z.union([z.string(), z.null(), z.undefined()]).optional(),
  house: z.union([z.string(), z.null(), z.undefined()]).optional(),
  event_id: z.string().uuid().optional(),
  event_name: z.union([z.string(), z.null(), z.undefined()]).optional(),
  // removed Turnstile token
})

export const adminRegistrationCreateBodySchema = z.object({
  email: z.string().email(),
  name: nonEmptyString.max(120),
  register_number: z.union([z.string(), z.null(), z.undefined()]).optional(),
  house: z.union([z.string(), z.null(), z.undefined()]).optional(),
  event_id: z.string().uuid().optional(),
  event_name: z.union([z.string(), z.null(), z.undefined()]).optional(),
})

export const registrationUpdateBodySchema = z.object({
  status: z.union([z.string(), z.null(), z.undefined()]).optional(),
  event_id: z.string().uuid().optional(),
  event_name: z.union([z.string(), z.null(), z.undefined()]).optional(),
  email: z.string().email().optional(),
  name: nonEmptyString.max(120).optional(),
  register_number: z.union([z.string(), z.null(), z.undefined()]).optional(),
  house: z.union([z.string(), z.null(), z.undefined()]).optional(),
})

export const paramsSchemas = {
  id: z.object({ id: z.string().uuid() }),
  registrationId: z.object({ registration_id: z.string().uuid() }),
  email: z.object({ email: z.string().email() }),
}

export const registrationsListQuerySchema = z.object({
  search: z.string().trim().max(100).optional().default(''),
  event: z.string().trim().max(120).optional().default(''),
  date: z.string().trim().max(32).optional().default(''),
})

export const exportQuerySchema = registrationsListQuerySchema

export const validateRequest = <T extends z.ZodTypeAny>(schema: T, input: unknown) => {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.flatten(),
    }
  }

  return {
    ok: true as const,
    data: parsed.data as z.infer<T>,
  }
}
