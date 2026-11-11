import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GalleryFooter from '@/components/gallery/GalleryFooter'
import GalleryHeader from '@/components/gallery/GalleryHeader'
import LiveStatusPill from '@/components/gallery/LiveStatusPill'
import CartBar from '@/components/gallery/CartBar'
import ExpiryBanner from '@/components/gallery/ExpiryBanner'
import TimeFilterBar from '@/components/gallery/TimeFilterBar'
import GalleryTabs from '@/components/gallery/GalleryTabs'
import PhotoRemovalDialog from '@/components/gallery/PhotoRemovalDialog'
import PhotoCard from '@/components/gallery/PhotoCard'
import { isSupabaseConfigured } from '@/lib/supabaseConfig'
import {
  fetchCachedJson,
  galleryBootstrapPath,
  galleryFeedPath,
  invokeEdgeFunction,
} from '@/lib/galleryApi'
import { cacheCartSelection, readCartSelection, readCartTip } from '@/lib/orderSession'
import { edgeFunctionErrorMessage } from '@/lib/edgeFunctionError'
import {
  DEFAULT_FIRST_PRICE,
  EXTRA_PHOTO_PRICE,
  TIP_OPTIONS_CENTS,
  isAllowedTip,
  nextPhotoPrice,
  selectionSubtotal,
} from '@/lib/pricing'
import {
  athensHourKey,
  formatAthensDateTime,
  formatAthensHour,
  formatNightLabel,
  mapGallerySlots,
  parseTimestamp,
} from '@/lib/timeBuckets'
import {
  DEFAULT_ALBUM_ID,
  readAlbumFromSearch,
  validateAlbumId,
} from '@/lib/album'
import { mergePhotoPages } from '@/lib/mergePhotoPages'
import {
  applyDocumentLanguage,
  galleryText,
  useGalleryLanguage,
} from '@/lib/galleryLanguage'

const PhotoLightbox = lazy(() => import('@/components/gallery/PhotoLightbox'))
const CheckoutSheet = lazy(() => import('@/components/gallery/CheckoutSheet'))
const Admin = lazy(() => import('@/pages/Admin'))
const Info = lazy(() => import('@/pages/Info'))
const Success = lazy(() => import('@/pages/Success'))

const CART_ID = 'public-gallery'
const PAGE_SIZE = 48
const NOTICE_KEY = 'vaglan-gallery-notice-dismissed'
const normalizePhotoRow = (photo) => ({
  ...photo,
  is_free: Boolean(photo?.is_free ?? false),
})
/** @param {unknown} value @returns {value is { first_photo_cents: number, extra_photo_cents: number, tip_options_cents: number[], currency: string }} */
const hasPricingSettings = (value) =>
  typeof value === 'object' &&
  value !== null &&
  'first_photo_cents' in value &&
  'extra_photo_cents' in value &&
  'tip_options_cents' in value &&
  'currency' in value

const groupPhotosByTime = (items) => {
  const groups = new Map()
  for (const photo of items) {
    const key = athensHourKey(photo.timestamp)
    if (!key) continue
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: `${formatAthensHour(photo.timestamp)}:00`,
        photos: [],
      })
    }
    groups.get(key).photos.push(photo)
  }
  return [...groups.values()].sort(
    (left, right) =>
      parseTimestamp(right.photos[0]?.timestamp) - parseTimestamp(left.photos[0]?.timestamp),
  )
}

