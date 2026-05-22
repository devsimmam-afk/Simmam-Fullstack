import { useState, useEffect, useCallback } from 'react'
import {
  Calendar,
  Clock,
  LogOut,
  MapPin,
  Sparkles,
  User,
} from 'lucide-react'
import { getUserRegistrations, getCheckedInEvents, clearAllUserData, syncUserRegistrations, type Registration, type UserProfile } from '@/lib/registrationStore'
import { useData } from '@/lib/store'

// ─── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'registered' | 'checkedin' | 'od'

// ─── Skeleton Loader ───────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-white/6 bg-[#0d0d0d] p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-3 w-20 rounded bg-white/8" />
        <div className="ml-auto h-5 w-16 rounded-full bg-white/6" />
      </div>
      <div className="h-5 w-3/4 rounded bg-white/10 mb-2" />
      <div className="h-3 w-1/2 rounded bg-white/6" />
    </div>
  )
}

// ─── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="py-14 text-center">
      <p className="mb-1 text-base font-semibold text-white/40">{title}</p>
      <p className="text-sm text-white/20">{subtitle}</p>
    </div>
  )
}

// ─── Event Card ────────────────────────────────────────────────────────────────

type EventCardVariant = 'registered' | 'checkedin' | 'od'

interface DashboardEventCardProps {
  eventName: string
  category?: string
  venue?: string
  date?: string
  timeSlot?: string
  endTime?: string
  variant: EventCardVariant
}

const STATUS_CONFIG: Record<EventCardVariant, { bg: string; text: string; border: string; label: string }> = {
  registered: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/25',
    label: 'Registered',
  },
  checkedin: {
    bg: 'bg-green-500/10',
    text: 'text-green-400',
    border: 'border-green-500/25',
    label: 'Checked In',
  },
  od: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/25',
    label: 'OD Eligible',
  },
}

