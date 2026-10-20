import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Check } from 'lucide-react'
import GalleryFooter from '@/components/gallery/GalleryFooter'
import GalleryHeader from '@/components/gallery/GalleryHeader'
import LiveStatusPill from '@/components/gallery/LiveStatusPill'
import PhotoLightbox from '@/components/gallery/PhotoLightbox'
import CartBar from '@/components/gallery/CartBar'
import CheckoutSheet from '@/components/gallery/CheckoutSheet'
import ExpiryBanner from '@/components/gallery/ExpiryBanner'
import TimeFilterBar from '@/components/gallery/TimeFilterBar'
import Watermark from '@/components/gallery/Watermark'
import Admin from '@/pages/Admin'
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

const CART_ID = 'public-gallery'
const PAGE_SIZE = 60
const isMissingPricingColumns = (error) =>
  error?.code === '42703' ||
  error?.code === 'PGRST204' ||
  (/(first_photo_cents|extra_photo_cents|tip_options_cents|currency)/i.test(String(error?.message || '')) &&
    /column|schema cache/i.test(String(error?.message || '')))
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
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const pageRequestId = useRef(0)

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
        setLoading(true)
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
        const message = `Could not load photos: ${error.message || 'Unknown error'}`
        if (append) setLoadingMoreError(message)
        else setLoadError(message)
        setConnectionStatus('offline')
        setLoading(false)
        setLoadingMore(false)
        return
      }

      const rows = data || []
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
          .select('first_photo_cents, extra_photo_cents, tip_options_cents, currency')
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

  const startCheckout = async () => {
    if (!supabase || selectedIds.length === 0) return
    setCheckoutBusy(true)
    setCheckoutError('')
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: { photoIds: selectedIds, tipCents: safeTipCents },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      if (typeof data?.url !== 'string' || !data.url.startsWith('https://checkout.stripe.com/')) {
        throw new Error('The secure Stripe checkout link was not returned.')
      }
      window.location.assign(data.url)
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
                            src={photo.preview_url}
                            alt={photo.filename || 'Photo'}
                            loading="lazy"
                            className={`h-full w-full object-cover ${
                              photo.is_free ? '' : 'blur-[2px]'
                            }`}
                          />
                          {!photo.is_free && <Watermark />}
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
              <div className="px-4 py-6 text-center">
                {loadingMoreError && (
                  <p role="alert" className="mb-3 text-xs text-red-700">
                    {loadingMoreError}
                  </p>
                )}
                <button
                  type="button"
                  disabled={loadingMore || !nextCursor}
                  onClick={() =>
                    loadPhotoPage({
                      append: true,
                      beforeTimestamp: nextCursor?.timestamp,
                      beforePhotoId: nextCursor?.id,
                    })
                  }
                  className="rounded-full border border-gray-300 px-4 py-2 text-xs font-bold disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : 'Load more photos'}
                </button>
              </div>
            )}
          </>
        )}

        <GalleryFooter />
      </main>

      <AnimatePresence>
        {selectedCount > 0 && (
          <CartBar
            count={selectedCount}
            amount={total}
            currency={currency}
            onCheckout={() => {
              setCheckoutError('')
              setCheckoutOpen(true)
            }}
          />
        )}
      </AnimatePresence>

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
            onClose={() => setActivePhoto(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '')
  if (pathname === '/admin') return <Admin />
  if (pathname === '/success') return <Success />
  return <GalleryApp />
}
