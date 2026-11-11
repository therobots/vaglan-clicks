import { createHash } from 'node:crypto'

export const CACHE_CONTROL = 'public, s-maxage=5, stale-while-revalidate=30'
const ALBUM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const ALLOWED_QUERY_KEYS = {
  bootstrap: new Set(['album']),
  feed: new Set(['album', 'night', 'slot', 'limit', 'before', 'after']),
}

export class RequestValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RequestValidationError'
  }
}

export class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.name = 'UpstreamError'
    this.status = status
  }
}

export function readQuery(req, kind) {
  const allowed = ALLOWED_QUERY_KEYS[kind]
  if (!allowed) throw new Error(`Unknown gallery endpoint: ${kind}`)
  const url = new URL(req.url || '/', 'https://gallery.invalid')
  const params = url.searchParams
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      throw new RequestValidationError(`Invalid ${key} parameter.`)
    }
  }
  const album = params.has('album') ? params.get('album') : 'general'
  if (!ALBUM_PATTERN.test(album)) throw new RequestValidationError('Invalid album parameter.')
  return { params, album }
}

export function validateNight(value) {
  if (!DATE_PATTERN.test(value)) throw new RequestValidationError('Invalid night parameter.')
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RequestValidationError('Invalid night parameter.')
  }
  return value
}

export function validateLimit(value) {
  if (value === null) return 48
  if (!/^\d{1,3}$/.test(value)) throw new RequestValidationError('Invalid limit parameter.')
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RequestValidationError('Limit must be between 1 and 100.')
  }
  return limit
}

export function validateSlot(value) {
  if (value === null) return null
  if (!/^\d{1,16}$/.test(value)) throw new RequestValidationError('Invalid slot parameter.')
  const slot = Number(value)
  if (!Number.isSafeInteger(slot) || slot < 0) {
    throw new RequestValidationError('Invalid slot parameter.')
  }
  return slot
}

export function validateCursor(value, name) {
  if (value === null) return null
  const separator = value.indexOf(':')
  if (separator <= 0 || separator !== value.lastIndexOf(':')) {
    throw new RequestValidationError(`Invalid ${name} cursor.`)
  }
  const timestampText = value.slice(0, separator)
  const id = value.slice(separator + 1)
  if (!/^\d{1,16}$/.test(timestampText) || !UUID_PATTERN.test(id)) {
    throw new RequestValidationError(`Invalid ${name} cursor.`)
  }
  const timestamp = Number(timestampText)
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new RequestValidationError(`Invalid ${name} cursor.`)
  }
  return { timestamp, id }
}

export function getSupabaseCredentials() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !anonKey) {
    throw new UpstreamError('Gallery API server configuration is incomplete.', 503)
  }
  let parsedUrl
  try {
    parsedUrl = new URL(supabaseUrl)
  } catch {
    throw new UpstreamError('Gallery API Supabase URL is invalid.', 503)
  }
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
    throw new UpstreamError('Gallery API Supabase URL must use HTTP or HTTPS.', 503)
  }
  return { supabaseUrl: parsedUrl.origin, anonKey }
}

export async function supabaseRequest(path, { method = 'GET', body } = {}) {
  const { supabaseUrl, anonKey } = getSupabaseCredentials()
  let response
  try {
    response = await fetch(new URL(path, `${supabaseUrl}/`), {
      method,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    })
  } catch (error) {
    throw new UpstreamError(`Could not reach Supabase: ${error.message}`)
  }
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new UpstreamError('Supabase returned an invalid response.')
  }
  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : `HTTP ${response.status}`
    throw new UpstreamError(`Supabase request failed: ${message}`)
  }
  return data
}

export const rpc = (name, args) =>
  supabaseRequest(`rest/v1/rpc/${name}`, { method: 'POST', body: args })

export async function readPricing() {
  const params = new URLSearchParams({
    select: 'first_photo_cents,extra_photo_cents,tip_options_cents,currency',
    id: 'eq.1',
    limit: '1',
  })
  const rows = await supabaseRequest(`rest/v1/gallery_state?${params}`)
  if (!Array.isArray(rows) || !rows[0]) {
    throw new UpstreamError('Gallery pricing is unavailable.')
  }
  return rows[0]
}

export function sendJson(res, status, payload, headers = {}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
  res.end(JSON.stringify(payload))
}

export function sendCachedJson(req, res, payload) {
  const body = JSON.stringify(payload)
  const etag = `"${createHash('sha256').update(body).digest('hex')}"`
  const headers = { 'Cache-Control': CACHE_CONTROL, ETag: etag }
  const requestedEtags = req.headers?.['if-none-match']
  const ifNoneMatch = Array.isArray(requestedEtags) ? requestedEtags.join(',') : requestedEtags || ''
  const matches = ifNoneMatch
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === '*' || value === etag)
  res.statusCode = matches ? 304 : 200
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
  if (matches) {
    res.end()
    return
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(body)
}

export function sendError(res, error) {
  const status = error instanceof RequestValidationError
    ? 400
    : Number.isInteger(error?.status) ? error.status : 500
  if (status >= 500) console.error('Gallery API request failed:', error)
  sendJson(res, status, { error: error.message || 'Gallery request failed.' }, {
    'Cache-Control': 'no-store',
  })
}

export function methodNotAllowed(res) {
  sendJson(res, 405, { error: 'Method not allowed.' }, {
    Allow: 'GET',
    'Cache-Control': 'no-store',
  })
}
