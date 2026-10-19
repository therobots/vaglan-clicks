import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Check } from 'lucide-react'
import GalleryFooter from '@/components/gallery/GalleryFooter'
import GalleryHeader from '@/components/gallery/GalleryHeader'
import LiveStatusPill from '@/components/gallery/LiveStatusPill'
import PhotoLightbox from '@/components/gallery/PhotoLightbox'
import Watermark from '@/components/gallery/Watermark'
import Admin from '@/pages/Admin'
import { isSupabaseConfigured, supabase } from './supabaseClient'
import { cacheCartSelection, readCartSelection } from '@/lib/orderSession'
import { DEFAULT_FIRST_PRICE, nextPhotoPrice, selectionSubtotal } from '@/lib/pricing'
import { parseTimestamp } from '@/lib/timeBuckets'

const CART_ID = 'public-gallery'
const PHOTO_FIELDS = 'id, preview_url, filename, timestamp, is_free'
const FILTERS = [
  { id: 'ALL', label: 'All' },
  { id: '23-00', label: '23:00–00:00' },
  { id: '00-01', label: '00:00–01:00' },
  { id: '01-02', label: '01:00–02:00' },
  { id: '02-03', label: '02:00–03:00' },
]
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
  const [activeFilter, setActiveFilter] = useState('ALL')
  const [activePhoto, setActivePhoto] = useState(null)
  const [timerEndsAt, setTimerEndsAt] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [timerError, setTimerError] = useState('')
  const [downloadingPhotoId, setDownloadingPhotoId] = useState(null)
  const [downloadError, setDownloadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('connecting')

  useEffect(() => {
    cacheCartSelection(CART_ID, selectedIds)
  }, [selectedIds])

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

      const [photoResult, timerResult] = await Promise.all([
        supabase
          .from('photos')
          .select(PHOTO_FIELDS)
          .order('timestamp', { ascending: false })
          .limit(500),
        supabase.from('gallery_state').select('timer_ends_at').eq('id', 1).maybeSingle(),
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
        setTimerError(`Could not load gallery timer: ${timerResult.error.message}`)
      } else {
        setTimerEndsAt(timerResult.data?.timer_ends_at || null)
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
    if (!supabase) return undefined
    let active = true
    const refreshTimer = async () => {
      const { data, error } = await supabase
        .from('gallery_state')
        .select('timer_ends_at')
        .eq('id', 1)
        .maybeSingle()
      if (!active) return
      if (error) {
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
  }, [])

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
  const total = selectionSubtotal(selectedCount, DEFAULT_FIRST_PRICE)
  const formattedTotal = new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
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

      <aside
        aria-label="Selected photos and checkout"
        aria-hidden={selectedCount === 0}
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 pt-3 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur transition-transform duration-300 ease-out ${
          selectedCount > 0 ? 'translate-y-0' : 'pointer-events-none translate-y-full'
        }`}
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-neutral-500">
              {selectedCount} {selectedCount === 1 ? 'Photo' : 'Photos'}
            </p>
            <p className="text-base font-bold tabular-nums">{formattedTotal}</p>
          </div>
          <button
            type="button"
            disabled
            aria-describedby="checkout-unavailable-note"
            title="Secure checkout is not configured yet"
            className="shrink-0 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white opacity-55"
          >
            Checkout →
          </button>
        </div>
        <p id="checkout-unavailable-note" className="sr-only">
          Checkout is unavailable until secure payment verification is configured.
        </p>
      </aside>

      <AnimatePresence>
        {activePhoto && activePhotoIndex >= 0 && (
          <PhotoLightbox
            photo={activePhoto}
            selected={selectedIds.includes(activePhoto.id)}
            isFree={Boolean(activePhoto.is_free)}
            isDownloading={downloadingPhotoId === activePhoto.id}
            downloadError={downloadError}
            onDownloadFree={() => downloadFreePhoto(activePhoto)}
            price={nextPhotoPrice(selectedCount, DEFAULT_FIRST_PRICE)}
            currency="EUR"
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
  return window.location.pathname.replace(/\/+$/, '') === '/admin' ? <Admin /> : <GalleryApp />
}
