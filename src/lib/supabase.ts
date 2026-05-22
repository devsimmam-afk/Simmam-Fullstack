import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let _supabase: SupabaseClient | null = null

if (url && anonKey) {
  _supabase = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
} else {
  // eslint-disable-next-line no-console
  console.warn('VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing; Supabase client will use noop fallback')
}

// Minimal noop client to avoid SSR import-time failures. Methods return resolved shapes
// similar to supabase-js so calling code can run safely during SSR when envs are absent.
const noopSupabase: any = {
  auth: {
    getSession: async () => ({ data: null, error: null }),
    getUser: async () => ({ data: null, error: null }),
    onAuthStateChange: (_cb: any) => ({ data: null, subscription: { unsubscribe: () => {} } }),
    signOut: async () => ({ error: null }),
    signInWithOAuth: async () => ({ error: null }),
  },
  from: (_table: string) => {
    const chain: any = {
      async select() { return { data: null, error: null } },
      async insert() { return { data: null, error: null } },
      async upsert() { return { data: null, error: null } },
      async delete() { return { data: null, error: null } },
      async maybeSingle() { return { data: null, error: null } },
      async single() { return { data: null, error: null } },
      order() { return chain },
      eq() { return chain },
      ilike() { return chain },
      in() { return chain },
      limit() { return chain },
      gte() { return chain },
    }
    return chain
  },
}

export const supabase = _supabase ?? (noopSupabase as unknown as SupabaseClient)

export default supabase
