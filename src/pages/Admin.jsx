import { useEffect, useState } from 'react'
import { LogOut, LockKeyhole, Trash2 } from 'lucide-react'
import { isSupabaseConfigured, supabase } from '@/supabaseClient'

const SESSION_KEY = 'vaglan-gallery-admin-session'

const readStoredSession = () => {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) || ''
  } catch {
    return ''
  }
}

const storeSession = (token) => {
  try {
    if (token) window.sessionStorage.setItem(SESSION_KEY, token)
    else window.sessionStorage.removeItem(SESSION_KEY)
  } catch {
    throw new Error('Browser session storage is unavailable. Enable it to sign in.')
  }
}

const invokeAdmin = async (body) => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.')
  }
  const { data, error } = await supabase.functions.invoke('gallery-admin', { body })
  if (error) {
    let message = error.message
    try {
      const response = error.context
      const responseBody = response instanceof Response ? await response.clone().json() : null
      if (responseBody?.error) message = responseBody.error
    } catch {
      // The transport may not expose a JSON error response.
    }
    if (message === 'Failed to send a request to the Edge Function') {
      message =
        'Could not reach the gallery-admin Edge Function. Confirm it is deployed to the same Supabase project as VITE_SUPABASE_URL and that the project is reachable, then try again.'
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : 'Unknown time'

export default function Admin() {
  const [sessionToken, setSessionToken] = useState(readStoredSession)
  const [pin, setPin] = useState('')
  const [photos, setPhotos] = useState([])
  const [timerEndsAt, setTimerEndsAt] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!sessionToken) return undefined
    let active = true
    invokeAdmin({ action: 'list-photos', sessionToken })
      .then((result) => {
        if (active) setPhotos(result.photos || [])
      })
      .catch((requestError) => {
        if (!active) return
        setError(requestError.message || 'Unable to load the photo list.')
        if (requestError.message?.includes('session expired')) {
          storeSession('')
          setSessionToken('')
        }
      })
    return () => {
      active = false
    }
  }, [sessionToken])

  const runAdminAction = async (key, action, extra = {}) => {
    setBusyAction(key)
    setError('')
    setNotice('')
    try {
      return await invokeAdmin({ action, sessionToken, ...extra })
    } catch (requestError) {
      setError(requestError.message || 'The admin operation failed.')
      return null
    } finally {
      setBusyAction('')
    }
  }

  const handleLogin = async (event) => {
    event.preventDefault()
    setBusyAction('login')
    setError('')
    try {
      const result = await invokeAdmin({ action: 'login', pin })
      storeSession(result.sessionToken)
      setSessionToken(result.sessionToken)
      setPin('')
      setNotice('Admin access granted.')
    } catch (requestError) {
      setError(requestError.message || 'Unable to verify the PIN.')
    } finally {
      setBusyAction('')
    }
  }

  const makeFree = async (photoId) => {
    const result = await runAdminAction(photoId, 'make-free', { photoId })
    if (!result) return
    setPhotos((current) =>
      current.map((photo) => (photo.id === photoId ? { ...photo, is_free: true } : photo)),
    )
    setNotice('Photo marked free.')
  }

  const deletePhoto = async (photo) => {
    if (!window.confirm(`Permanently delete "${photo.filename || 'this photo'}" and its stored files?`)) {
      return
    }
    const result = await runAdminAction(photo.id, 'delete-photo', { photoId: photo.id })
    if (!result) return
    setPhotos((current) => current.filter((item) => item.id !== photo.id))
    setNotice('Photo and stored files deleted.')
  }

  const resetGallery = async () => {
    const confirmed = window.confirm(
      'DANGER: This permanently deletes every photo record and every preview object in the "photos" bucket. High-resolution originals in "photo-originals" will be retained. Continue?',
    )
    if (!confirmed) return
    if (window.prompt('Type RESET to permanently reset the gallery.') !== 'RESET') {
      setNotice('Gallery reset cancelled.')
      return
    }
    const result = await runAdminAction('reset', 'reset-gallery')
    if (!result) return
    setPhotos([])
    setNotice(`Gallery reset. ${result.deletedCount} photo records removed; originals retained.`)
  }

  const startTimer = async () => {
    const result = await runAdminAction('timer', 'start-timer')
    if (!result) return
    setTimerEndsAt(result.timerEndsAt)
    setNotice(`48-hour timer started. It ends ${formatDate(result.timerEndsAt)}.`)
  }

  const logout = () => {
    storeSession('')
    setSessionToken('')
    setPhotos([])
    setNotice('')
    setError('')
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 text-neutral-900">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
              Vaglan Clicks
            </p>
            <h1 className="mt-1 text-2xl font-black">Gallery Admin</h1>
          </div>
          {sessionToken && (
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          )}
        </header>

        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {notice}
          </p>
        )}

        {!sessionToken ? (
          <form
            onSubmit={handleLogin}
            className="mx-auto max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <LockKeyhole className="mb-4 h-6 w-6" />
            <h2 className="text-lg font-bold">Admin PIN</h2>
            <p className="mt-1 text-sm text-gray-500">
              The PIN is verified securely by the server.
            </p>
            <label htmlFor="admin-pin" className="mt-5 block text-sm font-semibold">
              PIN
            </label>
            <input
              id="admin-pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              required
              minLength={4}
              maxLength={128}
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="submit"
              disabled={busyAction === 'login' || !isSupabaseConfigured}
              className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {busyAction === 'login' ? 'Verifying…' : 'Unlock dashboard'}
            </button>
            {!isSupabaseConfigured && (
              <p className="mt-3 text-xs text-red-700">
                Configure the Supabase Vite environment variables to use admin tools.
              </p>
            )}
          </form>
        ) : (
          <>
            <section className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-5">
              <div>
                <h2 className="font-bold">48-hour gallery timer</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {timerEndsAt ? `Last started: ${formatDate(timerEndsAt)}` : 'Start or restart the public countdown.'}
                </p>
              </div>
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={startTimer}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {busyAction === 'timer' ? 'Starting…' : 'Start 48h Timer'}
              </button>
            </section>

            <section className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Photos ({photos.length})</h2>
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={resetGallery}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-bold text-red-700 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Reset Gallery
              </button>
            </section>

            {photos.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
                No photos found.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {photos.map((photo) => (
                  <article key={photo.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <img
                      src={photo.preview_url}
                      alt={photo.filename || 'Gallery photo'}
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                    />
                    <div className="p-3">
                      <p className="truncate text-xs font-semibold" title={photo.filename || ''}>
                        {photo.filename || 'Untitled photo'}
                      </p>
                      <p className="mt-1 text-[10px] text-gray-500">{formatDate(photo.timestamp)}</p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={photo.is_free || Boolean(busyAction)}
                          onClick={() => makeFree(photo.id)}
                          className="flex-1 rounded-md border border-gray-300 px-2 py-2 text-xs font-bold disabled:opacity-50"
                        >
                          {photo.is_free ? 'Free' : 'Make Free'}
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busyAction)}
                          onClick={() => deletePhoto(photo)}
                          aria-label={`Delete ${photo.filename || 'photo'}`}
                          className="grid h-8 w-8 place-items-center rounded-md border border-red-200 text-red-700 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
