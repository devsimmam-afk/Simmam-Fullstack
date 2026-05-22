import adminSupabase from '@/lib/adminSupabase'

export const getAdminApiBase = (path = '') => {
  const raw = (import.meta.env.VITE_API_URL as string | undefined)?.trim()
  const base = raw ? `${raw.replace(/\/$/, '')}/api/wch1925` : '/api/wch1925'
  return path ? `${base}${path}` : base
}

async function getAdminAuthHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await adminSupabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return {}

    return { Authorization: `Bearer ${token}` }
  } catch {
    return {}
  }
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(getAdminApiBase(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(await getAdminAuthHeaders()),
      ...(init?.headers || {}),
    },
  })

  if (response.headers.get('content-type')?.includes('text/csv')) {
    return (await response.text()) as unknown as T
  }

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `Request failed (${response.status})`)
  }

  return payload as T
}

export type AdminDashboardSummary = {
  totals: {
    users: number
    events: number
    registrations: number
    attendance: number
  }
  upcomingEvents: Array<{ id: string; name: string; date: string; time_slot: string; venue: string }>
  recentRegistrations: Array<{
    id: string
    registration_date: string
    registration_status: string
    participant_name: string
    user_email: string
    event_name: string
    event_date: string
    event_time: string
  }>
}

export type AdminUserRow = {
  user_id: string
  name: string
  email: string
  house: string
  register_number: string
  created_at: string
}

export type AdminRegistrationRow = {
  registration_id: string
  user_id: string
  participant_name: string
  email: string
  reg_no?: string
  house?: string
  event_id: string
  event_name: string
  event_date: string
  registration_date: string
  registration_status: string
  checked_in?: boolean
}

export type AdminSettings = {
  festivalStatus: 'pre' | 'live' | 'post'
  registrationsOpen: boolean
  coordinatorAssignments: Record<string, string>
}

export type AdminLeaderboardRow = {
  house_id: string
  house_name: string
  base_points?: number
  bonus_points?: number
  total_points: number
}

export type AdminAnnouncementRow = {
  id: string
  title: string
  body?: string | null
  pinned?: boolean
  starts_at?: string | null
  ends_at?: string | null
  created_by?: string | null
  created_at?: string
  updated_at?: string
}

export type AdminRuleRow = {
  id: string
  title: string
  body?: string | null
  pinned?: boolean
  starts_at?: string | null
  ends_at?: string | null
  created_at?: string
  updated_at?: string
}

export async function fetchAdminLeaderboard(): Promise<AdminLeaderboardRow[]> {
  const result = await adminRequest<{ data: AdminLeaderboardRow[] }>('/leaderboard')
  return result.data || []
}

export type AdminEventRow = {
  id: string
  name: string
  slug?: string | null
  description?: string | null
  category?: string | null
  main_category?: string | null
  venue?: string | null
  date?: string | null
  time_slot?: string | null
  end_time?: string | null
  registration_open?: boolean
  checkin_enabled?: boolean
  is_floated?: boolean
  is_live_tomorrow?: boolean
  status?: string
  capacity?: number | null
  prize_info?: string | null
}

export type AdminHouseRow = {
  id: string
  name: string
  accent?: string | null
  points: number
}

export async function fetchAdminEvents(): Promise<AdminEventRow[]> {
  const result = await adminRequest<{ data: AdminEventRow[] }>('/events')
  return result.data || []
}

export async function fetchAdminHouses(): Promise<AdminHouseRow[]> {
  const result = await adminRequest<{ data: AdminHouseRow[] }>('/houses')
  return result.data || []
}

export async function adjustAdminLeaderboardPoints(houseId: string, points: number, reason?: string): Promise<void> {
  await adminRequest('/leaderboard/adjust', {
    method: 'POST',
    body: JSON.stringify({ house_id: houseId, points, reason }),
  })
}

export async function fetchAdminDashboardSummary(): Promise<AdminDashboardSummary> {
  return adminRequest<AdminDashboardSummary>('/dashboard-summary')
}

export async function fetchAdminAnnouncements(): Promise<AdminAnnouncementRow[]> {
  const result = await adminRequest<{ data: AdminAnnouncementRow[] }>('/announcements')
  return result.data || []
}

export async function fetchAdminRules(): Promise<AdminRuleRow[]> {
  const result = await adminRequest<{ data: AdminRuleRow[] }>('/rules')
  return result.data || []
}

