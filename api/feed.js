import {
  methodNotAllowed,
  readQuery,
  RequestValidationError,
  rpc,
  sendCachedJson,
  sendError,
  validateCursor,
  validateLimit,
  validateNight,
  validateSlot,
} from '../server/galleryApi.js'

const milliseconds = (value) => {
  const numeric = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(numeric)) throw new Error('Gallery slot returned an invalid start time.')
  return numeric
}

export default async function feed(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res)
  try {
    const { params, album } = readQuery(req, 'feed')
    const night = validateNight(params.get('night') || '')
    const slot = validateSlot(params.get('slot'))
    const limit = validateLimit(params.get('limit'))
    const before = validateCursor(params.get('before'), 'before')
    const after = validateCursor(params.get('after'), 'after')
    if (before && after) {
      throw new RequestValidationError('Use either before or after pagination, not both.')
    }

    const [slots, hiddenRows] = await Promise.all([
      rpc('gallery_slots', { album_id_input: album, night_key_input: night }),
      rpc('gallery_recently_hidden', { album_id_input: album }),
    ])
    if (!Array.isArray(slots) || !Array.isArray(hiddenRows)) {
      throw new Error('Gallery feed metadata returned an invalid response.')
    }
    const selectedSlot = slot === null
      ? null
      : slots.find((item) => milliseconds(item.slot_start) === slot)
    if (slot !== null && !selectedSlot) {
      throw new RequestValidationError('The selected time slot is no longer available.')
    }

    const rows = await rpc('gallery_photos', {
      album_id_input: album,
      night_key_input: night,
      slot_start_input: selectedSlot?.slot_start || null,
      slot_end_input: selectedSlot?.slot_end || null,
      before_timestamp_input: before?.timestamp ?? null,
      before_photo_id_input: before?.id ?? null,
      limit_input: limit,
      after_timestamp_input: after?.timestamp ?? null,
      after_photo_id_input: after?.id ?? null,
    })
    if (!Array.isArray(rows)) throw new Error('Gallery photos returned an invalid response.')
    sendCachedJson(req, res, {
      photos: rows,
      slots,
      hiddenIds: hiddenRows.map((row) => row.photo_id),
    })
  } catch (error) {
    sendError(res, error)
  }
}
