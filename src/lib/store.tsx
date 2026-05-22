import { allEvents as initialEvents, type Event } from './eventsData';
import { houses as initialHouses, type House } from './houses';
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { fetchEvents, fetchHouses, fetchLeaderboard } from './apiClient';
import { fetchAdminEvents, fetchAdminHouses, fetchAdminRegistrations, fetchAdminSettings, type AdminSettings } from './adminApi';

// Extend Event type for admin features
export interface EventResult {
  winnerHouse: string;
  runnerUpHouse: string;
  pointsAwarded: number;
  resultDay: string;
  isPublished: boolean;
}

export interface AdminEvent extends Event {
  id: string;
  venue?: string;
  time?: string;
  is_floated: boolean;
  is_live_tomorrow: boolean;
  registration_open: boolean;
  checkin_enabled: boolean;
  status: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
  participantCount: number;
  prizeInfo: string;
  result?: EventResult;
}

export interface Participant {
  id: string;
  name: string;
  regNo: string;
  email: string;
  house: string;
  event: string;
  status: 'confirmed' | 'pending' | 'waitlisted';
  checkIn: boolean;
  certificate: boolean;
}

export interface PointTransaction {
  id: string;
  houseName: string;
  points: number;
  reason: string;
  timestamp: string;
  issuedBy: string;
}

interface DataContextType {
  events: AdminEvent[];
  houses: House[];
  participants: Participant[];
  updateEvent: (updatedEvent: AdminEvent) => void;
  addEvent: (newEvent: AdminEvent) => void;
  deleteEvent: (eventId: string) => void;
  updateHouse: (updatedHouse: House) => void;
  updateParticipant: (updatedParticipant: Participant) => void;
  addParticipant: (newParticipant: Participant) => void;
  updateHousePoints: (houseName: string, points: number, reason?: string, issuedBy?: string) => void;
  pointsHistory: PointTransaction[];
  findAdminEventByName: (name: string) => AdminEvent | undefined;
  isRegistrationAllowed: (eventName: string) => boolean;
  isCheckInAllowed: (eventName: string) => boolean;
  settings: AdminSettings;
  updateSettings: (newSettings: any) => void;
  refreshData: () => Promise<void>; // New refresh function
}

const noopAsync = async () => undefined;

const defaultDataContext: DataContextType = {
  events: [],
  houses: initialHouses.map((h) => ({
    ...h,
    points2026: h.points2026 ?? h.points2025 ?? 0,
  })),
  participants: [],
  updateEvent: () => undefined,
  addEvent: () => undefined,
  deleteEvent: () => undefined,
  updateHouse: () => undefined,
  updateParticipant: () => undefined,
  addParticipant: () => undefined,
  updateHousePoints: () => undefined,
  pointsHistory: [],
  findAdminEventByName: () => undefined,
  isRegistrationAllowed: () => false,
  isCheckInAllowed: () => false,
  settings: {
    festivalStatus: 'pre',
    registrationsOpen: true,
    coordinatorAssignments: {},
  },
  updateSettings: () => undefined,
  refreshData: noopAsync,
}

const DataContext = createContext<DataContextType>(defaultDataContext);

const mapEventStatus = (status?: string): AdminEvent['status'] => {
  if (status === 'live' || status === 'ongoing') return 'ongoing';
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  return 'upcoming';
};

