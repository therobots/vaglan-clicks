export const DEFAULT_ALBUM_ID = 'general';
export const ALBUM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function validateAlbumId(value) {
  if (typeof value !== 'string') {
    throw new Error('Album ID must be a string.');
  }

  const normalized = value.trim();
  if (!normalized || !ALBUM_ID_PATTERN.test(normalized)) {
    throw new Error('Invalid album ID. Use letters, numbers, hyphens, or underscores only.');
  }

  return normalized;
}

export function normalizeAlbumId(value, fallback = DEFAULT_ALBUM_ID) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return validateAlbumId(value);
  } catch {
    return fallback;
  }
}

export function parseAlbumParam(rawUrl, trustedBaseUrl = null) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl, trustedBaseUrl || undefined);
  } catch {
    return null;
  }

  const values = parsedUrl.searchParams.getAll('album');
  if (values.length !== 1) return null;

  const album = values[0]?.trim();
  if (!album) return null;

  try {
    const candidate = validateAlbumId(album);
    if (trustedBaseUrl) {
      const trusted = new URL(trustedBaseUrl);
      if (parsedUrl.origin !== trusted.origin) return null;

      if (trusted.pathname) {
        const normalizedTrustedPath = trusted.pathname.replace(/\/+$/, '') || '/';
        const exactMatches = new Set([trusted.pathname, normalizedTrustedPath]);
        const prefixMatches = trusted.pathname !== '/' && parsedUrl.pathname.startsWith(`${normalizedTrustedPath}/`);

        if (!exactMatches.has(parsedUrl.pathname) && !prefixMatches) {
          return null;
        }
      }
    }
    return candidate;
  } catch {
    return null;
  }
}

export function readAlbumFromSearch(searchString = '', fallback = DEFAULT_ALBUM_ID) {
  if (typeof searchString !== 'string') return fallback;
  const params = new URLSearchParams(searchString.startsWith('?') ? searchString.slice(1) : searchString);
  const values = params.getAll('album');
  if (values.length !== 1) return fallback;
  const album = values[0]?.trim();
  if (!album) return fallback;
  try {
    return validateAlbumId(album);
  } catch {
    return fallback;
  }
}

export function buildGalleryAlbumUrl(baseUrl, albumId) {
  const safeAlbum = validateAlbumId(albumId);
  const parsed = new URL(baseUrl);
  parsed.searchParams.set('album', safeAlbum);
  return parsed.toString();
}
