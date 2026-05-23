import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Tilt3D } from "./Tilt3D";
import { Bell, BookOpen, X, Search } from "lucide-react";
import { SectionHeader } from "./Dashboard";
import { useData, type AdminEvent } from "../lib/store";
import { fetchAnnouncements, fetchRules, type ApiAnnouncement, type ApiRule } from "../lib/apiClient";

const categories = ["All", "Tech", "Non-Tech", "Sports", "Cultural Fest"];

const getRenderableIcon = (icon: AdminEvent["icon"] | undefined) =>
  typeof icon === "function" ? icon : null;

export function Events() {
  const { events } = useData();
  const [filter, setFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<AdminEvent | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [announcements, setAnnouncements] = useState<ApiAnnouncement[]>([]);
  const [rules, setRules] = useState<ApiRule[]>([]);

  useEffect(() => {
    void fetchAnnouncements()
      .then(setAnnouncements)
      .catch(() => setAnnouncements([]));

    void fetchRules()
      .then(setRules)
      .catch(() => setRules([]));
  }, []);

  useEffect(() => {
    try {
      if (typeof BroadcastChannel === 'undefined') return
      const bc = new BroadcastChannel('simmam-content')
      bc.onmessage = (ev) => {
        const data = ev.data
        if (!data) return
        if (data.type === 'rules') {
          void fetchRules().then(setRules).catch(() => {})
        }
        if (data.type === 'announcements') {
          void fetchAnnouncements().then(setAnnouncements).catch(() => {})
        }
      }
      return () => {
        try { bc.close() } catch (_) {}
      }
    } catch (_) {
      /* ignore */
    }
  }, [])

  const list = events.filter((e) => {
    const matchesCategory = filter === "All" || e.mainCategory === filter;
    const matchesSearch =
      e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const SelectedIcon = selectedEvent ? getRenderableIcon(selectedEvent.icon) : null;

  return (
    <div id="events" className="relative py-24 md:py-32">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowNotifications(true)}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold tracking-[0.25em] text-foreground/80 hover:border-gold/30 hover:text-gold transition"
          >
            <Bell className="h-4 w-4" />
            Notifications
            {announcements.length > 0 && (
              <span className="ml-1 rounded-full bg-[var(--gold)] px-2 py-0.5 text-[10px] font-bold text-background">
                {announcements.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowRules(true)}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold tracking-[0.25em] text-foreground/80 hover:border-gold/30 hover:text-gold transition"
          >
            <BookOpen className="h-4 w-4" />
            Rules and Regulations
          </button>
        </div>

        <SectionHeader
          eyebrow="Events"
          title="150 Battlegrounds. One Crown."
          subtitle="From algorithmic showdowns to runway spectacles — SIMMAM 2026 has a stage for every spark."
        />

        {/* Global Register Button */}
        {list.some((e) => e.registration_open) && (
          <div className="flex justify-center mb-10">
            <Link
              to="/register"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-gradient-to-r from-[var(--crimson)] to-[var(--gold)] text-background font-bold shadow-[var(--shadow-glow-red)] hover:scale-105 transition-transform"
            >
              Go to Registration Portal
            </Link>
          </div>
        )}

        {/* Search */}
        <div className="relative max-w-md mx-auto mb-8">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <Search className="w-5 h-5 text-foreground/40" />
          </div>
          <input
            type="text"
            placeholder="Search events, categories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/50 transition text-foreground placeholder:text-foreground/40"
          />
        </div>

        {/* Category filters */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`px-4 py-2 rounded-full text-xs tracking-wider transition ${filter === c
                  ? "bg-gradient-to-r from-[var(--crimson)] to-[var(--gold)] text-background font-semibold shadow-[var(--shadow-glow-red)]"
                  : "glass text-foreground/70 hover:text-gold"
                }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Event grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {list.map((e, index) => {
            const EventIcon = getRenderableIcon(e.icon)

            return (
              <Tilt3D key={`${e.name}-${e.category}-${index}`} max={10}>
                <div
                  onClick={() => setSelectedEvent(e)}
                  className="group relative glass rounded-2xl p-5 hover-lift overflow-hidden h-full cursor-pointer"
                >
                  <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl bg-[var(--gold)]/30 opacity-50 group-hover:opacity-90 transition" />
                  <div className="relative flex items-start justify-end">
                    <span className="text-[10px] tracking-[0.25em] text-foreground/50">
                      {e.category.toUpperCase()}
                    </span>
                  </div>
                  <div className="relative mt-5">
                    <div className="font-display text-xl font-bold text-foreground">
                      {e.name}
                    </div>
                  </div>
                  <div className="relative mt-5 w-full flex gap-2">
                    <div className="flex-1 py-2.5 rounded-lg text-xs font-semibold border border-[var(--gold)]/30 text-[var(--gold)] hover:bg-[var(--gold)]/10 transition text-center flex items-center justify-center">
                      View Details
                    </div>
                    {e.registration_open && (
                      <Link
                        to="/register"
                        onClick={(ev) => ev.stopPropagation()}
                        className="flex-1 py-2.5 rounded-lg text-xs font-bold bg-gradient-to-r from-[var(--crimson)] to-[var(--gold)] text-white hover:opacity-90 transition text-center flex items-center justify-center"
                      >
                        Register Now
                      </Link>
                    )}
                  </div>
                </div>
              </Tilt3D>
            )
          })}
        </div>

        {/* ── Rules Modal ───────────────────────────────────────── */}
        {selectedEvent && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setSelectedEvent(null)}
            />
            <div className="relative w-full max-w-lg bg-[#0a0515] border border-white/10 rounded-2xl p-6 md:p-8 animate-rise-in shadow-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
              <div className="absolute -top-20 -right-20 w-48 h-48 rounded-full blur-3xl opacity-20 bg-[var(--gold)] pointer-events-none" />
              <button
                onClick={() => setSelectedEvent(null)}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/5 text-foreground/50 hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-4 mb-6">
                <div className="p-3 rounded-xl bg-gold/10 text-gold neon-border">
                  {SelectedIcon ? <SelectedIcon className="w-6 h-6" /> : <div className="w-6 h-6 bg-gold/20 rounded" />}
                </div>
                <div>
                  <h3 className="font-display text-2xl font-bold text-foreground">
                    {selectedEvent.name}
                  </h3>
                  <p className="text-xs tracking-[0.2em] text-gold/80 uppercase">
                    {selectedEvent.category}
                  </p>
                </div>
              </div>

              <div className="space-y-4 mb-8">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <h4 className="text-sm font-semibold text-foreground/80">Event Rules</h4>
                  <span className="text-[10px] tracking-[0.25em] text-gold/70 uppercase">Synced from Admin</span>
                </div>
                <ul className="space-y-3">
                  {selectedEvent.rules && selectedEvent.rules.length > 0 ? (
                    selectedEvent.rules.map((rule, i) => (
                      <li key={i} className="flex gap-3 text-sm text-foreground/70">
                        <span className="text-gold mt-1">•</span>
                        <span>{rule}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-foreground/50 italic">
                      No specific rules listed.
                    </li>
                  )}
                </ul>
              </div>

              {selectedEvent.registration_open ? (
                <Link
                  to="/register"
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-[var(--crimson)] to-[var(--gold)] text-background hover:shadow-[var(--shadow-glow-red)] transition-all"
                >
                  Register for Events
                </Link>
              ) : (
                <div className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold bg-gray-600 text-gray-400 cursor-not-allowed">
                  Register now
                </div>
              )}
            </div>
          </div>
        )}

        {showNotifications && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => setShowNotifications(false)} />
            <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0a0515] p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
              <button
                type="button"
                onClick={() => setShowNotifications(false)}
                className="absolute right-4 top-4 rounded-full p-2 text-foreground/50 hover:bg-white/5 hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-xl bg-gold/10 p-3 text-gold">
                  <Bell className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-2xl font-bold text-foreground">Notifications</h3>
                  <p className="text-xs tracking-[0.2em] text-gold/70 uppercase">Latest admin updates</p>
                </div>
              </div>

              <div className="space-y-3">
                {announcements.length > 0 ? announcements.map((item) => (
                  <article key={item.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <h4 className="font-semibold text-foreground">{item.title}</h4>
                      {item.pinned && (
                        <span className="rounded-full bg-[var(--gold)]/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-gold uppercase">
                          Pinned
                        </span>
                      )}
                    </div>
                    {item.body ? <p className="text-sm text-foreground/70">{item.body}</p> : null}
                  </article>
                )) : (
                  <div className="rounded-xl border border-white/10 bg-black/30 p-5 text-sm text-foreground/50">
                    No admin notifications yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {showRules && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => setShowRules(false)} />
            <div className="relative w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0a0515] p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
              <button
                type="button"
                onClick={() => setShowRules(false)}
                className="absolute right-4 top-4 rounded-full p-2 text-foreground/50 hover:bg-white/5 hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-xl bg-gold/10 p-3 text-gold">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-2xl font-bold text-foreground">Rules and Regulations</h3>
                  <p className="text-xs tracking-[0.2em] text-gold/70 uppercase">Published by Admin</p>
                </div>
              </div>

              <div className="space-y-3">
                {rules.length > 0 ? rules.map((item) => (
                  <article key={item.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <h4 className="font-semibold text-foreground">{item.title}</h4>
                      {item.pinned && (
                        <span className="rounded-full bg-[var(--gold)]/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-gold uppercase">
                          Fixed
                        </span>
                      )}
                    </div>
                    {item.body ? <p className="text-sm text-foreground/70 whitespace-pre-line">{item.body}</p> : null}
                  </article>
                )) : (
                  <div className="rounded-xl border border-white/10 bg-black/30 p-5 text-sm text-foreground/50">
                    No published rules and regulations yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