function DashboardEventCard({
  eventName,
  category,
  venue,
  date,
  timeSlot,
  endTime,
  variant,
}: DashboardEventCardProps) {
  const status = STATUS_CONFIG[variant]

  const dayLabel = date
    ? new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    : null

  return (
    <article className="group relative flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl border border-white/8 bg-[#0d0d0d] hover:border-[#D4AF37]/20 transition-all duration-300 hover:bg-[#111]">
      {/* Content */}
      <div className="flex-1 min-w-0">
        {category && (
          <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-[#D4AF37]/15 bg-[#D4AF37]/8 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-[#D4AF37]/80 uppercase">
            <Sparkles className="h-3 w-3" />
            {category}
          </span>
        )}

        <h3 className="mb-2 font-display text-base font-bold text-white group-hover:text-[#D4AF37] transition-colors leading-snug">
          {eventName}
        </h3>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40">
          {dayLabel && (
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3 h-3 shrink-0 text-[#D4AF37]/40" />
              {dayLabel}
            </span>
          )}
          {timeSlot && (
            <span className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 shrink-0 text-[#D4AF37]/40" />
              {timeSlot}{endTime ? ` – ${endTime}` : ''}
            </span>
          )}
          {venue && (
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3 h-3 shrink-0 text-[#D4AF37]/40" />
              {venue}
            </span>
          )}
        </div>
      </div>

      {/* Badge */}
      <div className="shrink-0">
        <div
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border ${status.bg} ${status.border} ${status.text}`}
        >
          {status.label}
        </div>
      </div>
    </article>
  )
}

function DetailedODCard({
  eventName,
  category,
  venue,
  date,
  timeSlot,
  endTime,
}: Omit<DashboardEventCardProps, 'variant'>) {
  const fullDate = date
    ? new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'Date TBD'

  return (
    <article className="relative overflow-hidden rounded-2xl border border-[#D4AF37]/30 bg-gradient-to-br from-[#111] to-[#0a0a0a] p-6 md:p-8 shadow-[0_0_30px_rgba(212,175,55,0.03)] transition-all hover:border-[#D4AF37]/50 hover:shadow-[0_0_40px_rgba(212,175,55,0.08)]">
      {/* Background decorations */}
      <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#D4AF37]/5 blur-[80px]" />
      <div
        className="absolute inset-0 opacity-[0.06] mix-blend-overlay"
        style={{
          backgroundImage:
            'repeating-radial-gradient(circle at 1px 1px, rgba(255,255,255,0.2) 0, rgba(255,255,255,0.2) 1px, transparent 2px, transparent 5px)',
        }}
      />
      
      <div className="relative z-10">
        <div className="mb-6 flex flex-col md:flex-row md:items-start justify-between border-b border-white/10 pb-6 gap-4">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-flex items-center gap-1.5 rounded border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.2)]">
                <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                OD APPROVED
              </span>
              {category && (
                <span className="inline-flex items-center gap-1 rounded border border-[#D4AF37]/20 bg-[#D4AF37]/10 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-[#D4AF37]/80">
                  <Sparkles className="h-3 w-3" /> {category}
                </span>
              )}
            </div>
            <h3 className="font-display text-2xl md:text-3xl font-black text-white leading-tight">{eventName}</h3>
            <p className="mt-2 text-sm text-white/40 max-w-lg">
              This confirms that the student is checked-in and eligible for On-Duty (OD) for the duration of this event.
            </p>
          </div>
          
          <div className="shrink-0 flex items-center justify-center h-20 w-20 rounded-xl border-2 border-dashed border-[#D4AF37]/20 bg-[#D4AF37]/5 relative overflow-hidden">
            <span className="absolute inset-0 flex items-center justify-center rotate-[-12deg] text-xs font-black uppercase tracking-widest text-[#D4AF37]/40">
              Verified
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 rounded-xl bg-black/40 p-5 border border-white/5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#D4AF37]/10 text-[#D4AF37]">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1">Date</p>
              <p className="text-sm font-semibold text-white/90">{fullDate}</p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#D4AF37]/10 text-[#D4AF37]">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1">Time Slot</p>
              <p className="text-sm font-semibold text-white/90">{timeSlot || 'TBD'}{endTime ? ` - ${endTime}` : ''}</p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#D4AF37]/10 text-[#D4AF37]">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1">Venue</p>
              <p className="text-sm font-semibold text-white/90">{venue || 'TBD'}</p>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  count: number
  label: string
  accentColor: string
  loading?: boolean
}

function StatCard({ count, label, accentColor, loading }: StatCardProps) {
  return (
    <div
      className="relative flex flex-col items-center justify-center gap-2 rounded-2xl border bg-[#0d0d0d] p-5 transition-all duration-300 hover:scale-[1.02]"
      style={{ borderColor: `${accentColor}30` }}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-5"
        style={{ background: `radial-gradient(circle at top right, ${accentColor}, transparent 70%)` }}
      />
      {loading ? (
        <div className="h-8 w-10 animate-pulse rounded bg-white/10" />
      ) : (
        <span className="text-3xl font-black text-white tabular-nums">{count}</span>
      )}
      <span className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">
        {label}
      </span>
    </div>
  )
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────

interface UserDashboardProps {
  user: UserProfile
  onSignOut: () => void
}

export function UserDashboard({ user, onSignOut }: UserDashboardProps) {
  const { participants, houses } = useData()
  const [activeTab, setActiveTab] = useState<Tab>('registered')
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  const userHouse = houses.find((h) => h.name === user.house)

  const loadData = useCallback(() => {
    setLoading(true)
    const cached = getUserRegistrations(user.email)
    setRegistrations(cached)
    void syncUserRegistrations(user.email)
      .then((rows) => {
        setRegistrations(rows)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [user.email])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Derive check-in data from admin participants
  const checkedInEntries = getCheckedInEvents(user.email, participants as any)

  // Map checkedIn entries back to registration-like objects
  const checkedInRegs = registrations.filter((reg) =>
    checkedInEntries.some(
      (ci) =>
        (ci as any).event?.toLowerCase() === reg.eventName.toLowerCase() ||
        (ci as any).eventName?.toLowerCase() === reg.eventName.toLowerCase(),
    ),
  )

  const odEligibleRegs = checkedInRegs // OD eligible == checked-in

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'registered', label: 'Registered Events', count: registrations.length },
    { key: 'checkedin', label: 'Checked In', count: checkedInRegs.length },
    { key: 'od', label: 'OD Eligible', count: odEligibleRegs.length },
  ]

  return (
    <div className="max-w-5xl mx-auto px-4 mt-10 pb-20" id="user-dashboard">
      {/* Section header */}
      <div className="flex items-center gap-3 mb-6">
        <span className="h-px w-8 bg-gradient-to-r from-transparent to-[#D4AF37]" />
        <span className="text-[10px] tracking-[0.4em] text-[#D4AF37]/70">MY DASHBOARD</span>
      </div>

      {/* Profile Card */}
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 md:p-6">
        {/* Background glow */}
        {userHouse && (
          <div
            className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full blur-3xl opacity-15"
            style={{ background: userHouse.accent }}
          />
        )}

        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="font-display text-xl font-black text-white">{user.name}</h2>
              {userHouse && (
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider border"
                  style={{
                    borderColor: `${userHouse.accent}40`,
                    backgroundColor: `${userHouse.accent}18`,
                    color: userHouse.accent,
                  }}
                >
                  {userHouse.short} · {userHouse.name}
                </span>
              )}
            </div>
            <p className="text-sm text-white/40">{user.email}</p>
            <p className="mt-0.5 font-mono text-xs text-[#D4AF37]/60">{user.registerNumber}</p>
          </div>

          {/* Actions */}
          <div className="shrink-0 flex flex-col sm:flex-row items-end sm:items-center gap-2">
            {confirmSignOut ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/40">Clear all data?</span>
                <button
                  id="confirm-signout-btn"
                  onClick={() => {
                    clearAllUserData(user.email)
                    onSignOut()
                  }}
                  className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-400 hover:bg-red-500/20 transition"
                >
                  Yes, Sign Out
                </button>
                <button
                  onClick={() => setConfirmSignOut(false)}
                  className="text-xs text-white/30 hover:text-white transition px-2 py-2"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                id="signout-btn"
                onClick={() => setConfirmSignOut(true)}
                className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/3 px-4 py-2.5 text-xs font-semibold text-white/30 transition hover:border-red-500/30 hover:text-red-400"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <StatCard
          count={registrations.length}
          label="Registered"
          accentColor="#D4AF37"
          loading={loading}
        />
        <StatCard
          count={checkedInRegs.length}
          label="Checked In"
          accentColor="#22c55e"
          loading={loading}
        />
        <StatCard
          count={odEligibleRegs.length}
          label="OD Eligible"
          accentColor="#60a5fa"
          loading={loading}
        />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-xl border border-white/8 bg-[#0d0d0d] p-1 mb-6 overflow-x-auto scrollbar-none">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            id={`tab-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 shrink-0 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold tracking-wide transition-all duration-200 ${
              activeTab === tab.key
                ? 'bg-[#D4AF37]/15 border border-[#D4AF37]/40 text-[#D4AF37]'
                : 'text-white/40 hover:text-white hover:bg-white/5'
            }`}
          >
            {tab.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                activeTab === tab.key
                  ? 'bg-[#D4AF37]/20 text-[#D4AF37]'
                  : 'bg-white/8 text-white/30'
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div
        style={{
          opacity: loading ? 0.5 : 1,
          transition: 'opacity 0.25s ease',
        }}
      >
        {/* REGISTERED EVENTS */}
        {activeTab === 'registered' && (
          <div className="space-y-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
            ) : registrations.length === 0 ? (
              <EmptyState
                title="No registered events yet"
                subtitle="Head to the schedule above and register for events."
              />
            ) : (
              registrations
                .sort((a, b) => (a.timeSlot || '').localeCompare(b.timeSlot || ''))
                .map((reg) => {
                  const isCheckedIn = checkedInRegs.some((c) => c.eventId === reg.eventId)
                  return (
                    <DashboardEventCard
                      key={reg.eventId}
                      eventName={reg.eventName}
                      category={reg.category}
                      venue={reg.venue}
                      date={reg.date}
                      timeSlot={reg.timeSlot}
                      endTime={reg.endTime}
                      variant={isCheckedIn ? 'checkedin' : 'registered'}
                    />
                  )
                })
            )}
          </div>
        )}

        {/* CHECKED-IN EVENTS */}
        {activeTab === 'checkedin' && (
          <div className="space-y-3">
            {loading ? (
              Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)
            ) : checkedInRegs.length === 0 ? (
              <EmptyState
                title="No checked-in events yet"
                subtitle="Once an admin marks your attendance, it'll appear here."
              />
            ) : (
              checkedInRegs.map((reg) => (
                <DashboardEventCard
                  key={reg.eventId}
                  eventName={reg.eventName}
                  category={reg.category}
                  venue={reg.venue}
                  date={reg.date}
                  timeSlot={reg.timeSlot}
                  endTime={reg.endTime}
                  variant="checkedin"
                />
              ))
            )}
          </div>
        )}

        {/* OD ELIGIBLE */}
        {activeTab === 'od' && (
          <div className="space-y-4">
            {loading ? (
              Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)
            ) : odEligibleRegs.length === 0 ? (
              <EmptyState
                title="No OD eligible events yet"
                subtitle="Events where you've checked in will qualify for OD."
              />
            ) : (
              odEligibleRegs.map((reg) => (
                <DetailedODCard
                  key={reg.eventId}
                  eventName={reg.eventName}
                  category={reg.category}
                  venue={reg.venue}
                  date={reg.date}
                  timeSlot={reg.timeSlot}
                  endTime={reg.endTime}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Divider hint */}
      {!loading && (
        <div className="mt-10 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/5" />
          <span className="text-[10px] tracking-[0.3em] text-white/15">END OF DASHBOARD</span>
          <div className="h-px flex-1 bg-white/5" />
        </div>
      )}
    </div>
  )
}
