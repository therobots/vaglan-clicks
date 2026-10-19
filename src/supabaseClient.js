import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
const hasConfiguredCredentials = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !/^your[-_ ]/i.test(supabaseUrl) &&
    !/^your[-_ ]/i.test(supabaseAnonKey),
)
const hasValidUrl = (() => {
  if (!hasConfiguredCredentials || !supabaseUrl) return false
  try {
    const parsedUrl = new URL(supabaseUrl)
    return ['http:', 'https:'].includes(parsedUrl.protocol) && Boolean(parsedUrl.host)
  } catch {
    return false
  }
})()

export const isSupabaseConfigured = hasValidUrl

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null
