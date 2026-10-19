import React, { useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured, supabase } from './supabaseClient'
import GalleryFooter from '@/components/gallery/GalleryFooter'
import GalleryHeader from '@/components/gallery/GalleryHeader'
import ExpiryBanner from '@/components/gallery/ExpiryBanner'
import Watermark from '@/components/gallery/Watermark'
import { buildSlots, hourSlot, parseTimestamp } from '@/lib/timeBuckets'
import { cacheCartSelection, readCartSelection, readCartTip } from '@/lib/orderSession'

const photoFields = 'id, event_id, preview_url, filename, timestamp, created_at'
const eventFields = 'id, slug, title, event_date, is_live, expires_at, price_per_photo, currency, created_at'
const tipOptions = [0, 1, 2, 3]

const sortPhotos = (photos) =>
  [...photos].sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp))

const mergePhotos = (current, incoming) => {
  const byId = new Map(current.map((photo) => [photo.id, photo]))
  for (const photo of incoming) {
    if (photo?.id && photo.preview_url) byId.set(photo.id, photo)
  }
  return sortPhotos([...byId.values()])
}

export default function App() {
  const [event, setEvent] = useState(null)
  const [photos, setPhotos] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [cartReadyForEvent, setCartReadyForEvent] = useState(null)
  const [activeFilter, setActiveFilter] = useState(null)
  const [activePhoto, setActivePhoto] = useState(null)
  const [tip, setTip] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('offline')

  const eventSlug = useMemo(
    () => new URLSearchParams(window.location.search).get('event')?.trim() || '',
    [],
  )

  useEffect(() => {
    if (!event?.id) return
    setSelectedIds(readCartSelection(event.id))
    setTip(readCartTip(event.id))
    setCartReadyForEvent(event.id)
  }, [event?.id])

  useEffect(() => {
    if (event?.id && cartReadyForEvent === event.id) {
      cacheCartSelection(event.id, selectedIds, tip)
    }
  }, [event?.id, cartReadyForEvent, selectedIds, tip])

  useEffect(() => {
    let active = true
    let channel

    const loadGallery = async () => {
      if (!isSupabaseConfigured || !supabase) {
        setLoadError('Gallery is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect Supabase.')
        setLoading(false)
        return
      }

      let eventQuery = supabase.from('events').select(eventFields)
      if (eventSlug) {
        eventQuery = eventQuery.eq('slug', eventSlug)
      } else {
        eventQuery = eventQuery
          .eq('is_live', true)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
      }

      const { data: currentEvent, error: eventError } = await eventQuery.maybeSingle()
      if (!active) return
      if (eventError) throw eventError
      if (!currentEvent) {
        setEvent(null)
        setPhotos([])
        setLoading(false)
        return
      }

      setEvent(currentEvent)
      const { data, error } = await supabase
        .from('photos')
        .select(photoFields)
        .eq('event_id', currentEvent.id)
        .order('timestamp', { ascending: false })
        .limit(500)

      if (!active) return
      if (error) throw error
      setPhotos(sortPhotos(data || []))
      setLoadError('')
      setLoading(false)

      channel = supabase
        .channel(`gallery:${currentEvent.id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'photos', filter: `event_id=eq.${currentEvent.id}` },
          (payload) => {
            if (active) setPhotos((current) => mergePhotos(current, [payload.new]))
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${currentEvent.id}` },
          (payload) => {
            if (active) setEvent((current) => ({ ...current, ...payload.new }))
          },
        )
        .subscribe((status) => {
          if (active) setConnectionStatus(status === 'SUBSCRIBED' ? 'live' : 'offline')
        })
    }

    loadGallery().catch((error) => {
      if (!active) return
      setLoadError(`Could not load the gallery: ${error.message || 'Unknown error'}`)
      setLoading(false)
    })

    return () => {
      active = false
      if (channel && supabase) supabase.removeChannel(channel)
    }
  }, [eventSlug])

  const timeSlots = useMemo(
    () => buildSlots(photos.map((photo) => photo.timestamp)),
    [photos],
  )
  const filteredPhotos = photos.filter(
    (photo) => activeFilter === null || hourSlot(photo.timestamp) === activeFilter,
  )
  const selectedCount = selectedIds.length
  const firstPhotoPrice = Number(event?.price_per_photo)
  const safeFirstPhotoPrice =
    Number.isFinite(firstPhotoPrice) && firstPhotoPrice >= 0 ? firstPhotoPrice : 2
  const subtotal = selectedCount
    ? safeFirstPhotoPrice + (selectedCount - 1) * 0.5
    : 0
  const amount = subtotal + tip
  const currency = /^[A-Z]{3}$/.test(event?.currency || '') ? event.currency : 'EUR'
  const eventExpired =
    !event ||
    event.is_live === false ||
    (event.expires_at && parseTimestamp(event.expires_at) <= Date.now())

  const toggleSelect = (id) => {
    if (typeof id !== 'string' || !id) return
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  return (
    <div className="min-h-screen bg-white pb-24 font-sans text-neutral-900">
      <GalleryHeader
        eventId={event?.id}
        eventLive={!eventExpired}
        latestPhotoAt={photos[0]?.timestamp}
        photoCount={loading ? undefined : photos.length}
      />

      <main className="mx-auto max-w-3xl pt-14">
        <div
          aria-label="Filter photos by time"
          className="flex gap-2 overflow-x-auto border-b border-gray-100 px-4 py-3 text-xs"
        >
          <button
            type="button"
            aria-pressed={activeFilter === null}
            onClick={() => setActiveFilter(null)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 transition-colors ${
              activeFilter === null
                ? 'border-neutral-900 bg-neutral-100 font-bold text-neutral-900'
                : 'border-gray-200 bg-white text-neutral-600'
            }`}
          >
            🔥 All Shots
          </button>
          {timeSlots.map((slot) => (
            <button
              key={slot.slot}
              type="button"
              aria-pressed={activeFilter === slot.slot}
              onClick={() => setActiveFilter(slot.slot)}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 transition-colors ${
                activeFilter === slot.slot
                  ? 'border-neutral-900 bg-neutral-100 font-bold text-neutral-900'
                  : 'border-gray-200 bg-white text-neutral-600'
              }`}
            >
              {slot.label}
            </button>
          ))}
        </div>

        <ExpiryBanner event={event} />

        {loadError && (
          <p role="alert" className="mx-auto max-w-2xl px-4 py-4 text-center text-sm text-red-700">
            {loadError}
          </p>
        )}

        {loading ? (
          <p className="py-16 text-center text-sm text-neutral-500" role="status">
            Loading photos…
          </p>
        ) : filteredPhotos.length === 0 ? (
          <div className="px-6 py-24 text-center">
            <p className="text-[15px] font-bold tracking-tight">
              {eventExpired
                ? 'This gallery is not live'
                : activeFilter === null
                  ? 'No photos yet'
                  : 'No photos in this time window'}
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500">
              {eventExpired
                ? 'Check the event link or come back during the live gallery.'
                : activeFilter === null
                  ? 'New photos appear here as they are uploaded.'
                  : 'Choose another time window to see more photos.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1 p-1 sm:grid-cols-4">
            {filteredPhotos.map((photo) => {
              const isSelected = selectedIds.includes(photo.id)
              return (
                <div
                  key={photo.id}
                  className={`relative aspect-square cursor-pointer overflow-hidden rounded-sm bg-gray-100 ${
                    isSelected ? 'ring-2 ring-blue-600' : ''
                  }`}
                  onClick={() => setActivePhoto(photo)}
                >
                  <img
                    src={photo.preview_url}
                    alt={photo.filename || 'Event photo'}
                    className="h-full w-full object-cover blur-[1px] contrast-105"
                    loading="lazy"
                  />
                  <Watermark />
                  <button
                    type="button"
                    aria-label={isSelected ? 'Remove photo from selection' : 'Select photo'}
                    aria-pressed={isSelected}
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation()
                      toggleSelect(photo.id)
                    }}
                    className={`absolute right-1.5 top-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-full border transition-all ${
                      isSelected
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-white bg-black/30 text-white'
                    }`}
                  >
                    ✓
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <GalleryFooter />
      </main>

      {selectedCount > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-40 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-neutral-900 shadow-2xl">
          <div>
            <div className="text-xs font-medium text-neutral-500">
              {selectedCount} {selectedCount === 1 ? 'Photo' : 'Photos'} Selected
            </div>
            <div className="text-lg font-bold">
              {new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(amount)}
            </div>
          </div>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-xs">
            {tipOptions.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={tip === value}
                onClick={() => setTip(value)}
                className={`rounded px-2 py-1 ${
                  tip === value
                    ? 'bg-white font-bold text-neutral-900 shadow-sm'
                    : 'text-neutral-600'
                }`}
              >
                {value === 0 ? 'No tip' : `+€${value}`}
              </button>
            ))}
          </div>
          <div className="flex flex-col items-end">
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-xl bg-gray-200 px-4 py-2.5 text-sm font-bold text-neutral-500"
            >
              Checkout unavailable
            </button>
            <span className="mt-1 text-[10px] text-neutral-500">
              Secure payment is not configured
            </span>
          </div>
        </div>
      )}

      {activePhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
          className="fixed inset-0 z-50 flex flex-col justify-between bg-white p-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500">Preview Shot</span>
            <button
              type="button"
              onClick={() => setActivePhoto(null)}
              aria-label="Close photo preview"
              className="p-2 text-2xl font-bold text-neutral-900"
            >
              ✕
            </button>
          </div>
          <div className="relative my-4 flex flex-1 items-center justify-center">
            <img
              src={activePhoto.preview_url}
              alt={activePhoto.filename || 'Event photo preview'}
              className="max-h-full max-w-full rounded object-contain"
              loading="lazy"
            />
            <Watermark large />
          </div>
          <button
            type="button"
            onClick={() => {
              toggleSelect(activePhoto.id)
              setActivePhoto(null)
            }}
            className="w-full rounded-xl bg-neutral-900 py-3 text-sm font-bold text-white"
          >
            {selectedIds.includes(activePhoto.id) ? 'Remove from Selection' : 'Select Photo'}
          </button>
        </div>
      )}
    </div>
  )
}