function GalleryApp() {
  const language = useGalleryLanguage()
  const text = galleryText[language]
  const [selectedAlbum] = useState(() => {
    const album = readAlbumFromSearch(window.location.search || '', DEFAULT_ALBUM_ID)
    return validateAlbumId(album)
  })
  const cartKey = `${CART_ID}:${selectedAlbum}`
  const [photos, setPhotos] = useState([])
  const [nights, setNights] = useState([])
  const [activeNight, setActiveNight] = useState('')
  const [slots, setSlots] = useState([])
  const [activeSlot, setActiveSlot] = useState(null)
  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => readCartSelection(cartKey))
  const [tipCents, setTipCents] = useState(() => readCartTip(cartKey))
  const [activePhoto, setActivePhoto] = useState(null)
  const [firstPhotoCents, setFirstPhotoCents] = useState(DEFAULT_FIRST_PRICE * 100)
  const [extraPhotoCents, setExtraPhotoCents] = useState(EXTRA_PHOTO_PRICE * 100)
  const [tipOptionsCents, setTipOptionsCents] = useState(TIP_OPTIONS_CENTS)
  const [currency, setCurrency] = useState('EUR')
  const [pricingConfigured, setPricingConfigured] = useState(false)
  const [schemaNotice, setSchemaNotice] = useState('')
  const [serverOffsetMs, setServerOffsetMs] = useState(0)
  const [downloadingPhotoId, setDownloadingPhotoId] = useState(null)
  const [downloadError, setDownloadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMoreError, setLoadingMoreError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutMounted, setCheckoutMounted] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [noticeDismissed, setNoticeDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(NOTICE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [removalPhoto, setRemovalPhoto] = useState(null)
  const [removalBusy, setRemovalBusy] = useState(false)
  const [removalError, setRemovalError] = useState('')
  const [removalNotice, setRemovalNotice] = useState('')
  const pageRequestId = useRef(0)
  const photosRef = useRef(photos)
  const galleryViewRef = useRef({ selectedAlbum, activeNight, activeSlot })
  galleryViewRef.current = { selectedAlbum, activeNight, activeSlot }
  const loadMoreSentinelRef = useRef(null)
  const loadingMoreLockRef = useRef(false)
  const bootstrapEtagRef = useRef('')
  const latestPhotoRef = useRef(null)
  const feedCacheRef = useRef(new Map())
  const restoredPhotoIdsRef = useRef(new Map())
  const loadPhotoPageRef = useRef(null)

  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  useEffect(() => {
    applyDocumentLanguage(language)
  }, [language])

  useEffect(() => {
    cacheCartSelection(cartKey, selectedIds, tipCents)
  }, [cartKey, selectedIds, tipCents])

  useEffect(() => {
    if (!activePhoto) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setActivePhoto(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activePhoto])

  useEffect(() => {
    setSelectedIds(readCartSelection(cartKey))
    setTipCents(readCartTip(cartKey))
    setPhotos([])
    setNights([])
    setSlots([])
    setActiveNight('')
    setActiveSlot(null)
    setNextCursor(null)
    setHasMore(false)
    setLoading(true)
    setLoadingMore(false)
    setLoadError('')
    setLoadingMoreError('')
  }, [cartKey])

  const loadPhotoPage = useCallback(
    async ({
      append = false,
      prepend = false,
      beforeTimestamp = null,
      beforePhotoId = null,
      afterTimestamp = null,
      afterPhotoId = null,
      night = activeNight,
      slot = activeSlot,
    } = {}) => {
      const requestId = ++pageRequestId.current
      if (!isSupabaseConfigured || !night || document.visibilityState !== 'visible') {
        setPhotos([])
        setHasMore(false)
        setNextCursor(null)
        setLoading(false)
        setLoadingMore(false)
        return
      }

      if (append) {
        setLoadingMore(true)
        setLoadingMoreError('')
      } else {
        if (!prepend) {
          loadingMoreLockRef.current = false
          setLoading(true)
          setLoadingMore(false)
          setLoadingMoreError('')
          setHasMore(false)
          setNextCursor(null)
          setPhotos([])
          setLoadError('')
        }
      }
      const path = galleryFeedPath({
        album: selectedAlbum,
        night,
        slot: slot?.slot ?? null,
        limit: PAGE_SIZE,
        before: beforeTimestamp === null
          ? null
          : { timestamp: beforeTimestamp, id: beforePhotoId },
        after: afterTimestamp === null
          ? null
          : { timestamp: afterTimestamp, id: afterPhotoId },
      })
      try {
        const cached = feedCacheRef.current.get(path)
        const result = await fetchCachedJson(path, cached?.etag || '')
        const payload = result.notModified ? cached?.data : result.data
        if (!payload || !Array.isArray(payload.photos) || !Array.isArray(payload.slots)) {
          throw new Error('The gallery feed returned an invalid response.')
        }
        if (!result.notModified) {
          feedCacheRef.current.set(path, { etag: result.etag, data: payload })
          if (feedCacheRef.current.size > 100) {
            feedCacheRef.current.delete(feedCacheRef.current.keys().next().value)
          }
        }
        if (requestId !== pageRequestId.current) return
        const hiddenIds = new Set(payload.hiddenIds || [])
        const rows = payload.photos
          .filter((photo) => !hiddenIds.has(photo.id))
          .map(normalizePhotoRow)
        setSlots(mapGallerySlots(payload.slots))
        setPhotos((current) => {
          const visibleCurrent = current.filter((photo) => !hiddenIds.has(photo.id))
          if (prepend) return mergePhotoPages(visibleCurrent, rows)
          return append ? [...visibleCurrent, ...rows] : rows
        })
        if (!append && !prepend) {
          setActivePhoto((current) =>
            current && !rows.some((photo) => photo.id === current.id) ? null : current,
          )
        }
        if (!prepend) {
          const lastPhoto = rows[rows.length - 1]
          setNextCursor((current) =>
            lastPhoto
              ? prepend ? current : { timestamp: lastPhoto.timestamp, id: lastPhoto.id }
              : append ? current : null,
          )
          if (!prepend) setHasMore(rows.length === PAGE_SIZE)
        }
        setSelectedIds((current) =>
          current.filter(
            (id) => !hiddenIds.has(id) && !rows.some((photo) => photo.id === id && photo.is_free),
          ),
        )
        setLoadError('')
        setLoading(false)
        setLoadingMore(false)
      } catch (error) {
        if (requestId !== pageRequestId.current) return
        const message = `Could not load photos: ${error.message || 'Unknown error'}`
        if (append) setLoadingMoreError(message)
        else if (!prepend) setLoadError(message)
        setConnectionStatus('offline')
        setLoading(false)
        setLoadingMore(false)
        return
      }
    },
    [activeNight, activeSlot, selectedAlbum],
  )
  loadPhotoPageRef.current = loadPhotoPage

  const loadNextPhotoPage = useCallback(async () => {
    if (loadingMoreLockRef.current || !hasMore || !nextCursor) return
    loadingMoreLockRef.current = true
    try {
      await loadPhotoPage({
        append: true,
        beforeTimestamp: nextCursor.timestamp,
        beforePhotoId: nextCursor.id,
      })
    } finally {
      loadingMoreLockRef.current = false
    }
  }, [hasMore, loadPhotoPage, nextCursor])

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current
    if (!sentinel || !hasMore || !activeNight || loadingMoreError) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadNextPhotoPage()
        }
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [activeNight, hasMore, loadMoreSentinelRef, loadingMoreError, loadNextPhotoPage])

  useEffect(() => {
    let active = true
    let timeout = null
    let controller = null
    let pollRequestId = 0
    let intervalMs = 17500
    let initialized = false
    const resetAlbumBootstrap = () => {
      bootstrapEtagRef.current = ''
      latestPhotoRef.current = null
      feedCacheRef.current.clear()
      restoredPhotoIdsRef.current.clear()
      initialized = false
    }

    resetAlbumBootstrap()
    if (!isSupabaseConfigured) {
      setLoadError(
        'Gallery is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect Supabase.',
      )
      setConnectionStatus('offline')
      setLoading(false)
      return undefined
    }

    const applyBootstrap = (payload) => {
      if (!Array.isArray(payload.nights) || !Array.isArray(payload.slots)) {
        throw new Error('The gallery bootstrap returned invalid navigation data.')
      }
      const loadedNights = payload.nights
      setNights(loadedNights)
      setActiveNight((current) =>
        loadedNights.some((night) => night.night_key === current)
          ? current
          : loadedNights[0]?.night_key || '',
      )
      const currentNight = galleryViewRef.current.activeNight
      if (!currentNight || currentNight === loadedNights[0]?.night_key) {
        setSlots(mapGallerySlots(payload.slots))
      }
      if (currentNight && !loadedNights.some((night) => night.night_key === currentNight)) {
        setActiveSlot(null)
        setActivePhoto(null)
      }
      const serverNow = parseTimestamp(payload.serverNow)
      if (Number.isFinite(serverNow)) setServerOffsetMs(serverNow - Date.now())
      const pricingData = hasPricingSettings(payload.pricing) ? payload.pricing : null
      const firstPrice = Number(pricingData?.first_photo_cents)
      const extraPrice = Number(pricingData?.extra_photo_cents)
      const configuredTips = pricingData?.tip_options_cents
      const validTips =
        Array.isArray(configuredTips) &&
        configuredTips.length === TIP_OPTIONS_CENTS.length &&
        configuredTips.every((tip, index) => tip === TIP_OPTIONS_CENTS[index])
      const validPricing =
        Number.isSafeInteger(firstPrice) &&
        firstPrice > 0 &&
        Number.isSafeInteger(extraPrice) &&
        extraPrice >= 0 &&
        validTips &&
        pricingData?.currency === 'EUR'
      setPricingConfigured(Boolean(validPricing))
      if (validPricing) {
        setSchemaNotice('')
        setFirstPhotoCents(firstPrice)
        setExtraPhotoCents(extraPrice)
        setTipOptionsCents(configuredTips)
        setCurrency('EUR')
        setTipCents((current) => (isAllowedTip(current, configuredTips) ? current : 0))
      } else {
        setSchemaNotice('Server-side photo pricing is unavailable. Secure checkout is disabled.')
      }
      if (Array.isArray(payload.hiddenIds)) {
        const hiddenIds = new Set(payload.hiddenIds)
        if (hiddenIds.size) {
          setPhotos((current) => current.filter((photo) => !hiddenIds.has(photo.id)))
          setSelectedIds((current) => current.filter((id) => !hiddenIds.has(id)))
          setActivePhoto((current) => current && hiddenIds.has(current.id) ? null : current)
        }
      }
      setConnectionStatus('live')
      setLoadError('')
    }

    const scheduleNext = () => {
      if (!active || document.visibilityState !== 'visible') return
      const jitteredDelay = intervalMs * (0.7 + Math.random() * 0.6)
      timeout = window.setTimeout(() => void pollBootstrap(), jitteredDelay)
    }
    const pollBootstrap = async () => {
      if (!active || document.visibilityState !== 'visible') return
      const requestId = ++pollRequestId
      controller = new AbortController()
      const startedAt = performance.now()
      try {
        const result = await fetchCachedJson(
          galleryBootstrapPath(selectedAlbum),
          bootstrapEtagRef.current,
          controller.signal,
        )
        if (!active) return
        if (!result.notModified) {
          const previousLatest = latestPhotoRef.current
          bootstrapEtagRef.current = result.etag
          applyBootstrap(result.data)
          latestPhotoRef.current = result.data.latest || null
          const currentView = galleryViewRef.current
          const newestNight = result.data.nights[0]?.night_key || ''
          const restoredIds = (result.data.restoredIds || []).filter((id) => {
            if (restoredPhotoIdsRef.current.has(id)) return false
            restoredPhotoIdsRef.current.set(id, Date.now())
            return true
          })
          for (const [photoId, seenAt] of restoredPhotoIdsRef.current) {
            if (Date.now() - seenAt > 2 * 60 * 1000) restoredPhotoIdsRef.current.delete(photoId)
          }
          if (initialized && restoredIds.length && currentView.activeNight) {
            void loadPhotoPageRef.current?.({
              prepend: true,
              night: currentView.activeNight,
              slot: currentView.activeSlot,
            })
          }
          if (
            initialized &&
            restoredIds.length === 0 &&
            previousLatest &&
            result.data.latest &&
            (previousLatest.timestamp !== result.data.latest.timestamp ||
              previousLatest.id !== result.data.latest.id) &&
            currentView.activeNight === newestNight
          ) {
            const newestLoadedPhoto = photosRef.current[0]
            if (newestLoadedPhoto) {
              void loadPhotoPageRef.current?.({
                prepend: true,
                afterTimestamp: newestLoadedPhoto.timestamp,
                afterPhotoId: newestLoadedPhoto.id,
                night: currentView.activeNight,
                slot: currentView.activeSlot,
              })
            }
          }
        }
        if (!initialized) {
          initialized = true
          setLoading(false)
        }
        setConnectionStatus('live')
        const duration = performance.now() - startedAt
        intervalMs = duration > 4000 ? Math.min(60000, intervalMs * 1.5) : 17500
        setLoadError('')
      } catch (error) {
        if (!active || error?.name === 'AbortError') return
        intervalMs = Math.min(60000, intervalMs * 1.5)
        setConnectionStatus('offline')
        setLoadError(`Could not refresh gallery: ${error.message || 'Unknown error'}`)
        if (!initialized) setLoading(false)
      } finally {
        if (requestId === pollRequestId) {
          controller = null
          scheduleNext()
        }
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        pollRequestId += 1
        if (timeout !== null) window.clearTimeout(timeout)
        timeout = null
        controller?.abort()
      } else {
        void pollBootstrap()
      }
    }

    if (document.visibilityState === 'visible') void pollBootstrap()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      active = false
      if (timeout !== null) window.clearTimeout(timeout)
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [selectedAlbum])

  const hidePhoto = useCallback((photoId) => {
    setPhotos((current) => current.filter((photo) => photo.id !== photoId))
    setSelectedIds((current) => current.filter((id) => id !== photoId))
    setActivePhoto((current) => (current?.id === photoId ? null : current))
  }, [])

  useEffect(() => {
    loadPhotoPage()
  }, [loadPhotoPage])

  const photoGroups = useMemo(() => groupPhotosByTime(photos), [photos])
  const selectedCount = selectedIds.length
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const activePhotoIndex = activePhoto ? photos.findIndex((photo) => photo.id === activePhoto.id) : -1
  const firstPhotoPrice = firstPhotoCents / 100
  const extraPhotoPrice = extraPhotoCents / 100
  const subtotal = selectionSubtotal(selectedCount, firstPhotoPrice, extraPhotoPrice)
  const safeTipCents = isAllowedTip(tipCents, tipOptionsCents) ? tipCents : 0
  const total = subtotal + safeTipCents / 100
  const formattedTotal = new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
  }).format(total)
  const activeNightData = nights.find((night) => night.night_key === activeNight)

  const toggleSelected = useCallback((photoId) => {
    setSelectedIds((current) =>
      current.includes(photoId)
        ? current.filter((selectedId) => selectedId !== photoId)
        : [...current, photoId],
    )
  }, [])

  const downloadFreePhoto = async (photo) => {
    if (!isSupabaseConfigured || !photo?.is_free) return
    setDownloadingPhotoId(photo.id)
    setDownloadError('')
    try {
      const data = await invokeEdgeFunction('gallery-admin', {
        action: 'download-free',
        photoId: photo.id,
      })
      if (!data?.url) throw new Error('The secure download link was not returned.')

      const anchor = document.createElement('a')
      anchor.href = data.url
      anchor.download = photo.filename || 'vaglan-clicks-photo'
      anchor.rel = 'noopener noreferrer'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } catch (error) {
      setDownloadError(error.message || 'Could not prepare the free photo download.')
    } finally {
      setDownloadingPhotoId(null)
    }
  }

  const requestPhotoRemoval = async ({ reason, contact }) => {
    if (!isSupabaseConfigured || !removalPhoto) return false
    setRemovalBusy(true)
    setRemovalError('')
    try {
      await invokeEdgeFunction('request-photo-removal', {
        photoId: removalPhoto.id,
        reason,
        contact,
      })
      hidePhoto(removalPhoto.id)
      setRemovalPhoto(null)
      setRemovalNotice(text.removalSent)
      return true
    } catch (error) {
      setRemovalError(await edgeFunctionErrorMessage(error, text.removalFailed))
      return false
    } finally {
      setRemovalBusy(false)
    }
  }

  const dismissNotice = () => {
    try {
      window.localStorage.setItem(NOTICE_KEY, 'true')
    } catch {
      setNoticeDismissed(true)
      return
    }
    setNoticeDismissed(true)
  }

  const startCheckout = async () => {
    if (!isSupabaseConfigured || selectedIds.length === 0) return
    setCheckoutBusy(true)
    setCheckoutError('')
    try {
      const data = await invokeEdgeFunction('create-viva-order', {
        photoIds: selectedIds,
        tipCents: safeTipCents,
      })
      let checkoutUrl
      try {
        checkoutUrl = new URL(data?.url)
      } catch {
        throw new Error('The secure Viva checkout link was not returned.')
      }
      if (
        checkoutUrl.protocol !== 'https:' ||
        !['www.vivapayments.com', 'demo.vivapayments.com'].includes(checkoutUrl.hostname) ||
        checkoutUrl.pathname !== '/web/checkout' ||
        !checkoutUrl.searchParams.has('ref')
      ) {
        throw new Error('The secure Viva checkout link was not returned.')
      }
      window.location.assign(checkoutUrl.toString())
    } catch (error) {
      setCheckoutError(
        await edgeFunctionErrorMessage(error, 'Could not open secure checkout. Please try again.'),
      )
    } finally {
      setCheckoutBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-white pb-24 font-sans text-neutral-900">
      <GalleryHeader photoCount={activeNightData?.photo_count}>
        <LiveStatusPill state={connectionStatus === 'live' ? 'live' : 'offline'} />
      </GalleryHeader>

      <main className="mx-auto max-w-3xl pt-16">
        <GalleryTabs active="photos" />
        {!noticeDismissed && (
          <aside className="flex items-start justify-between gap-4 border-b border-blue-100 bg-blue-50 px-4 py-3">
            <div>
              <h2 className="text-xs font-bold">{text.noticeTitle}</h2>
              <p className="mt-1 text-xs leading-5 text-neutral-700">{text.noticeText}</p>
              <a href="/info" className="mt-1 inline-block text-xs font-semibold underline">{text.photoInfo}</a>
            </div>
            <button type="button" onClick={dismissNotice} className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-bold">
              {text.dismiss}
            </button>
          </aside>
        )}
        {removalNotice && (
          <p role="status" className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-xs text-emerald-900">
            {removalNotice}
          </p>
        )}
        <ExpiryBanner
          expiresAt={activeNightData?.expires_at}
          serverOffsetMs={serverOffsetMs}
        />
        {schemaNotice && (
          <p role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
            {schemaNotice}
          </p>
        )}
        {nights.length > 1 && (
          <nav
            aria-label="Choose gallery night"
            className="flex gap-2 overflow-x-auto border-b border-gray-100 px-3 py-3"
          >
            {nights.map((night) => (
              <button
                key={night.night_key}
                type="button"
                aria-pressed={activeNight === night.night_key}
                onClick={() => {
                  setActivePhoto(null)
                  setActiveSlot(null)
                  setActiveNight(night.night_key)
                }}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  activeNight === night.night_key
                    ? 'border-neutral-900 bg-neutral-100 font-bold text-neutral-900'
                    : 'border-gray-200 bg-white text-neutral-600'
                }`}
              >
                {formatNightLabel(night.night_key)}
              </button>
            ))}
          </nav>
        )}

        {activeNight && (
          <>
            <TimeFilterBar
              slots={slots}
              activeSlot={activeSlot?.slot ?? null}
              onSelect={(slotNumber) =>
                {
                  setActivePhoto(null)
                  setActiveSlot(
                    slotNumber === null
                      ? null
                      : slots.find((slot) => slot.slot === slotNumber) || null,
                  )
                }
              }
            />
            <div className="flex items-center justify-end border-b border-gray-100 px-4 pb-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
                Jump to time
                <select
                  aria-label="Jump to time"
                  value={activeSlot?.slot ?? ''}
                  onChange={(event) => {
                    const nextSlot = slots.find(
                      (slot) => String(slot.slot) === event.target.value,
                    )
                    setActivePhoto(null)
                    setActiveSlot(nextSlot || null)
                  }}
                  className="max-w-36 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
                >
                  <option value="">All times</option>
                  {slots.map((slot) => (
                    <option key={`${slot.slot_start}-${slot.slot_minutes}`} value={slot.slot}>
                      {slot.label} · {slot.photo_count}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}

        {loadError && (
          <p role="alert" className="px-4 py-5 text-center text-sm text-red-700">
            {loadError}
          </p>
        )}

        {loading ? (
          <p role="status" className="py-20 text-center text-sm text-neutral-500">
            Loading photos…
          </p>
        ) : (
          <>
            {photoGroups.map((group, groupIndex) => (
              <section
                key={group.key}
                aria-label={`Photos at ${group.label} Athens time`}
                className="content-auto"
              >
                <h2 className="sticky top-16 z-20 border-y border-gray-100 bg-white px-4 py-2 text-xs font-bold text-neutral-600">
                  {group.label} Athens time
                </h2>
                <div className="grid grid-cols-3 gap-0.5 p-0.5">
                  {group.photos.map((photo, photoIndex) => {
                    const selected = selectedSet.has(photo.id)
                    return (
                      <article
                        key={photo.id}
                        className={`relative aspect-square overflow-hidden bg-gray-100 transition-shadow ${
                          selected ? 'ring-[2.5px] ring-inset ring-blue-600' : ''
                        }`}
                      >
                        <PhotoCard
                          photo={photo}
                          selected={selected}
                          fetchPriority={groupIndex === 0 && photoIndex < 3 ? 'high' : 'auto'}
                          onOpen={setActivePhoto}
                          onToggle={toggleSelected}
                        />
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
            {!loading && nights.length === 0 && !loadError && (
              <p className="px-4 py-16 text-center text-sm text-neutral-500">
                No photos are available yet.
              </p>
            )}
            {!loading && activeNight && photos.length === 0 && !loadError && (
              <p className="px-4 py-16 text-center text-sm text-neutral-500">
                No photos are available for this time yet.
              </p>
            )}
            {hasMore && (
              <div ref={loadMoreSentinelRef} className="px-4 py-6 text-center">
                {loadingMoreError && (
                  <p role="alert" className="mb-3 text-xs text-red-700">
                    {loadingMoreError}
                  </p>
                )}
                <button
                  type="button"
                  disabled={loadingMore || !nextCursor}
                  onClick={() => void loadNextPhotoPage()}
                  className="rounded-full border border-gray-300 px-4 py-2 text-xs font-bold disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : 'Load more photos'}
                </button>
              </div>
            )}
          </>
        )}

        <GalleryFooter language={language} />
      </main>

      <CartBar
        visible={selectedCount > 0}
        count={selectedCount}
        amount={total}
        currency={currency}
        onCheckout={() => {
          setCheckoutError('')
          setCheckoutMounted(true)
          window.requestAnimationFrame(() => setCheckoutOpen(true))
        }}
      />

      <Suspense fallback={null}>
        {checkoutMounted && (
          <CheckoutSheet
            open={checkoutOpen}
            count={selectedCount}
            subtotal={subtotal}
            tipCents={safeTipCents}
            tipOptionsCents={tipOptionsCents}
            total={total}
            currency={currency}
            busy={checkoutBusy}
            payError={checkoutError}
            onClose={() => setCheckoutOpen(false)}
            onTipChange={(nextTip) =>
              setTipCents(isAllowedTip(nextTip, tipOptionsCents) ? nextTip : 0)
            }
            onPay={startCheckout}
            checkoutEnabled={isSupabaseConfigured && pricingConfigured}
          />
        )}

        {activePhoto && activePhotoIndex >= 0 && (
          <PhotoLightbox
            photo={activePhoto}
            selected={selectedSet.has(activePhoto.id)}
            isFree={Boolean(activePhoto.is_free)}
            isDownloading={downloadingPhotoId === activePhoto.id}
            downloadError={downloadError}
            onDownloadFree={() => downloadFreePhoto(activePhoto)}
            price={nextPhotoPrice(selectedCount, firstPhotoPrice, extraPhotoPrice)}
            currency={currency}
            capturedAt={formatAthensDateTime(activePhoto.timestamp)}
            hasPrev={activePhotoIndex > 0}
            hasNext={activePhotoIndex < photos.length - 1}
            onPrev={() => setActivePhoto(photos[activePhotoIndex - 1])}
            onNext={() => setActivePhoto(photos[activePhotoIndex + 1])}
            onToggle={() => toggleSelected(activePhoto.id)}
            onRequestRemoval={() => {
              setRemovalPhoto(activePhoto)
              setRemovalError('')
            }}
            onClose={() => setActivePhoto(null)}
          />
        )}
      </Suspense>
      <PhotoRemovalDialog
        open={Boolean(removalPhoto)}
        language={language}
        busy={removalBusy}
        error={removalError}
        onClose={() => setRemovalPhoto(null)}
        onSubmit={requestPhotoRemoval}
      />
    </div>
  )
}

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '')
  if (pathname === '/admin') return <Suspense fallback={null}><Admin /></Suspense>
  if (pathname === '/success') return <Suspense fallback={null}><Success /></Suspense>
  if (pathname === '/info') return <Suspense fallback={null}><Info /></Suspense>
  if (pathname.startsWith('/orders/')) {
    const token = pathname.slice('/orders/'.length)
    return <Suspense fallback={null}><Success orderToken={token} /></Suspense>
  }
  return <GalleryApp />
}
