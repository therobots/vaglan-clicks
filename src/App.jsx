import React, { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

export default function App() {
  const [photos, setPhotos] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [activeFilter, setActiveFilter] = useState('ALL')
  const [activePhoto, setActivePhoto] = useState(null)
  const [tip, setTip] = useState(0)

  // 1. Fetch live photos from Supabase on load
  useEffect(() => {
    async function getPhotos() {
      const { data, error } = await supabase
        .from('photos')
        .select('*')
        .order('timestamp', { ascending: false })

      if (!error && data) setPhotos(data)
    }
    getPhotos()

    // 2. Realtime listener: Auto-prepend new photos when taken on camera
    const channel = supabase
      .channel('realtime_photos')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'photos' }, (payload) => {
        setPhotos((prev) => [payload.new, ...prev])
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // Toggle selection state (Apple Photos style)
  const toggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  // Calculate price: €2.00 base + €0.50 per additional photo + tip
  const calculateTotal = () => {
    if (selectedIds.length === 0) return 0
    const base = 2.00
    const addOns = (selectedIds.length - 1) * 0.50
    return (base + addOns + tip).toFixed(2)
  }

  // Time-based filtering logic
  const filteredPhotos = photos.filter((photo) => {
    if (activeFilter === 'ALL') return true
    const hour = new Date(photo.timestamp * 1000).getHours()
    if (activeFilter === '23-00') return hour === 23
    if (activeFilter === '00-01') return hour === 0
    if (activeFilter === '01-02') return hour === 1
    if (activeFilter === '02-03') return hour === 2
    return true
  })

  const handleCheckout = () => {
    // Redirect to your Stripe Payment Link or backend checkout
    alert(`Redirecting to Stripe to pay €${calculateTotal()} for ${selectedIds.length} photo(s)...`)
  }

  return (
    <div className="min-h-screen bg-white text-black font-sans pb-24 select-none">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center">
        <h1 className="font-extrabold tracking-wider text-base">@VAGLAN_CLICKS</h1>
        <div className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full text-xs font-semibold">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span>Syncing Live</span>
        </div>
      </header>

      {/* 48h Expiry Banner */}
      <div className="bg-black text-white text-center py-2 text-xs font-medium tracking-wide">
        ⚡ Tonight's gallery expires in 48 hours. Pick your shots before auto-purge!
      </div>

      {/* Time-Based Filter Pills */}
      <div className="flex gap-2 overflow-x-auto px-4 py-3 border-b border-gray-100 scrollbar-none text-xs">
        {[
          { label: '🔥 All Shots', value: 'ALL' },
          { label: '11 PM – 12 AM', value: '23-00' },
          { label: '12 AM – 1 AM', value: '00-01' },
          { label: '1 AM – 2 AM', value: '01-02' },
          { label: '2 AM – 3 AM', value: '02-03' },
        ].map((pill) => (
          <button
            key={pill.value}
            onClick={() => setActiveFilter(pill.value)}
            className={`px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
              activeFilter === pill.value
                ? 'bg-black text-white font-bold'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* 3-Column Mobile Photo Grid */}
      <main className="p-1">
        <div className="grid grid-cols-3 gap-1">
          {filteredPhotos.map((photo) => {
            const isSelected = selectedIds.includes(photo.id)
            return (
              <div
                key={photo.id}
                className={`relative aspect-square bg-gray-100 overflow-hidden cursor-pointer rounded-sm ${
                  isSelected ? 'ring-2 ring-blue-600' : ''
                }`}
                onClick={() => setActivePhoto(photo)}
              >
                {/* Thumbnail Image */}
                <img
                  src={photo.preview_url}
                  alt="Party Shot"
                  className="w-full h-full object-cover filter blur-[1px] contrast-105"
                  loading="lazy"
                />

                {/* Selection Checkbox (Top Right) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleSelect(photo.id)
                  }}
                  className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center border transition-all ${
                    isSelected
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-black/30 border-white text-transparent'
                  }`}
                >
                  ✓
                </button>
              </div>
            )
          })}
        </div>
      </main>

      {/* Footer Marketing Banner */}
      <footer className="mt-8 px-4 py-6 text-center border-t border-gray-100 text-xs text-gray-600">
        <p className="font-semibold text-black">Want to see more event highlights?</p>
        <a
          href="https://instagram.com/vaglan_clicks"
          target="_blank"
          rel="noreferrer"
          className="inline-block mt-2 font-bold text-black border-b border-black pb-0.5"
        >
          Follow @vaglan_clicks on Instagram →
        </a>
      </footer>

      {/* Floating Sticky Cart Bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-40 bg-black text-white rounded-2xl shadow-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-400 font-medium">
              {selectedIds.length} {selectedIds.length === 1 ? 'Photo' : 'Photos'} Selected
            </div>
            <div className="text-lg font-bold">€{calculateTotal()}</div>
          </div>

          {/* Tip Toggle */}
          <div className="flex gap-1 bg-gray-900 p-1 rounded-lg text-xs">
            {[0, 1, 2].map((amount) => (
              <button
                key={amount}
                onClick={() => setTip(amount)}
                className={`px-2 py-1 rounded ${
                  tip === amount ? 'bg-white text-black font-bold' : 'text-gray-400'
                }`}
              >
                {amount === 0 ? 'No tip' : `+€${amount}`}
              </button>
            ))}
          </div>

          <button
            onClick={handleCheckout}
            className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-colors"
          >
            Checkout →
          </button>
        </div>
      )}

      {/* Full-Screen Lightbox Modal */}
      {activePhoto && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col justify-between p-4">
          <div className="flex justify-between items-center text-white">
            <span className="text-xs text-gray-400">Preview Shot</span>
            <button
              onClick={() => setActivePhoto(null)}
              className="text-white text-2xl font-bold p-2"
            >
              ✕
            </button>
          </div>

          <div className="relative flex-1 flex items-center justify-center my-4">
            <img
              src={activePhoto.preview_url}
              alt="Preview"
              className="max-h-full max-w-full object-contain rounded"
            />
          </div>

          <button
            onClick={() => {
              toggleSelect(activePhoto.id)
              setActivePhoto(null)
            }}
            className={`w-full py-3 rounded-xl font-bold text-sm ${
              selectedIds.includes(activePhoto.id)
                ? 'bg-red-600 text-white'
                : 'bg-blue-600 text-white'
            }`}
          >
            {selectedIds.includes(activePhoto.id)
              ? 'Remove from Selection'
              : 'Select Photo'}
          </button>
        </div>
      )}
    </div>
  )
}