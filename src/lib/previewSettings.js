const readIntegerSetting = (name, value, fallback, minimum, maximum = Number.POSITIVE_INFINITY) => {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return parsed
}

export const PREVIEW_MAX_DIMENSION = readIntegerSetting(
  'VITE_PREVIEW_MAX_DIMENSION',
  import.meta.env.VITE_PREVIEW_MAX_DIMENSION,
  1080,
  1,
)
export const PREVIEW_QUALITY = readIntegerSetting(
  'VITE_PREVIEW_QUALITY',
  import.meta.env.VITE_PREVIEW_QUALITY,
  60,
  1,
  100,
)
export const THUMB_MAX_DIMENSION = readIntegerSetting(
  'VITE_THUMB_MAX_DIMENSION',
  import.meta.env.VITE_THUMB_MAX_DIMENSION,
  300,
  1,
)
export const THUMB_QUALITY = readIntegerSetting(
  'VITE_THUMB_QUALITY',
  import.meta.env.VITE_THUMB_QUALITY,
  60,
  1,
  100,
)