export async function createAdminAnnouncement(payload: {
  title: string
  body?: string | null
  pinned?: boolean
  starts_at?: string | null
  ends_at?: string | null
}): Promise<AdminAnnouncementRow> {
  const result = await adminRequest<{ data: AdminAnnouncementRow }>('/announcements', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return result.data
}

export async function updateAdminAnnouncement(
  id: string,
  payload: {
    title: string
    body?: string | null
    pinned?: boolean
    starts_at?: string | null
    ends_at?: string | null
  },
): Promise<AdminAnnouncementRow> {
  const result = await adminRequest<{ data: AdminAnnouncementRow }>(`/announcements/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return result.data
}

export async function deleteAdminAnnouncement(id: string): Promise<void> {
  await adminRequest(`/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function createAdminRule(payload: {
  title: string
  body?: string | null
  pinned?: boolean
  starts_at?: string | null
  ends_at?: string | null
}): Promise<AdminRuleRow> {
  const result = await adminRequest<{ data: AdminRuleRow }>('/rules', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('simmam-content')
      bc.postMessage({ type: 'rules', action: 'create', id: result.data?.id })
      bc.close()
    }
  } catch (_) {
    /* ignore */
  }
  return result.data
}

export async function updateAdminRule(
  id: string,
  payload: {
    title: string
    body?: string | null
    pinned?: boolean
    starts_at?: string | null
    ends_at?: string | null
  },
): Promise<AdminRuleRow> {
  const result = await adminRequest<{ data: AdminRuleRow }>(`/rules/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('simmam-content')
      bc.postMessage({ type: 'rules', action: 'update', id: result.data?.id })
      bc.close()
    }
  } catch (_) {
    /* ignore */
  }
  return result.data
}

export async function deleteAdminRule(id: string): Promise<void> {
  await adminRequest(`/rules/${encodeURIComponent(id)}`, { method: 'DELETE' })
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('simmam-content')
      bc.postMessage({ type: 'rules', action: 'delete', id })
      bc.close()
    }
  } catch (_) {
    /* ignore */
  }
}

export async function fetchAdminUsers(params?: { search?: string; house?: string }): Promise<AdminUserRow[]> {
  const query = new URLSearchParams()
  if (params?.search) query.set('search', params.search)
  if (params?.house) query.set('house', params.house)
  const suffix = query.toString() ? `?${query}` : ''
  const result = await adminRequest<{ data: AdminUserRow[] }>(`/users${suffix}`)
  return result.data || []
}

export async function createAdminUser(payload: {
  name: string
  email: string
  mobile_number?: string
  register_number?: string
  house?: string
  picture_url?: string
}): Promise<AdminUserRow> {
  const result = await adminRequest<{ user: AdminUserRow }>('/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return result.user
}

export async function fetchAdminUserDetails(userId: string): Promise<{ user: AdminUserRow; registrations: any[] }> {
  return adminRequest<{ user: AdminUserRow; registrations: any[] }>(`/users/${encodeURIComponent(userId)}`)
}

export async function deleteAdminUser(userId: string): Promise<void> {
  await adminRequest(`/users/${encodeURIComponent(userId)}`, { method: 'DELETE' })
}

export async function deleteAdminRegistration(registrationId: string): Promise<void> {
  await adminRequest(`/registrations/${encodeURIComponent(registrationId)}`, { method: 'DELETE' })
}

export async function removeAdminCheckin(registrationId: string): Promise<void> {
  await adminRequest(`/checkin/${encodeURIComponent(registrationId)}`, { method: 'DELETE' })
}

export async function updateAdminUser(userId: string, payload: {
  name?: string
  email?: string
  register_number?: string
  house?: string
  picture_url?: string
}): Promise<AdminUserRow> {
  const result = await adminRequest<{ user: AdminUserRow }>(`/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return result.user
}

export async function fetchAdminRegistrations(params?: { search?: string; event?: string; date?: string }): Promise<AdminRegistrationRow[]> {
  const query = new URLSearchParams()
  if (params?.search) query.set('search', params.search)
  if (params?.event) query.set('event', params.event)
  if (params?.date) query.set('date', params.date)
  const suffix = query.toString() ? `?${query}` : ''
  const result = await adminRequest<{ data: AdminRegistrationRow[] }>(`/registrations${suffix}`)
  return result.data || []
}

export async function createAdminParticipant(payload: {
  email: string
  name: string
  register_number?: string
  house?: string
  event_id?: string
  event_name?: string
}): Promise<AdminRegistrationRow> {
  const result = await adminRequest<{ data: AdminRegistrationRow }>('/registrations', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return result.data
}

export async function updateAdminParticipant(registrationId: string, payload: {
  status?: string
  event_id?: string
  event_name?: string
  email?: string
  name?: string
  register_number?: string
  house?: string
}): Promise<AdminRegistrationRow> {
  const result = await adminRequest<{ data: AdminRegistrationRow }>(`/registrations/${encodeURIComponent(registrationId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return result.data
}

export async function exportAdminRegistrationsCsv(params?: { search?: string; event?: string; date?: string }): Promise<string> {
  const query = new URLSearchParams()
  if (params?.search) query.set('search', params.search)
  if (params?.event) query.set('event', params.event)
  if (params?.date) query.set('date', params.date)
  const suffix = query.toString() ? `?${query}` : ''
  return adminRequest<string>(`/registrations/export.csv${suffix}`)
}

export async function createAdminEvent(payload: {
  name: string
  description: string
  category: string
  main_category?: string
  date: string
  time_slot: string
  end_time?: string
  venue: string
  capacity?: number
}): Promise<any> {
  const result = await adminRequest<{ data: any }>('/events', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return result.data
}

export async function updateAdminEvent(eventId: string, payload: Record<string, unknown>): Promise<any> {
  const result = await adminRequest<{ data: any }>(`/events/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return result.data
}

export async function deleteAdminEvent(eventId: string): Promise<void> {
  await adminRequest(`/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' })
}

export async function closeAdminEventRegistration(eventId: string): Promise<void> {
  await adminRequest(`/events/${encodeURIComponent(eventId)}/close-registration`, {
    method: 'POST',
  })
}

export async function fetchAdminSettings(): Promise<AdminSettings> {
  const result = await adminRequest<{ settings: AdminSettings }>('/settings')
  return result.settings
}

export async function saveAdminSettings(settings: AdminSettings): Promise<AdminSettings> {
  const result = await adminRequest<{ settings: AdminSettings }>('/settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  })
  return result.settings
}

export async function checkInRegistration(registrationId: string): Promise<void> {
  await adminRequest('/checkin', {
    method: 'POST',
    body: JSON.stringify({ registration_id: registrationId, device_info: 'admin_panel' }),
  })
}

export async function fetchAttendanceReport(): Promise<Array<{ event_name: string; event_date: string; total: number; checked_in: number; attendance_rate: number }>> {
  const result = await adminRequest<{ data: Array<{ event_name: string; event_date: string; total: number; checked_in: number; attendance_rate: number }> }>('/attendance-report')
  return result.data || []
}
