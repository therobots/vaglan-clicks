export function previewUrl(photo, album, size = 'thumbnail') {
  if (!photo?.id || !album || !['thumbnail', 'preview'].includes(size)) return ''
  const params = new URLSearchParams({ id: photo.id, album, size })
  return `/api/preview?${params}`
}