const readCachedValue = <T,>(key: string): T | null => {
  if (typeof window === 'undefined') return null

  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

const writeCachedValue = <T,>(key: string, value: T): void => {
  if (typeof window === 'undefined') return

  localStorage.setItem(key, JSON.stringify(value))
}

export const mapRemoteEventToAdminEvent = (
  remoteEvent: Awaited<ReturnType<typeof fetchAdminEvents>>[number],
  fallback?: AdminEvent,
  order = 0,
): AdminEvent => ({
  ...(fallback || initialEvents[0]),
  id: remoteEvent.id,
  name: remoteEvent.name,
  category: remoteEvent.category || fallback?.category || initialEvents[0].category,
  mainCategory: (remoteEvent.main_category as any) || fallback?.mainCategory || initialEvents[0].mainCategory,
  venue: remoteEvent.venue || fallback?.venue || (initialEvents[0] as any).venue,
  time: remoteEvent.time_slot || fallback?.time || initialEvents[0].time,
  date: remoteEvent.date || (fallback as any)?.date || (initialEvents[0] as any).date,
  is_floated: remoteEvent.is_floated ?? fallback?.is_floated ?? true,
  is_live_tomorrow: remoteEvent.is_live_tomorrow ?? fallback?.is_live_tomorrow ?? false,
  registration_open: remoteEvent.registration_open ?? fallback?.registration_open ?? true,
  checkin_enabled: remoteEvent.checkin_enabled ?? fallback?.checkin_enabled ?? false,
  status: mapEventStatus(remoteEvent.status || fallback?.status),
  participantCount: remoteEvent.capacity ?? fallback?.participantCount ?? 0,
  prizeInfo: remoteEvent.prize_info || fallback?.prizeInfo || 'Trophy + Certificate',
  result: fallback?.result,
  icon: fallback?.icon || initialEvents[0].icon,
  rules: Array.isArray((remoteEvent as any).rules) && (remoteEvent as any).rules.length > 0
    ? (remoteEvent as any).rules
    : fallback?.rules || initialEvents[0].rules,
  description: remoteEvent.description || fallback?.description || initialEvents[0].description,
  order: fallback?.order ?? order + 1,
})

export async function resolvePersistedEventId(event: AdminEvent): Promise<string> {
  if (!event.id.startsWith('event-')) {
    return event.id
  }

  const remoteEvents = await fetchAdminEvents()
  const remoteMatch = remoteEvents.find((candidate) => candidate.name.toLowerCase() === event.name.toLowerCase())

  return remoteMatch?.id || event.id
}

const mapRemoteEventsToAdminEvents = (remoteEvents: Awaited<ReturnType<typeof fetchAdminEvents>>): AdminEvent[] => {
  const orderByName = new Map(initialEvents.map((event, index) => [event.name.toLowerCase(), index]))
  const fallbackByName = new Map(initialEvents.map((event) => [event.name.toLowerCase(), event]))

  return [...remoteEvents]
    .sort((left, right) => {
      const leftOrder = orderByName.get(left.name.toLowerCase()) ?? 1000
      const rightOrder = orderByName.get(right.name.toLowerCase()) ?? 1000
      return leftOrder - rightOrder || left.name.localeCompare(right.name)
    })
    .map((remoteEvent, index) => mapRemoteEventToAdminEvent(remoteEvent, fallbackByName.get(remoteEvent.name.toLowerCase()), index))
};

// Participants are populated from the admin API; remove built-in mock generation.

export function DataProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<AdminEvent[]>(() => readCachedValue<AdminEvent[]>('simmam_events') || []);
  const [houses, setHouses] = useState<House[]>(() =>
    readCachedValue<House[]>('simmam_houses') || initialHouses.map((h) => ({
      ...h,
      points2026: h.points2026 ?? h.points2025 ?? 0,
    })),
  );
  const [participants, setParticipants] = useState<Participant[]>(() => readCachedValue<Participant[]>('simmam_participants') || []);
  const [settings, setSettings] = useState<AdminSettings>(() =>
    readCachedValue<AdminSettings>('simmam_settings') || {
      festivalStatus: 'pre',
      registrationsOpen: true,
      coordinatorAssignments: {},
    },
  );
  const [pointsHistory, setPointsHistory] = useState<PointTransaction[]>([]);

  useEffect(() => {
    const storedEvents = localStorage.getItem('simmam_events');
    const storedHouses = localStorage.getItem('simmam_houses');
    const storedParticipants = localStorage.getItem('simmam_participants');
    const storedSettings = localStorage.getItem('simmam_settings');
    const storedPointsHistory = localStorage.getItem('simmam_points_history');

    if (storedEvents) {
      const parsedEvents = JSON.parse(storedEvents);
      const reattachedEvents = parsedEvents.map((e: any) => {
        const staticEvent = initialEvents.find(se => se.name === e.name);
        return {
          ...e,
          icon: staticEvent?.icon || initialEvents[0].icon // Fallback to first static icon
        };
      });
      setEvents(reattachedEvents);
    } else {
      setEvents([]);
    }

    if (storedHouses) {
      const parsedHouses = JSON.parse(storedHouses);
      // Migration: If old data has points2025 but not points2026, migrate it
      const migratedHouses = parsedHouses.map((h: any) => ({
        ...h,
        points2026: h.points2026 ?? h.points2025 ?? 0
      }));
      setHouses(migratedHouses);
    } else {
      setHouses(initialHouses);
    }

    if (storedParticipants) setParticipants(JSON.parse(storedParticipants));
    else setParticipants([]);

    if (storedSettings) setSettings(JSON.parse(storedSettings));
    if (storedPointsHistory) setPointsHistory(JSON.parse(storedPointsHistory));
  }, []);

  const refreshData = useCallback(async () => {
    const isAdminRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')

    const eventsJob = (isAdminRoute ? fetchAdminEvents() : fetchEvents())
      .then((remoteEvents) => {
        if (remoteEvents.length > 0) {
          const mappedEvents = mapRemoteEventsToAdminEvents(remoteEvents as Awaited<ReturnType<typeof fetchAdminEvents>>)
          setEvents(mappedEvents)
          writeCachedValue('simmam_events', mappedEvents)
        }
      })
      .catch((err) => console.error('Failed to refresh events from API:', err))

    const housesJob = Promise.all([isAdminRoute ? fetchAdminHouses() : fetchHouses(), fetchLeaderboard()])
      .then(([remoteHouses, remoteLeaderboard]) => {
        if (remoteHouses.length > 0) {
          const leaderboardPointsByName = new Map(
            remoteLeaderboard.map((item) => [item.house_name.toLowerCase(), Number(item.total_points ?? item.points ?? 0)]),
          )

          const mappedHouses = initialHouses.map((house) => {
            const remoteHouse = remoteHouses.find((candidate) => candidate.name.toLowerCase() === house.name.toLowerCase())
            const points2026 = leaderboardPointsByName.get(house.name.toLowerCase()) ?? Number(remoteHouse?.points ?? house.points2026 ?? 0)

            return {
              ...house,
              accent: remoteHouse?.accent || house.accent,
              points2026,
            }
          })

          setHouses(mappedHouses)
          writeCachedValue('simmam_houses', mappedHouses)
        }
      })
      .catch((err) => console.error('Failed to refresh houses from API:', err))

    const registrationsJob = (isAdminRoute ? fetchAdminRegistrations() : Promise.resolve([]))
      .then((remoteRegistrations) => {
        if (Array.isArray(remoteRegistrations)) {
          const mappedParticipants = remoteRegistrations.map((row) => ({
            id: row.registration_id,
            name: row.participant_name,
            regNo: row.reg_no || '',
            email: row.email,
            house: row.house || 'Unknown',
            event: row.event_name,
            status: (row.registration_status as 'confirmed' | 'pending' | 'waitlisted') || 'confirmed',
            checkIn: !!row.checked_in,
            certificate: false,
          }))
          setParticipants(mappedParticipants)
          writeCachedValue('simmam_participants', mappedParticipants)
        }
      })
      .catch((err) => console.error('Failed to refresh registrations from API:', err))

    const settingsJob = (isAdminRoute
      ? fetchAdminSettings()
      : Promise.resolve({
          festivalStatus: 'pre',
          registrationsOpen: true,
          coordinatorAssignments: {},
        } as AdminSettings)
    )
      .then((remoteSettings) => {
        if (remoteSettings) {
          setSettings(remoteSettings)
          writeCachedValue('simmam_settings', remoteSettings)
        }
      })
      .catch((err) => console.error('Failed to refresh settings from API:', err))

    await Promise.allSettled([eventsJob, housesJob, registrationsJob, settingsJob])
  }, []);

  useEffect(() => {
    void refreshData();
    const refreshInterval = window.setInterval(() => {
      void refreshData();
    }, 15000);

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        void refreshData();
      }
    };

    window.addEventListener('focus', handleVisibilityRefresh);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      window.clearInterval(refreshInterval);
      window.removeEventListener('focus', handleVisibilityRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, [refreshData]);

  const updateEvent = (updatedEvent: AdminEvent) => {
    const newEvents = events.map((event) => {
      const idMatches = event.id === updatedEvent.id
      const nameMatches = event.name.toLowerCase() === updatedEvent.name.toLowerCase()
      return idMatches || nameMatches ? updatedEvent : event
    })
    setEvents(newEvents);
    writeCachedValue('simmam_events', newEvents);
  };

  const addEvent = (newEvent: AdminEvent) => {
    const updatedEvents = [...events, newEvent];
    setEvents(updatedEvents);
    writeCachedValue('simmam_events', updatedEvents);
  };

  const deleteEvent = (eventId: string) => {
    const updatedEvents = events.filter((event) => event.id !== eventId && event.name.toLowerCase() !== eventId.toLowerCase());
    setEvents(updatedEvents);
    writeCachedValue('simmam_events', updatedEvents);
  };

  const updateHouse = (updatedHouse: House) => {
    const newHouses = houses.map(h => h.name === updatedHouse.name ? updatedHouse : h);
    setHouses(newHouses);
    writeCachedValue('simmam_houses', newHouses);
  };

  const updateParticipant = (updatedParticipant: Participant) => {
    const newParticipants = participants.map(p => p.id === updatedParticipant.id ? updatedParticipant : p);
    setParticipants(newParticipants);
    writeCachedValue('simmam_participants', newParticipants);
  };

  const addParticipant = (newParticipant: Participant) => {
    const updatedParticipants = [...participants, newParticipant];
    setParticipants(updatedParticipants);
    writeCachedValue('simmam_participants', updatedParticipants);
  };

  const updateHousePoints = (houseName: string, points: number, reason?: string, issuedBy: string = 'Admin') => {
    const newHouses = houses.map(h => {
      if (h.name === houseName) {
        return {
          ...h,
          points2026: Number(h.points2026 ?? 0) + Number(points)
        };
      }
      return h;
    });
    setHouses(newHouses);
    writeCachedValue('simmam_houses', newHouses);

    if (reason || points < 0) {
      const newTransaction: PointTransaction = {
        id: `tx-${Date.now()}`,
        houseName,
        points,
        reason: reason || 'Point adjustment',
        timestamp: new Date().toISOString(),
        issuedBy
      };
      const newHistory = [newTransaction, ...pointsHistory];
      setPointsHistory(newHistory);
      writeCachedValue('simmam_points_history', newHistory);
    }
  };

  const updateSettings = (newSettings: any) => {
    setSettings(newSettings);
    writeCachedValue('simmam_settings', newSettings);
  };

  const findAdminEventByName = (name: string): AdminEvent | undefined => {
    return events.find(e => e.name === name);
  };

  const isRegistrationAllowed = (eventName: string): boolean => {
    const event = findAdminEventByName(eventName);
    return event ? event.is_floated && event.registration_open : false;
  };

  const isCheckInAllowed = (eventName: string): boolean => {
    const event = findAdminEventByName(eventName);
    return event ? event.checkin_enabled : false;
  };

  return (
    <DataContext.Provider value={{
      events,
      houses,
      participants,
      updateEvent,
      addEvent,
      deleteEvent,
      updateHouse,
      updateParticipant,
      addParticipant,
      updateHousePoints,
      pointsHistory,
      findAdminEventByName,
      isRegistrationAllowed,
      isCheckInAllowed,
      settings,
      updateSettings,
      refreshData
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}
