import {
  methodNotAllowed,
  readPricing,
  readQuery,
  rpc,
  sendCachedJson,
  sendError,
} from '../server/galleryApi.js'

const minuteBucket = (value) => {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error('Gallery server clock returned an invalid time.')
  return new Date(Math.round(timestamp / 60000) * 60000).toISOString()
}

export default async function bootstrap(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res)
  try {
    const { album } = readQuery(req, 'bootstrap')
    const [nights, serverNow, pricing, hiddenRows, restoredRows] = await Promise.all([
      rpc('gallery_nights', { album_id_input: album }),
      rpc('gallery_server_now', {}),
      readPricing(),
      rpc('gallery_recently_hidden', { album_id_input: album }),
      rpc('gallery_recently_restored', { album_id_input: album }),
    ])
    if (!Array.isArray(nights)) throw new Error('Gallery nights returned an invalid response.')
    const newestNight = nights[0]?.night_key || null
    const [slots, latestRows] = newestNight
      ? await Promise.all([
          rpc('gallery_slots', {
            album_id_input: album,
            night_key_input: newestNight,
          }),
          rpc('gallery_photos', {
            album_id_input: album,
            night_key_input: newestNight,
            slot_start_input: null,
            slot_end_input: null,
            before_timestamp_input: null,
            before_photo_id_input: null,
            limit_input: 1,
            after_timestamp_input: null,
            after_photo_id_input: null,
          }),
        ])
      : [[], []]
    if (!Array.isArray(slots) || !Array.isArray(latestRows)) {
      throw new Error('Gallery bootstrap RPC returned an invalid response.')
    }
    sendCachedJson(req, res, {
      serverNow: minuteBucket(serverNow),
      nights,
      slots,
      pricing,
      latest: latestRows[0]
        ? { timestamp: latestRows[0].timestamp, id: latestRows[0].id }
        : null,
      hiddenIds: hiddenRows.map((row) => row.photo_id),
      restoredIds: restoredRows.map((row) => row.photo_id),
    })
  } catch (error) {
    sendError(res, error)
  }
}
