import React, { useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from './supabaseClient'

const HOUR_FILTERS = [
  { label: '🔥 All Shots', value: 'ALL' },
  { label: '11 PM – 12 AM', value: 23 },
  { label: '12 AM – 1 AM', value: 0 },
  { label: '1 AM – 2 AM', value: 1 },
  { label: '2 AM – 3 AM', value: 2 },
]

const photoTime = (photo) => {
  const value = photo.timestamp ?? photo.created_at ?? photo.created_date
  if (typeof value === 'number') {
    return value < 1e12 ? value * 1000 : value
  }
  return value ? Date.parse(value) : Number.NaN
}

const sortPhotos = (photos) =>
  [...photos].sort((a, b) => photoTime(b) - photoTime(a))

const mergePhotos = (current, incoming) => {
  const byId = new Map(current.map((photo) => [photo.id, photo]))
  for (const photo of incoming) {
    byId.set(photo.id, photo)
  }
  return sortPhotos([...byId.values()])
}

export default function App() {
  const [photos, setPhotos] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [activeFilter, setActiveFilter] = useState('ALL')
  const [activePhoto, setActivePhoto] = useState(null)
  const [tip, setTip] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('offline')

  useEffect(() => {
    let active = true

    if (!isSupabaseConfigured || !supabase) {
      setLoadError('Gallery is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect Supabase.')
      setLoading(false)
      return undefined
    }

    const loadPhotos = async () => {
      const { data, error } = await supabase
        .from('photos')
        .select('*')
        .order('timestamp', { ascending: false })

      if (!active) return
      if (error) {
        setLoadError(`Could not load photos: ${error.message}`)
      } else {
        setPhotos((current) => mergePhotos(data || [], current))
        setLoadError('')
      }
      setLoading(false)
    }

    loadPhotos().catch((error) => {
      if (!active) return
      setLoadError(`Could not load photos: ${error.message || 'Unknown error'}`)
      setLoading(false)
    })

    const channel = supabase
      .channel('realtime_photos')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'photos' }, (payload) => {
        if (active) setPhotos((current) => mergePhotos(current, [payload.new]))
      })
      .subscribe((status) => {
        if (!active) return
        setConnectionStatus(status === 'SUBSCRIBED' ? 'live' : 'offline')
      })

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const toggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const calculateTotal = () => {
    if (selectedIds.length === 0) return '0.00'
    const base = 2
    const addOns = (selectedIds.length - 1) * 0.5
    return (base + addOns + tip).toFixed(2)
  }

  const filteredPhotos = photos.filter((photo) => {
    if (activeFilter === 'ALL') return true
    const timestamp = photoTime(photo)
    return Number.isFinite(timestamp) && new Date(timestamp).getHours() === activeFilter
  })

  return (
    <div className="min-h-screen bg-white pb-24 font-sans text-black">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-base font-extrabold tracking-wider">@VAGLAN_CLICKS</h1>
        <div className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold">
          <span
            className={`h-2 w-2 rounded-full ${
              connectionStatus === 'live' ? 'animate-pulse bg-green-500' : 'bg-gray-400'
            }`}
          />
          <span>{connectionStatus === 'live' ? 'Live updates on' : 'Not connected'}</span>
        </div>
      </header>

      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex gap-2 overflow-x-auto text-xs">
          {HOUR_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setActiveFilter(filter.value)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 transition-colors ${
                activeFilter === filter.value
                  ? 'bg-black font-bold text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {loadError && (
        <p role="alert" className="mx-auto max-w-2xl px-4 py-4 text-center text-sm text-red-700">
          {loadError}
        </p>
      )}

      <main className="p-1">
        {loading ? (
          <p className="py-16 text-center text-sm text-gray-500" role="status">
            Loading photos…
          </p>
        ) : filteredPhotos.length === 0 && !loadError ? (
          <p className="py-16 text-center text-sm text-gray-500">
            {photos.length === 0 ? 'No photos have been uploaded yet.' : 'No photos in this hour.'}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1">
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
                  <button
                    type="button"
                    aria-label={isSelected ? 'Remove photo from selection' : 'Select photo'}
                    aria-pressed={isSelected}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleSelect(photo.id)
                    }}
                    className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border transition-all ${
                      isSelected
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-white bg-black/30 text-transparent'
                    }`}
                  >
                    ✓
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {selectedIds.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-40 flex items-center justify-between gap-3 rounded-2xl bg-black p-4 text-white shadow-2xl">
          <div>
            <div className="text-xs font-medium text-gray-400">
              {selectedIds.length} {selectedIds.length === 1 ? 'Photo' : 'Photos'} Selected
            </div>
            <div className="text-lg font-bold">€{calculateTotal()}</div>
          </div>

          <div className="flex gap-1 rounded-lg bg-gray-900 p-1 text-xs">
            {[0, 1, 2].map((amount) => (
              <button
                key={amount}
                type="button"
                aria-pressed={tip === amount}
                onClick={() => setTip(amount)}
                className={`rounded px-2 py-1 ${
                  tip === amount ? 'bg-white font-bold text-black' : 'text-gray-400'
                }`}
              >
                {amount === 0 ? 'No tip' : `+€${amount}`}
              </button>
            ))}
          </div>

          <div className="flex flex-col items-end">
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-xl bg-gray-600 px-4 py-2.5 text-sm font-bold text-white opacity-70"
            >
              Checkout unavailable
            </button>
            <span className="mt-1 text-[10px] text-gray-400">Secure payment is not configured</span>
          </div>
        </div>
      )}

      {activePhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
          className="fixed inset-0 z-50 flex flex-col justify-between bg-black/95 p-4"
        >
          <div className="flex items-center justify-between text-white">
            <span className="text-xs text-gray-400">Preview Shot</span>
            <button
              type="button"
              onClick={() => setActivePhoto(null)}
              aria-label="Close photo preview"
              className="p-2 text-2xl font-bold text-white"
            >
              ✕
            </button>
          </div>

          <div className="relative my-4 flex flex-1 items-center justify-center">
            <img
              src={activePhoto.preview_url}
              alt={activePhoto.filename || 'Event photo preview'}
              className="max-h-full max-w-full rounded object-contain"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              toggleSelect(activePhoto.id)
              setActivePhoto(null)
            }}
            className={`w-full rounded-xl py-3 text-sm font-bold text-white ${
              selectedIds.includes(activePhoto.id) ? 'bg-red-600' : 'bg-blue-600'
            }`}
          >
            {selectedIds.includes(activePhoto.id) ? 'Remove from Selection' : 'Select Photo'}
          </button>
        </div>
      )}
    </div>
  )
}
