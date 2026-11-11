import { parseTimestamp } from './timeBuckets.js'

export function comparePhotoCursor(left, right) {
  const timestampDifference = parseTimestamp(left.timestamp) - parseTimestamp(right.timestamp)
  if (timestampDifference < 0) return -1
  if (timestampDifference > 0) return 1
  const leftId = String(left.id).toLowerCase()
  const rightId = String(right.id).toLowerCase()
  if (leftId < rightId) return -1
  if (leftId > rightId) return 1
  return 0
}

export function mergePhotoPages(current, incoming) {
  const photosById = new Map(current.map((photo) => [photo.id, photo]))
  for (const photo of incoming) {
    photosById.set(photo.id, photo)
  }
  return [...photosById.values()].sort((left, right) => -comparePhotoCursor(left, right))
}
