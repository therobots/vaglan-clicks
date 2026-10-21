import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Check } from 'lucide-react'
import GalleryFooter from '@/components/gallery/GalleryFooter'
import GalleryHeader from '@/components/gallery/GalleryHeader'
import LiveStatusPill from '@/components/gallery/LiveStatusPill'
import CartBar from '@/components/gallery/CartBar'
import ExpiryBanner from '@/components/gallery/ExpiryBanner'
import TimeFilterBar from '@/components/gallery/TimeFilterBar'
import GalleryTabs from '@/components/gallery/GalleryTabs'
import PhotoRemovalDialog from '@/components/gallery/PhotoRemovalDialog'
import Watermark from '@/components/gallery/Watermark'
import Info from '@/pages/Info'
import Success from '@/pages/Success'
import { isSupabaseConfigured, supabase } from './supabaseClient'
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
  applyDocumentLanguage,
  galleryText,
  useGalleryLanguage,
} from '@/lib/galleryLanguage'

const PhotoLightbox = lazy(() => import('@/components/gallery/PhotoLightbox'))
const CheckoutSheet = lazy(() => import('@/components/gallery/CheckoutSheet'))
const Admin = lazy(() => import('@/pages/Admin'))

const CART_ID = 'public-gallery'
const PAGE_SIZE = 20
const NOTICE_KEY = 'vaglan-gallery-notice-dismissed'
const normalizePhotoRow = (photo) => ({
  ...photo,
  is_free: Boolean(photo?.is_free ?? false),
})
const isMissingPricingColumns = (error) =>
  error?.code === '42703' ||
  error?.code === 'PGRST204' ||
  /((first_photo_cents|extra_photo_cents|tip_options_cents|currency)|gallery_state)/i.test(String(error?.message || '')) &&
  /column|table|schema cache|does not exist/i.test(String(error?.message || ''))
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
  const [photos, setPhotos] = useState([])
  const [nights, setNights] = useState([])
  const [activeNight, setActiveNight] = useState('')
  const [slots, setSlots] = useState([])
  const [activeSlot, setActiveSlot] = useState(null)
  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => readCartSelection(CART_ID))
  const [tipCents, setTipCents] = useState(() => readCartTip(CART_ID))
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
  const [checkoutLoaded, setCheckoutLoaded] = useState(false)
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
  const loadMoreSentinelRef = useRef(null)
  const loadingMoreLockRef = useRef(false)

  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  useEffect(() => {
    applyDocumentLanguage(language)
  }, [language])

  useEffect(() => {
    cacheCartSelection(CART_ID, selectedIds, tipCents)
  }, [selectedIds, tipCents])

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

  const loadPhotoPage = useCallback(
    async ({
      append = false,
      beforeTimestamp = null,
      beforePhotoId = null,
      night = activeNight,
      slot = activeSlot,
    } = {}) => {
      const requestId = ++pageRequestId.current
      if (!supabase || !night) {
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
        loadingMoreLockRef.current = false
        setLoading(true)
        setLoadingMore(false)
        setLoadingMoreError('')
        setHasMore(false)
        setNextCursor(null)
        setPhotos([])
        setLoadError('')
      }
      let result
      try {
        result = await supabase.rpc('gallery_photos', {
          night_key_input: night,
          slot_start_input: slot?.slot_start || null,
          slot_end_input: slot?.slot_end || null,
          before_timestamp_input: beforeTimestamp,
          before_photo_id_input: beforePhotoId,
          limit_input: PAGE_SIZE,
        })
      } catch (error) {
        if (requestId !== pageRequestId.current) return
        const message = `Could not load photos: ${error.message || 'Unknown error'}`
        if (append) setLoadingMoreError(message)
        else setLoadError(message)
        setConnectionStatus('offline')
        setLoading(false)
        setLoadingMore(false)
        return
      }
      const { data, error } = result
      if (requestId !== pageRequestId.current) return
      if (error) {
        if (/column.*is_free|is_free.*does not exist/i.test(String(error.message || ''))) {
          try {
            const fallbackResult = await supabase
              .from('photos')
              .select('*')
              .order('timestamp', { ascending: false })
              .limit(PAGE_SIZE)
            const fallbackRows = (fallbackResult.data || []).map(normalizePhotoRow)
            setPhotos((current) => (append ? [...current, ...fallbackRows] : fallbackRows))
            setLoadError('')
            setConnectionStatus('connecting')
            setLoading(false)
            setLoadingMore(false)
            setHasMore(fallbackRows.length === PAGE_SIZE)
            setNextCursor(
              fallbackRows.length > 0
                ? { timestamp: fallbackRows[fallbackRows.length - 1].timestamp, id: fallbackRows[fallbackRows.length - 1].id }
                : null,
            )
            return
          } catch {
            // Fall through to the standard error message below.
          }
        }
        const message = `Could not load photos: ${error.message || 'Unknown error'}`
        if (append) setLoadingMoreError(message)
        else setLoadError(message)
        setConnectionStatus('offline')
        setLoading(false)
        setLoadingMore(false)
        return
      }

      const rows = (data || []).map(normalizePhotoRow)
      setPhotos((current) => (append ? [...current, ...rows] : rows))
      if (!append) {
        setActivePhoto((current) =>
          current && !rows.some((photo) => photo.id === current.id) ? null : current,
        )
      }
      const lastPhoto = rows[rows.length - 1]
      setNextCursor((current) =>
        lastPhoto ? { timestamp: lastPhoto.timestamp, id: lastPhoto.id } : append ? current : null,
      )
      setHasMore(rows.length === PAGE_SIZE)
      setSelectedIds((current) =>
        current.filter((id) => !rows.some((photo) => photo.id === id && photo.is_free)),
      )
      setLoadError('')
      setLoading(false)
      setLoadingMore(false)
    },
    [activeNight, activeSlot],
  )

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
    if (!isSupabaseConfigured || !supabase) {
      setLoadError(
        'Gallery is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect Supabase.',
      )
      setConnectionStatus('offline')
      setLoading(false)
      return undefined
    }

    const loadGallery = async () => {
      const [nightsResult, clockResult, pricingResult] = await Promise.all([
        supabase.rpc('gallery_nights'),
        supabase.rpc('gallery_server_now'),
        supabase
          .from('gallery_state')
          .select('*')
          .eq('id', 1)
          .maybeSingle(),
      ])
      if (!active) return
      if (nightsResult.error) {
        throw new Error(
          `Could not load gallery nights: ${nightsResult.error.message}. Apply the latest gallery migration.`,
        )
      }
      if (clockResult.error) {
        throw new Error(
          `Could not read the gallery server clock: ${clockResult.error.message}. Apply the latest gallery migration.`,
        )
      }
      const loadedNights = nightsResult.data || []
      setNights(loadedNights)
      setActiveNight((current) =>
        loadedNights.some((night) => night.night_key === current)
          ? current
          : loadedNights[0]?.night_key || '',
      )
      const serverNow = parseTimestamp(clockResult.data)
      if (Number.isFinite(serverNow)) setServerOffsetMs(serverNow - Date.now())

      if (pricingResult.error) {
        if (isMissingPricingColumns(pricingResult.error)) {
          setSchemaNotice(
            'Server-side photo pricing is not enabled yet. Apply the latest Supabase migration before checkout.',
          )
          setPricingConfigured(false)
        } else {
          throw pricingResult.error
        }
      } else {
        const pricingData = hasPricingSettings(pricingResult.data) ? pricingResult.data : null
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
          setFirstPhotoCents(firstPrice)
          setExtraPhotoCents(extraPrice)
          setTipOptionsCents(configuredTips)
          setCurrency('EUR')
          setTipCents((current) => (isAllowedTip(current, configuredTips) ? current : 0))
        }
      }
      setConnectionStatus('connecting')
      setLoadError('')
    }

    loadGallery().catch((error) => {
      if (!active) return
      setLoadError(`Could not load gallery: ${error.message || 'Unknown error'}`)
      setConnectionStatus('offline')
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  const hidePhoto = useCallback((photoId) => {
    setPhotos((current) => current.filter((photo) => photo.id !== photoId))
    setSelectedIds((current) => current.filter((id) => id !== photoId))
    setActivePhoto((current) => (current?.id === photoId ? null : current))
  }, [])

  useEffect(() => {
    if (!supabase) return undefined
    const channel = supabase
      .channel('public:gallery-removals')
      .on('broadcast', { event: 'photo-hidden' }, ({ payload }) => {
        if (typeof payload?.photoId === 'string') hidePhoto(payload.photoId)
      })
      .on('broadcast', { event: 'photo-restored' }, () => {
        void loadPhotoPage({ append: false })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [hidePhoto, loadPhotoPage])

  useEffect(() => {
    if (!supabase) return undefined
    let active = true
    const reconcileVisibility = async () => {
      const ids = photosRef.current.map((photo) => photo.id).filter(Boolean)
      if (!ids.length) return
      const { data, error } = await supabase.from('photos').select('id').in('id', ids)
      if (!active) return
      if (error) {
        setLoadError(`Could not refresh photo visibility: ${error.message}`)
        return
      }
      const visibleIds = new Set((data || []).map((photo) => photo.id))
      for (const photoId of ids) {
        if (!visibleIds.has(photoId)) hidePhoto(photoId)
      }
    }
    const interval = window.setInterval(() => {
      reconcileVisibility().catch((error) => {
        if (active) setLoadError(`Could not refresh photo visibility: ${error.message}`)
      })
    }, 30000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [hidePhoto])

  useEffect(() => {
    if (!supabase) return undefined
    let active = true
    const refreshNightAvailability = async () => {
      const [nightsResult, clockResult] = await Promise.all([
        supabase.rpc('gallery_nights'),
        supabase.rpc('gallery_server_now'),
      ])
      if (!active) return
      if (nightsResult.error) {
        setLoadError(`Could not refresh gallery nights: ${nightsResult.error.message}`)
        return
      }
      const refreshedNights = nightsResult.data || []
      setNights(refreshedNights)
      if (!refreshedNights.some((night) => night.night_key === activeNight)) {
        setActiveSlot(null)
        setActivePhoto(null)
      }
      setActiveNight((current) =>
        refreshedNights.some((night) => night.night_key === current)
          ? current
          : refreshedNights[0]?.night_key || '',
      )
      if (clockResult.error) {
        setLoadError(`Could not refresh gallery server time: ${clockResult.error.message}`)
        return
      }
      const serverNow = parseTimestamp(clockResult.data)
      if (Number.isFinite(serverNow)) setServerOffsetMs(serverNow - Date.now())
    }
    const interval = window.setInterval(() => {
      refreshNightAvailability().catch((error) => {
        if (active) setLoadError(`Could not refresh gallery nights: ${error.message}`)
      })
    }, 60000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [activeNight])

  useEffect(() => {
    if (!activeNight || !supabase) {
      setSlots([])
      return undefined
    }
    let active = true
    const loadSlots = async () => {
      try {
        const { data, error } = await supabase.rpc('gallery_slots', {
          night_key_input: activeNight,
        })
        if (!active) return
        if (error) {
          setLoadError(`Could not load time slots: ${error.message}`)
          return
        }
        setSlots(mapGallerySlots(data || []))
      } catch (error) {
        if (active) setLoadError(`Could not load time slots: ${error.message}`)
      }
    }
    loadSlots()
    return () => {
      active = false
    }
  }, [activeNight])

  useEffect(() => {
    loadPhotoPage()
  }, [loadPhotoPage])

  useEffect(() => {
    if (!supabase) return undefined
    let active = true
    const channel = supabase
      .channel('public-photos-feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'photos' },
        async (payload) => {
          if (!active) return
          try {
            if (payload.eventType === 'DELETE' && payload.old?.id) {
              setSelectedIds((current) => current.filter((id) => id !== payload.old.id))
              setActivePhoto((current) => (current?.id === payload.old.id ? null : current))
            }
            const [nightsResult, clockResult] = await Promise.all([
              supabase.rpc('gallery_nights'),
              supabase.rpc('gallery_server_now'),
            ])
            if (!active) return
            if (nightsResult.error) {
              setLoadError(`Could not refresh gallery nights: ${nightsResult.error.message}`)
              return
            }
            const refreshedNights = nightsResult.data || []
            setNights(refreshedNights)
            if (!refreshedNights.some((night) => night.night_key === activeNight)) {
              setActiveSlot(null)
              setActivePhoto(null)
              setActiveNight(refreshedNights[0]?.night_key || '')
            } else {
              const { data: updatedSlots, error: slotsError } = await supabase.rpc(
                'gallery_slots',
                { night_key_input: activeNight },
              )
              if (slotsError) {
                setLoadError(`Could not refresh time slots: ${slotsError.message}`)
                return
              }
              const mappedSlots = mapGallerySlots(updatedSlots || [])
              setSlots(mappedSlots)
              const slotStillAvailable =
                !activeSlot ||
                mappedSlots.some(
                  (slot) =>
                    slot.slot_start === activeSlot.slot_start &&
                    slot.slot_end === activeSlot.slot_end,
                )
              if (!slotStillAvailable) {
                setActiveSlot(null)
              } else {
                await loadPhotoPage({ append: false, slot: activeSlot })
              }
            }
            if (clockResult.error) {
              setLoadError(`Could not refresh gallery server time: ${clockResult.error.message}`)
              return
            }
            const serverNow = parseTimestamp(clockResult.data)
            if (Number.isFinite(serverNow)) setServerOffsetMs(serverNow - Date.now())
          } catch (error) {
            if (active) setLoadError(`Could not refresh the live gallery: ${error.message}`)
          }
        },
      )
      .subscribe((status) => {
        if (active) setConnectionStatus(status === 'SUBSCRIBED' ? 'live' : 'offline')
      })
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [activeNight, loadPhotoPage])

  const photoGroups = useMemo(() => groupPhotosByTime(photos), [photos])
  const selectedCount = selectedIds.length
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

  const toggleSelected = (photoId) => {
    setSelectedIds((current) =>
      current.includes(photoId)
        ? current.filter((selectedId) => selectedId !== photoId)
        : [...current, photoId],
    )
  }

  const downloadFreePhoto = async (photo) => {
    if (!supabase || !photo?.is_free) return
    setDownloadingPhotoId(photo.id)
    setDownloadError('')
    try {
      const { data, error } = await supabase.functions.invoke('gallery-admin', {
        body: { action: 'download-free', photoId: photo.id },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
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
    if (!supabase || !removalPhoto) return false
    setRemovalBusy(true)
    setRemovalError('')
    try {
      const { data, error } = await supabase.functions.invoke('request-photo-removal', {
        body: { photoId: removalPhoto.id, reason, contact },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
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
    if (!supabase || selectedIds.length === 0) return
    setCheckoutBusy(true)
    setCheckoutError('')
    try {
      const { data, error } = await supabase.functions.invoke('create-viva-order', {
        body: { photoIds: selectedIds, tipCents: safeTipCents },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
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
            {photoGroups.map((group) => (
              <section key={group.key} aria-label={`Photos at ${group.label} Athens time`}>
                <h2 className="sticky top-16 z-20 border-y border-gray-100 bg-white/95 px-4 py-2 text-xs font-bold text-neutral-600 backdrop-blur">
                  {group.label} Athens time
                </h2>
                <div className="grid grid-cols-3 gap-0.5 p-0.5">
                  {group.photos.map((photo) => {
                    const selected = selectedIds.includes(photo.id)
                    return (
                      <article
                        key={photo.id}
                        className={`relative aspect-square overflow-hidden bg-gray-100 transition-shadow ${
                          selected ? 'ring-[2.5px] ring-inset ring-blue-600' : ''
                        }`}
                      >
                        <button
                          type="button"
                          aria-label={`Preview ${photo.filename || 'photo'}`}
                          onClick={() => setActivePhoto(photo)}
                          className="absolute inset-0 z-0 h-full w-full cursor-zoom-in"
                        >
                          <img
                            src={photo.thumbnail_url || photo.preview_url}
                            alt={photo.filename || 'Photo'}
                            loading="lazy"
                            decoding="async"
                            className={`h-full w-full object-cover ${
                              photo.is_free ? '' : 'blur-[2px]'
                            }`}
                          />
                          {!photo.is_free && !photo.thumbnail_url && <Watermark />}
                        </button>
                        {!photo.is_free && (
                          <button
                            type="button"
                            aria-label={`${selected ? 'Deselect' : 'Select'} ${
                              photo.filename || 'photo'
                            }`}
                            aria-pressed={selected}
                            onClick={() => toggleSelected(photo.id)}
                            className={`absolute right-2 top-2 z-20 grid h-7 w-7 place-items-center rounded-full border-2 transition-colors ${
                              selected
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-white/90 bg-black/25 text-transparent backdrop-blur-sm'
                            }`}
                          >
                            {selected && (
                              <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
                            )}
                          </button>
                        )}
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

      <AnimatePresence>
        {selectedCount > 0 && (
          <CartBar
            count={selectedCount}
            amount={total}
            currency={currency}
            onCheckout={() => {
              setCheckoutError('')
              setCheckoutLoaded(true)
              setCheckoutOpen(true)
            }}
          />
        )}
      </AnimatePresence>

      <Suspense fallback={null}>
        {checkoutLoaded && (
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

        <AnimatePresence>
          {activePhoto && activePhotoIndex >= 0 && (
            <PhotoLightbox
              photo={activePhoto}
              selected={selectedIds.includes(activePhoto.id)}
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
        </AnimatePresence>
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
  if (pathname === '/success') return <Success />
  if (pathname === '/info') return <Info />
  if (pathname.startsWith('/orders/')) {
    const token = pathname.slice('/orders/'.length)
    return <Success orderToken={token} />
  }
  return <GalleryApp />
}
