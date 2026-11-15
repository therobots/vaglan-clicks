import { createClient } from '@supabase/supabase-js'

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const ALBUM = /^[A-Za-z0-9_-]{1,64}$/
const BUCKETS = new Set(['public-previews', 'previews', 'photos'])
const MAX_PREVIEW_BYTES = 8_000_000

export function previewPath(value, supabaseUrl) {
  if (typeof value !== 'string' || /\/(?:\.|%2e){1,2}(?:\/|$)/i.test(value)) return null
  let url
  try { url = new URL(value) } catch { return null }
  if (url.origin !== new URL(supabaseUrl).origin) return null
  const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/)
  if (!match || !BUCKETS.has(match[1])) return null
  try {
    const path = match[2].split('/').map(decodeURIComponent).join('/')
    if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) return null
    return { bucket: match[1], path }
  } catch { return null }
}

export function isVisiblePreview(photo, album, now = Date.now()) {
  return Boolean(photo && (photo.album_id || 'general') === album &&
    photo.watermark_baked && !photo.is_hidden &&
    Date.parse(photo.expires_at) > now)
}

const send = (res, status, message) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'private, no-store')
  res.end(JSON.stringify({ error: message }))
}

export default async function preview(req, res) {
  if (req.method !== 'GET') return send(res, 405, 'Method not allowed.')
  const url = new URL(req.url || '/', 'https://gallery.invalid')
  const params = url.searchParams
  if ([...params.keys()].some((key) => !['id', 'album', 'size'].includes(key) || params.getAll(key).length !== 1)) {
    return send(res, 400, 'Invalid preview request.')
  }
  const id = params.get('id') || ''
  const album = params.get('album') || ''
  const size = params.get('size') || ''
  if (!UUID.test(id) || !ALBUM.test(album) || !['preview', 'thumbnail'].includes(size)) {
    return send(res, 400, 'Invalid preview request.')
  }
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return send(res, 503, 'Preview service is not configured.')
  try {
    const client = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: photo, error } = await client.from('photos')
      .select('album_id, is_hidden, expires_at, watermark_baked, preview_url, thumbnail_url')
      .eq('id', id).maybeSingle()
    if (error) throw error
    if (!isVisiblePreview(photo, album)) return send(res, 404, 'Preview unavailable.')
    const object = previewPath(size === 'thumbnail' ? photo.thumbnail_url : photo.preview_url, supabaseUrl)
    if (!object) return send(res, 404, 'Preview unavailable.')
    const { data: blob, error: downloadError } = await client.storage.from(object.bucket).download(object.path)
    if (downloadError || !blob || blob.size > MAX_PREVIEW_BYTES) {
      return send(res, 404, 'Preview unavailable.')
    }
    const contentType = blob.type || 'application/octet-stream'
    if (!['image/webp', 'image/jpeg', 'image/png'].includes(contentType)) {
      return send(res, 502, 'Invalid preview content.')
    }
    res.statusCode = 200
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.end(Buffer.from(await blob.arrayBuffer()))
  } catch (error) {
    console.error('Preview request failed:', error)
    send(res, 502, 'Preview service is unavailable.')
  }
}
