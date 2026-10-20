import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Check } from 'lucide-react'
import GalleryFooter from '@/components/gallery/GalleryFooter'
import GalleryHeader from '@/components/gallery/GalleryHeader'
import LiveStatusPill from '@/components/gallery/LiveStatusPill'
import PhotoLightbox from '@/components/gallery/PhotoLightbox'
import CartBar from '@/components/gallery/CartBar'
import CheckoutSheet from '@/components/gallery/CheckoutSheet'
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
import { parseTimestamp } from '@/lib/timeBuckets'

const CART_ID = 'public-gallery'
const PHOTO_FIELDS = 'id, preview_url, filename, timestamp, is_free'
const LEGACY_PHOTO_FIELDS = 'id, preview_url, filename, timestamp'
const FILTERS = [
  { id: 'ALL', label: 'All' },
  { id: '23-00', label: '23:00–00:00' },
  { id: '00-01', label: '00:00–01:00' },
  { id: '01-02', label: '01:00–02:00' },
  { id: '02-03', label: '02:00–03:00' },
]
const isMissingFreePhotoColumn = (error) =>
  error?.code === '42703' ||
  (String(error?.message || '').includes('is_free') &&
    /column|schema cache/i.test(String(error?.message || '')))
const isMissingGalleryStateTable = (error) =>
  error?.code === '42P01' ||
  error?.code === 'PGRST205' ||
  (String(error?.message || '').includes('gallery_state') &&
    /table|schema cache|could not find/i.test(String(error?.message || '')))
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

const photoTime = (value) => {
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    const numericValue = Number(value)
    return new Date(numericValue < 1e12 ? numericValue * 1000 : numericValue)
  }
  if (typeof value === 'number') {
    return new Date(value < 1e12 ? value * 1000 : value)
  }
  const milliseconds = parseTimestamp(value)
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null
}

const photoFilter = (photo) => {
  const date = photoTime(photo.timestamp)
  if (!date || Number.isNaN(date.getTime())) return null
  const hour = date.getHours()
  if (hour === 23) return '23-00'
  if (hour === 0) return '00-01'
  if (hour === 1) return '01-02'
  if (hour === 2) return '02-03'
  return null
}

const sortPhotos = (items) =>
  [...items].sort((left, right) => {
    const leftTime = photoTime(left.timestamp)?.getTime() ?? Number.NEGATIVE_INFINITY
    const rightTime = photoTime(right.timestamp)?.getTime() ?? Number.NEGATIVE_INFINITY
    const difference = rightTime - leftTime
    return Number.isNaN(difference) ? 0 : difference
  })

