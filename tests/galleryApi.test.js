import test from 'node:test'
import assert from 'node:assert/strict'
import bootstrap from '../api/bootstrap.js'
import feed from '../api/feed.js'
import {
  CACHE_CONTROL,
  RequestValidationError,
  readQuery,
  validateCursor,
  validateLimit,
  validateNight,
} from '../server/galleryApi.js'

const makeResponse = (requestHeaders = {}) => {
  const headers = new Map()
  return {
    headers,
    statusCode: 0,
    body: undefined,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value)
    },
    end(body) {
      this.body = body
    },
    requestHeaders,
  }
}

const makeRequest = (url, headers = {}, method = 'GET') => ({
  method,
  url,
  headers,
})

test('gallery API validates album, night, cursors, and bounded limits', () => {
  assert.equal(readQuery(makeRequest('/api/bootstrap?album=A_42-x'), 'bootstrap').album, 'A_42-x')
  assert.throws(
    () => readQuery(makeRequest('/api/bootstrap?album=bad%2Fvalue'), 'bootstrap'),
    RequestValidationError,
  )
  assert.throws(
    () => readQuery(makeRequest('/api/bootstrap?album=a&album=b'), 'bootstrap'),
    RequestValidationError,
  )
  assert.equal(validateNight('2026-11-11'), '2026-11-11')
  assert.throws(() => validateNight('2026-02-30'), RequestValidationError)
  assert.equal(validateLimit(null), 48)
  assert.equal(validateLimit('100'), 100)
  assert.throws(() => validateLimit('101'), RequestValidationError)
  assert.throws(() => validateLimit('1.5'), RequestValidationError)
  assert.deepEqual(
    validateCursor('1794400000000:00000000-0000-4000-8000-000000000001', 'before'),
    { timestamp: 1794400000000, id: '00000000-0000-4000-8000-000000000001' },
  )
  assert.throws(() => validateCursor('abc:not-a-uuid', 'after'), RequestValidationError)
})

test('bootstrap returns cacheable JSON with a strong ETag and supports conditional requests', async () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.SUPABASE_URL
  const originalKey = process.env.SUPABASE_ANON_KEY
  const calls = []
  let clockReads = 0
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'test-anon-key'
  globalThis.fetch = async (input, options) => {
    const url = new URL(input)
    calls.push(url.pathname)
    if (url.pathname.endsWith('/gallery_state')) {
      return Response.json([{
        first_photo_cents: 200,
        extra_photo_cents: 50,
        tip_options_cents: [0, 100, 200, 300],
        currency: 'EUR',
      }])
    }
    if (url.pathname.endsWith('/gallery_nights')) {
      return Response.json([{ night_key: '2026-11-11' }])
    }
    if (url.pathname.endsWith('/gallery_server_now')) {
      return Response.json(clockReads++ === 0
        ? '2026-11-11T12:00:04Z'
        : '2026-11-11T12:00:24Z')
    }
    if (url.pathname.endsWith('/gallery_recently_hidden')) {
      return Response.json([{ photo_id: '00000000-0000-4000-8000-000000000002' }])
    }
    if (url.pathname.endsWith('/gallery_recently_restored')) {
      return Response.json([{ photo_id: '00000000-0000-4000-8000-000000000003' }])
    }
    if (url.pathname.endsWith('/gallery_slots')) return Response.json([])
    if (url.pathname.endsWith('/gallery_photos')) {
      return Response.json([{ id: '00000000-0000-4000-8000-000000000001', timestamp: 1 }])
    }
    assert.fail(`Unexpected upstream URL: ${url}`)
  }

  try {
    const response = makeResponse()
    await bootstrap(makeRequest('/api/bootstrap?album=A_42'), response)
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers.get('cache-control'), CACHE_CONTROL)
    assert.match(response.headers.get('etag'), /^"[a-f0-9]{64}"$/)
    const payload = JSON.parse(response.body)
    assert.equal(payload.nights[0].night_key, '2026-11-11')
    assert.equal(payload.latest.id, '00000000-0000-4000-8000-000000000001')
    assert.equal(payload.serverNow, '2026-11-11T12:00:00.000Z')
    assert.deepEqual(payload.hiddenIds, ['00000000-0000-4000-8000-000000000002'])
    assert.deepEqual(payload.restoredIds, ['00000000-0000-4000-8000-000000000003'])
    assert.ok(calls.every((path) => !path.endsWith('/photos')))

    const unchanged = makeResponse()
    await bootstrap(
      makeRequest('/api/bootstrap?album=A_42', { 'if-none-match': response.headers.get('etag') }),
      unchanged,
    )
    assert.equal(unchanged.statusCode, 304)
    assert.equal(unchanged.body, undefined)
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY
    else process.env.SUPABASE_ANON_KEY = originalKey
  }
})

test('feed rejects invalid inputs before any upstream database request', async () => {
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    throw new Error('Invalid request must not reach Supabase.')
  }
  try {
    const response = makeResponse()
    await feed(makeRequest('/api/feed?album=general&night=2026-02-30&limit=48'), response)
    assert.equal(response.statusCode, 400)
    assert.equal(requests, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('feed forwards only validated cursor and slot parameters to gallery RPCs', async () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.SUPABASE_URL
  const originalKey = process.env.SUPABASE_ANON_KEY
  const calls = []
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'test-anon-key'
  globalThis.fetch = async (input, options) => {
    const url = new URL(input)
    const body = options.body ? JSON.parse(options.body) : null
    calls.push({ path: url.pathname, body })
    if (url.pathname.endsWith('/gallery_slots')) {
      return Response.json([{
        slot_start: '2026-11-11T10:00:00.000Z',
        slot_end: '2026-11-11T10:30:00.000Z',
      }])
    }
    if (url.pathname.endsWith('/gallery_recently_hidden')) return Response.json([])
    if (url.pathname.endsWith('/gallery_photos')) return Response.json([])
    assert.fail(`Unexpected upstream URL: ${url}`)
  }

  try {
    const response = makeResponse()
    const cursor = '1794391200000:00000000-0000-4000-8000-000000000001'
    await feed(
      makeRequest(`/api/feed?album=general&night=2026-11-11&slot=1794391200000&limit=48&after=${cursor}`),
      response,
    )
    assert.equal(response.statusCode, 200)
    const photoCall = calls.find(({ path }) => path.endsWith('/gallery_photos'))
    assert.equal(photoCall.body.after_timestamp_input, 1794391200000)
    assert.equal(photoCall.body.after_photo_id_input, '00000000-0000-4000-8000-000000000001')
    assert.equal(photoCall.body.slot_end_input, '2026-11-11T10:30:00.000Z')
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY
    else process.env.SUPABASE_ANON_KEY = originalKey
  }
})
