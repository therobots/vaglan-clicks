import { parseTimestamp } from './timeBuckets.js'

export function mergePhotoPages(current, incoming) {
  const photosById = new Map(current.map((photo) => [photo.id, photo]))
  for (const photo of incoming) {
    photosById.set(photo.id, photo)
  }
  return [...photosById.values()].sort((left, right) => {
    const timestampDifference = parseTimestamp(right.timestamp) - parseTimestamp(left.timestamp)
    if (timestampDifference !== 0) return timestampDifference
    return String(right.id).localeCompare(String(left.id))
  })
}
