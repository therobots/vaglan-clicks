import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
const hasValidUrl = (() => {
  if (!supabaseUrl) return false
  try {
    return ['http:', 'https:'].includes(new URL(supabaseUrl).protocol)
  } catch {
    return false
  }
})()

export const isSupabaseConfigured = Boolean(
  hasValidUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('your-project-id') &&
    !supabaseAnonKey.includes('your-anon-public-key')
)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null
