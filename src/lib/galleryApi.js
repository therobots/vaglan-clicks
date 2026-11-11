import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from '@/lib/supabaseConfig'

const parseError = async (response, fallback) => {
  try {
    const payload = await response.clone().json()
    if (typeof payload?.error === 'string') return payload.error
  } catch {
    return fallback
  }
  return fallback
}

export async function fetchCachedJson(path, etag = '', signal) {
  const response = await fetch(path, {
    cache: 'no-store',
    headers: etag ? { 'If-None-Match': etag } : {},
    signal,
  })
  if (response.status === 304) {
    return { data: null, etag: response.headers.get('etag') || etag, notModified: true }
  }
  if (!response.ok) {
    const message = await parseError(response, `Gallery request failed (${response.status}).`)
    throw Object.assign(new Error(message), { context: response })
  }
  let data
  try {
    data = await response.json()
  } catch {
    throw new Error('The gallery service returned invalid JSON.')
  }
  return { data, etag: response.headers.get('etag') || '', notModified: false }
}

export async function invokeEdgeFunction(name, body) {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured.')
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let data
  try {
    data = await response.json()
  } catch {
    throw new Error(`The ${name} service returned invalid JSON.`)
  }
  if (!response.ok || data?.error) {
    throw Object.assign(
      new Error(data?.error || `The ${name} request failed (${response.status}).`),
      { context: response },
    )
  }
  return data
}

export function galleryBootstrapPath(album) {
  const params = new URLSearchParams({ album })
  return `/api/bootstrap?${params}`
}

export function galleryFeedPath({ album, night, slot, limit = 48, before, after }) {
  const params = new URLSearchParams({ album, night, limit: String(limit) })
  if (slot !== null && slot !== undefined) params.set('slot', String(slot))
  if (before) params.set('before', `${before.timestamp}:${before.id}`)
  if (after) params.set('after', `${after.timestamp}:${after.id}`)
  return `/api/feed?${params}`
}
