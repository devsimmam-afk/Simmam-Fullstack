import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let _adminSupabase: SupabaseClient | null = null

if (url && anonKey) {
  _adminSupabase = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: true,
    },
  })
} else {
  // eslint-disable-next-line no-console
  console.warn('VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing; admin Supabase client will use noop fallback')
}

const noopAdmin: any = {
  auth: {
    getSession: async () => ({ data: null, error: null }),
    getUser: async () => ({ data: null, error: null }),
    onAuthStateChange: (_cb: any) => ({ data: null, subscription: { unsubscribe: () => {} } }),
    signOut: async () => ({ error: null }),
    signInWithOAuth: async () => ({ error: null }),
  },
  from: (_table: string) => ({
    async select() { return { data: null, error: null } },
    async upsert() { return { data: null, error: null } },
    async insert() { return { data: null, error: null } },
    async delete() { return { data: null, error: null } },
    order() { return this },
    eq() { return this },
    maybeSingle() { return { data: null, error: null } },
  }),
}

export const adminSupabase = _adminSupabase ?? (noopAdmin as unknown as SupabaseClient)

export default adminSupabase
