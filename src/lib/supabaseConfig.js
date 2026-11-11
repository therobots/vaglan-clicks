export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''

const hasConfiguredCredentials = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !/^your[-_ ]/i.test(supabaseUrl) &&
    !/^your[-_ ]/i.test(supabaseAnonKey),
)

export const isSupabaseConfigured = (() => {
  if (!hasConfiguredCredentials) return false
  try {
    const parsedUrl = new URL(supabaseUrl)
    return ['http:', 'https:'].includes(parsedUrl.protocol) && Boolean(parsedUrl.host)
  } catch {
    return false
  }
})()