function GalleryApp() {
  const [photos, setPhotos] = useState([])
  const [selectedIds, setSelectedIds] = useState(() => readCartSelection(CART_ID))
  const [tipCents, setTipCents] = useState(() => readCartTip(CART_ID))
  const [activeFilter, setActiveFilter] = useState('ALL')
  const [activePhoto, setActivePhoto] = useState(null)
  const [timerEndsAt, setTimerEndsAt] = useState(null)
  const [firstPhotoCents, setFirstPhotoCents] = useState(DEFAULT_FIRST_PRICE * 100)
  const [extraPhotoCents, setExtraPhotoCents] = useState(EXTRA_PHOTO_PRICE * 100)
  const [tipOptionsCents, setTipOptionsCents] = useState(TIP_OPTIONS_CENTS)
  const [currency, setCurrency] = useState('EUR')
  const [pricingConfigured, setPricingConfigured] = useState(false)
  const [timerAvailable, setTimerAvailable] = useState(true)
  const [schemaNotice, setSchemaNotice] = useState('')
  const [now, setNow] = useState(Date.now())
  const [timerError, setTimerError] = useState('')
  const [downloadingPhotoId, setDownloadingPhotoId] = useState(null)
  const [downloadError, setDownloadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')

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

  useEffect(() => {
    let active = true
    let channel

    const loadPhotos = async () => {
      if (!isSupabaseConfigured || !supabase) {
        setLoadError(
          'Gallery is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect Supabase.',
        )
        setConnectionStatus('offline')
        setLoading(false)
        return
      }

      const photoRequest = async () => {
        const currentSchemaResult = await supabase
          .from('photos')
          .select(PHOTO_FIELDS)
          .order('timestamp', { ascending: false })
          .limit(500)
        if (!currentSchemaResult.error || !isMissingFreePhotoColumn(currentSchemaResult.error)) {
          return currentSchemaResult
        }

        setSchemaNotice(
          'Free-photo features are not enabled yet. Apply the latest Supabase migration to enable them.',
        )
        const legacySchemaResult = await supabase
          .from('photos')
          .select(LEGACY_PHOTO_FIELDS)
          .order('timestamp', { ascending: false })
          .limit(500)
        return legacySchemaResult.data
          ? {
              ...legacySchemaResult,
              data: legacySchemaResult.data.map((photo) => ({ ...photo, is_free: false })),
            }
          : legacySchemaResult
      }

      const timerRequest = async () => {
        const currentResult = await supabase
          .from('gallery_state')
          .select('timer_ends_at, first_photo_cents, extra_photo_cents, tip_options_cents, currency')
          .eq('id', 1)
          .maybeSingle()
        if (!currentResult.error || !isMissingPricingColumns(currentResult.error)) {
          return currentResult
        }
        setSchemaNotice(
          'Server-side photo pricing is not enabled yet. Apply the latest Supabase migration before checkout.',
        )
        return supabase
          .from('gallery_state')
          .select('timer_ends_at')
          .eq('id', 1)
          .maybeSingle()
      }

      const [photoResult, timerResult] = await Promise.all([
        photoRequest(),
        timerRequest(),
      ])

      if (!active) return
      if (photoResult.error) throw photoResult.error
      const loadedPhotos = sortPhotos(photoResult.data || [])
      setPhotos(loadedPhotos)
      setSelectedIds((current) =>
        current.filter((selectedId) =>
          loadedPhotos.some((photo) => photo.id === selectedId && !photo.is_free),
        ),
      )
      if (timerResult.error) {
        if (isMissingGalleryStateTable(timerResult.error)) {
          setTimerAvailable(false)
          setTimerEndsAt(null)
          setSchemaNotice(
            'Admin timer and free-photo features are not enabled yet. Apply the latest Supabase migration to enable them.',
          )
          setTimerError('')
        } else {
          setTimerError(`Could not load gallery timer: ${timerResult.error.message}`)
        }
      } else {
        setTimerAvailable(true)
        setTimerEndsAt(timerResult.data?.timer_ends_at || null)
        const pricingData = hasPricingSettings(timerResult.data) ? timerResult.data : null
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
        setTimerError('')
      }
      setLoadError('')
      setLoading(false)

      channel = supabase
        .channel('public-photos-feed')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'photos' },
          (payload) => {
            if (!active) return
            if (payload.eventType === 'DELETE') {
              setPhotos((current) => current.filter((photo) => photo.id !== payload.old?.id))
              setSelectedIds((current) => current.filter((id) => id !== payload.old?.id))
              setActivePhoto((current) => (current?.id === payload.old?.id ? null : current))
              return
            }
            const photo = payload.new
            if (!photo?.id || !photo?.preview_url) return
            setActivePhoto((current) => (current?.id === photo.id ? photo : current))
            setPhotos((current) => {
              const withoutDuplicate = current.filter((item) => item.id !== photo.id)
              return sortPhotos([...withoutDuplicate, photo])
            })
            if (photo.is_free) {
              setSelectedIds((current) => current.filter((id) => id !== photo.id))
            }
          },
        )
        .subscribe((status) => {
          if (!active) return
          setConnectionStatus(status === 'SUBSCRIBED' ? 'live' : 'offline')
        })
    }

    loadPhotos().catch((error) => {
      if (!active) return
      setLoadError(`Could not load photos: ${error.message || 'Unknown error'}`)
      setConnectionStatus('offline')
      setLoading(false)
    })

    return () => {
      active = false
      if (channel && supabase) supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (!supabase || !timerAvailable) return undefined
    let active = true
    const refreshTimer = async () => {
      const { data, error } = await supabase
        .from('gallery_state')
        .select('timer_ends_at')
        .eq('id', 1)
        .maybeSingle()
      if (!active) return
      if (error) {
        if (isMissingGalleryStateTable(error)) {
          setTimerAvailable(false)
          setTimerEndsAt(null)
          setTimerError('')
          setSchemaNotice(
            'Admin timer and free-photo features are not enabled yet. Apply the latest Supabase migration to enable them.',
          )
          return
        }
        setTimerError(`Could not load gallery timer: ${error.message}`)
        return
      }
      setTimerEndsAt(data?.timer_ends_at || null)
      setTimerError('')
    }
    const interval = window.setInterval(() => {
      refreshTimer().catch((error) => {
        if (active) setTimerError(`Could not refresh gallery timer: ${error.message}`)
      })
    }, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [timerAvailable])

  useEffect(() => {
    if (!timerEndsAt) return undefined
    setNow(Date.now())
    const target = parseTimestamp(timerEndsAt)
    if (!Number.isFinite(target) || target <= Date.now()) return undefined
    const timer = window.setInterval(() => {
      const currentTime = Date.now()
      setNow(currentTime)
      if (currentTime >= target) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [timerEndsAt])

  const visiblePhotos = useMemo(
    () =>
      activeFilter === 'ALL'
        ? photos
        : photos.filter((photo) => photoFilter(photo) === activeFilter),
    [activeFilter, photos],
  )
  const selectedCount = selectedIds.length
  const activePhotoIndex = activePhoto
    ? visiblePhotos.findIndex((photo) => photo.id === activePhoto.id)
    : -1
  const firstPhotoPrice = firstPhotoCents / 100
  const extraPhotoPrice = extraPhotoCents / 100
  const subtotal = selectionSubtotal(selectedCount, firstPhotoPrice, extraPhotoPrice)
  const safeTipCents = isAllowedTip(tipCents, tipOptionsCents) ? tipCents : 0
  const total = subtotal + safeTipCents / 100
  const formattedTotal = new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
  }).format(total)
  const remainingSeconds = timerEndsAt
    ? Math.max(0, Math.floor((parseTimestamp(timerEndsAt) - now) / 1000))
    : 0
  const timerIsActive = Number.isFinite(remainingSeconds) && remainingSeconds > 0
  const countdown = [
    Math.floor(remainingSeconds / 3600),
    Math.floor((remainingSeconds % 3600) / 60),
    remainingSeconds % 60,
  ]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')

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
      <GalleryHeader photoCount={loading ? undefined : photos.length}>
        <LiveStatusPill state={connectionStatus === 'live' ? 'live' : 'offline'} />
      </GalleryHeader>

      <main className="mx-auto max-w-3xl pt-16">
        {timerIsActive && (
          <div
            role="timer"
            aria-label={`Gallery closes in ${countdown}`}
            className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-900"
          >
            Gallery closes in <span className="font-mono tabular-nums">{countdown}</span>
          </div>
        )}
        {timerError && (
          <p role="status" className="px-4 py-2 text-center text-xs text-amber-800">
            {timerError}
          </p>
        )}
        {schemaNotice && (
          <p role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
            {schemaNotice}
          </p>
        )}
        <nav
          aria-label="Filter photos by hour"
          className="flex gap-2 overflow-x-auto border-b border-gray-100 px-3 py-3"
        >
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={activeFilter === filter.id}
              onClick={() => setActiveFilter(filter.id)}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors ${
                activeFilter === filter.id
                  ? 'border-neutral-900 bg-neutral-100 font-bold text-neutral-900'
                  : 'border-gray-200 bg-white text-neutral-600'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </nav>

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
          <div className="grid grid-cols-3 gap-0.5 p-0.5">
            {visiblePhotos.map((photo) => {
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
                      alt={photo.filename || 'Event photo'}
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
                      {selected && <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />}
                    </button>
                  )}
                </article>
              )
            })}
          </div>
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
            hasPrev={activePhotoIndex > 0}
            hasNext={activePhotoIndex < visiblePhotos.length - 1}
            onPrev={() => setActivePhoto(visiblePhotos[activePhotoIndex - 1])}
            onNext={() => setActivePhoto(visiblePhotos[activePhotoIndex + 1])}
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
