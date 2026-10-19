import { useEffect, useMemo, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import GalleryFooter from '@/components/gallery/GalleryFooter'
import GalleryHeader from '@/components/gallery/GalleryHeader'
import LiveStatusPill from '@/components/gallery/LiveStatusPill'
import Watermark from '@/components/gallery/Watermark'
import { isSupabaseConfigured, supabase } from './supabaseClient'
import { cacheCartSelection, readCartSelection, readCartTip } from '@/lib/orderSession'
import { parseTimestamp } from '@/lib/timeBuckets'

const CART_ID = 'public-gallery'
const PHOTO_FIELDS = 'id, preview_url, filename, timestamp'
const FILTERS = [
  { id: 'ALL', label: 'All' },
  { id: '23-00', label: '23:00–00:00' },
  { id: '00-01', label: '00:00–01:00' },
  { id: '01-02', label: '01:00–02:00' },
  { id: '02-03', label: '02:00–03:00' },
]
const TIP_OPTIONS = [0, 1, 2]

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

export default function App() {
  const [photos, setPhotos] = useState([])
  const [selectedIds, setSelectedIds] = useState(() => readCartSelection(CART_ID))
  const [tip, setTip] = useState(() => readCartTip(CART_ID))
  const [activeFilter, setActiveFilter] = useState('ALL')
  const [activePhoto, setActivePhoto] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('connecting')

  useEffect(() => {
    cacheCartSelection(CART_ID, selectedIds, tip)
  }, [selectedIds, tip])

  useEffect(() => {
    if (!activePhoto) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setActivePhoto(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
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

      const { data, error } = await supabase
        .from('photos')
        .select(PHOTO_FIELDS)
        .order('timestamp', { ascending: false })
        .limit(500)

      if (!active) return
      if (error) throw error
      setPhotos(sortPhotos(data || []))
      setLoadError('')
      setLoading(false)

      channel = supabase
        .channel('public-photos-feed')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'photos' },
          (payload) => {
            const photo = payload.new
            if (!active || !photo?.id || !photo?.preview_url) return
            setPhotos((current) => {
              const withoutDuplicate = current.filter((item) => item.id !== photo.id)
              return sortPhotos([...withoutDuplicate, photo])
            })
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

  const visiblePhotos = useMemo(
    () =>
      activeFilter === 'ALL'
        ? photos
        : photos.filter((photo) => photoFilter(photo) === activeFilter),
    [activeFilter, photos],
  )
  const selectedCount = selectedIds.length
  const subtotal = selectedCount > 0 ? 2 + (selectedCount - 1) * 0.5 : 0
  const total = subtotal + tip
  const formattedTotal = new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(total)

  const toggleSelected = (photoId) => {
    setSelectedIds((current) =>
      current.includes(photoId)
        ? current.filter((selectedId) => selectedId !== photoId)
        : [...current, photoId],
    )
  }

  return (
    <div className="min-h-screen bg-white pb-28 font-sans text-neutral-900">
      <GalleryHeader photoCount={loading ? undefined : photos.length}>
        <LiveStatusPill state={connectionStatus === 'live' ? 'live' : 'offline'} />
      </GalleryHeader>

      <main className="mx-auto max-w-3xl pt-16">
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
        ) : visiblePhotos.length === 0 ? (
          <p className="px-6 py-24 text-center text-sm text-neutral-500">
            {activeFilter === 'ALL'
              ? 'No photos yet. New shots will appear here as they are uploaded.'
              : 'No photos in this time window.'}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1 p-1">
            {visiblePhotos.map((photo) => {
              const selected = selectedIds.includes(photo.id)
              return (
                <article
                  key={photo.id}
                  className={`relative aspect-square overflow-hidden bg-gray-100 ${
                    selected ? 'ring-2 ring-inset ring-blue-600' : ''
                  }`}
                >
                  <button
                    type="button"
                    aria-label={`${selected ? 'Deselect' : 'Select'} ${
                      photo.filename || 'photo'
                    }`}
                    aria-pressed={selected}
                    onClick={() => toggleSelected(photo.id)}
                    className="absolute inset-0 z-10 h-full w-full cursor-pointer"
                  >
                    <img
                      src={photo.preview_url}
                      alt={photo.filename || 'Event photo'}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <Watermark />
                    <span
                      aria-hidden="true"
                      className={`absolute left-2 top-2 grid h-5 w-5 place-items-center rounded-full border text-xs font-bold ${
                        selected
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-white bg-black/25 text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Expand ${photo.filename || 'photo'}`}
                    onClick={() => setActivePhoto(photo)}
                    className="absolute right-2 top-2 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                  >
                    <Maximize2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </article>
              )
            })}
          </div>
        )}

        <GalleryFooter />
      </main>

      {selectedCount > 0 && (
        <aside
          aria-label="Selected photos and checkout"
          className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl"
        >
          <div>
            <p className="text-xs font-medium text-neutral-500">
              {selectedCount} {selectedCount === 1 ? 'photo' : 'photos'} selected
            </p>
            <p className="text-lg font-bold">{formattedTotal}</p>
          </div>
          <div aria-label="Select a tip" className="flex gap-1 rounded-lg bg-gray-100 p-1">
            {TIP_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={tip === option}
                onClick={() => setTip(option)}
                className={`rounded px-2.5 py-1.5 text-xs ${
                  tip === option
                    ? 'bg-white font-bold text-neutral-900 shadow-sm'
                    : 'text-neutral-600'
                }`}
              >
                {option === 0 ? 'No tip' : `+€${option}`}
              </button>
            ))}
          </div>
          <div className="flex flex-col items-end">
            <button
              type="button"
              disabled
              title="Secure checkout is not configured yet"
              className="cursor-not-allowed rounded-xl bg-neutral-200 px-4 py-2.5 text-sm font-bold text-neutral-500"
            >
              Checkout
            </button>
            <span className="mt-1 text-[10px] text-neutral-500">
              Secure payments are not configured
            </span>
          </div>
        </aside>
      )}

      {activePhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
          onClick={() => setActivePhoto(null)}
          className="fixed inset-0 z-50 flex flex-col justify-between bg-white p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Photo preview</p>
            <button
              type="button"
              aria-label="Close photo preview"
              onClick={() => setActivePhoto(null)}
              className="grid h-10 w-10 place-items-center rounded-full hover:bg-gray-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div
            className="relative my-4 flex min-h-0 flex-1 items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={activePhoto.preview_url}
              alt={activePhoto.filename || 'Event photo preview'}
              className="max-h-full max-w-full object-contain"
            />
            <Watermark large />
          </div>
          <button
            type="button"
            onClick={() => toggleSelected(activePhoto.id)}
            className="w-full rounded-xl bg-neutral-900 py-3 text-sm font-bold text-white"
          >
            {selectedIds.includes(activePhoto.id) ? 'Remove from selection' : 'Select photo'}
          </button>
        </div>
      )}
    </div>
  )
}
