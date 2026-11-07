import { useEffect, useState } from 'react'
import { Download, LogOut, LockKeyhole, QrCode, Trash2, Upload, RefreshCw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { isSupabaseConfigured, supabase } from '@/supabaseClient'
import { formatAthensDateTime, formatAthensHour, nightKey, parseTimestamp } from '@/lib/timeBuckets'
import { formatMoney } from '@/lib/money'
import { createWatermarkedPreviews, blobToBase64 } from '@/lib/watermarkImage'

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

const formatDate = (value) => {
  const timestamp = parseTimestamp(value)
  return Number.isFinite(timestamp) ? formatAthensDateTime(timestamp) : 'Unknown time'
}

export default function Admin() {
  const [sessionToken, setSessionToken] = useState(readStoredSession)
  const [pin, setPin] = useState('')
  const [photos, setPhotos] = useState([])
  const [removalRequests, setRemovalRequests] = useState([])
  const [nightReports, setNightReports] = useState([])
  const [sales, setSales] = useState([])
  const [selectedPhotoIds, setSelectedPhotoIds] = useState([])
  const [nightFilter, setNightFilter] = useState('')
  const [hourFilter, setHourFilter] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [uploadAlbum, setUploadAlbum] = useState('general')
  const [uploadStatus, setUploadStatus] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [reprocessStatus, setReprocessStatus] = useState('')
  const [isReprocessing, setIsReprocessing] = useState(false)

  const reloadData = async (token = sessionToken) => {
    if (!token) return
    try {
      const [photoResult, removalResult, reportResult, salesResult] = await Promise.all([
        invokeAdmin({ action: 'list-photos', sessionToken: token }),
        invokeAdmin({ action: 'list-removals', sessionToken: token }),
        invokeAdmin({ action: 'gallery-report', sessionToken: token }),
        invokeAdmin({ action: 'sales-report', sessionToken: token }),
      ])
      setPhotos(photoResult.photos || [])
      setRemovalRequests(removalResult.requests || [])
      setNightReports(reportResult.nights || [])
      setSales(salesResult.sales || [])
    } catch (requestError) {
      setError(requestError.message || 'Unable to reload data.')
    }
  }

  useEffect(() => {
    if (!sessionToken) return undefined
    let active = true
    Promise.all([
      invokeAdmin({ action: 'list-photos', sessionToken }),
      invokeAdmin({ action: 'list-removals', sessionToken }),
      invokeAdmin({ action: 'gallery-report', sessionToken }),
      invokeAdmin({ action: 'sales-report', sessionToken }),
    ])
      .then(([photoResult, removalResult, reportResult, salesResult]) => {
        if (!active) return
        setPhotos(photoResult.photos || [])
        setRemovalRequests(removalResult.requests || [])
        setNightReports(reportResult.nights || [])
        setSales(salesResult.sales || [])
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

  const handleUploadPhotos = async (event) => {
    const fileList = event.target.files
    if (!fileList || !fileList.length) return
    const files = Array.from(fileList)
    setIsUploading(true)
    setError('')
    setNotice('')
    try {
      let completed = 0
      for (const file of files) {
        setUploadStatus(
          `Photo ${completed + 1} of ${files.length}: downscaling & baking watermark before upload...`,
        )
        const { previewBase64, thumbnailBase64 } = await createWatermarkedPreviews(file)
        const originalBase64 = await blobToBase64(file)
        const timestamp = file.lastModified || Date.now()

        setUploadStatus(`Uploading photo ${completed + 1} of ${files.length} to Supabase...`)
        await invokeAdmin({
          action: 'ingest-photo',
          sessionToken,
          filename: file.name,
          timestamp,
          albumId: uploadAlbum || 'general',
          originalBase64,
          previewBase64,
          thumbnailBase64,
          originalMimeType: file.type || 'image/jpeg',
        })
        completed += 1
      }
      setNotice(`Successfully watermarked and uploaded ${files.length} photo(s).`)
      setUploadStatus('')
      event.target.value = ''
      await reloadData()
    } catch (err) {
      setError(`Upload failed: ${err.message}`)
    } finally {
      setIsUploading(false)
    }
  }

  const handleReprocessExisting = async () => {
    const unwatermarked = photos.filter((p) => !p.thumbnail_url)
    const targets = unwatermarked.length ? unwatermarked : photos
    if (!targets.length) {
      setNotice('No photos available to reprocess.')
      return
    }
    const confirmed = window.confirm(
      `This will process ${targets.length} photo(s): downloading previews, downscaling to 1280px WebP, physically burning in the watermark, and saving new thumbnails to Supabase. Continue?`,
    )
    if (!confirmed) return

    setIsReprocessing(true)
    setError('')
    setNotice('')
    try {
      let completed = 0
      for (const photo of targets) {
        setReprocessStatus(
          `Reprocessing photo ${completed + 1} of ${targets.length}: "${photo.filename || photo.id}"...`,
        )
        const { previewBase64, thumbnailBase64 } = await createWatermarkedPreviews(photo.preview_url)
        await invokeAdmin({
          action: 'update-photo-preview',
          sessionToken,
          photoId: photo.id,
          filename: photo.filename,
          timestamp: photo.timestamp,
          previewBase64,
          thumbnailBase64,
        })
        completed += 1
      }
      setNotice(
        `Successfully reprocessed ${completed} photo(s). Previews now have physically burned-in watermarks and lower resolution WebP quality.`,
      )
      setReprocessStatus('')
      await reloadData()
    } catch (err) {
      setError(`Reprocessing failed: ${err.message}`)
    } finally {
      setIsReprocessing(false)
    }
  }

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

  const togglePhotoSelection = (photoId) => {
    setSelectedPhotoIds((current) =>
      current.includes(photoId)
        ? current.filter((id) => id !== photoId)
        : [...current, photoId],
    )
  }

  const makeSelectedFree = async () => {
    const result = await runAdminAction('bulk-free', 'make-free-bulk', {
      photoIds: selectedPhotoIds,
    })
    if (!result) return
    const updatedIds = new Set(result.updatedIds || [])
    setPhotos((current) =>
      current.map((photo) => updatedIds.has(photo.id) ? { ...photo, is_free: true } : photo),
    )
    setNotice(`${updatedIds.size} selected photos marked free.`)
  }

  const deleteSelected = async () => {
    if (!window.confirm(`Permanently delete ${selectedPhotoIds.length} selected photos and their stored files?`)) {
      return
    }
    if (window.prompt('Type DELETE to permanently delete the selected photos.') !== 'DELETE') return
    const result = await runAdminAction('bulk-delete', 'delete-photos-bulk', {
      photoIds: selectedPhotoIds,
    })
    if (!result) return
    const deletedIds = new Set(result.deletedIds || [])
    setPhotos((current) => current.filter((photo) => !deletedIds.has(photo.id)))
    setSelectedPhotoIds([])
    setNotice(result.failures?.length
      ? `${deletedIds.size} photos deleted; ${result.failures.length} failed. Review the error details below.`
      : `${deletedIds.size} photos and their stored files deleted.`)
    if (result.failures?.length) {
      setError(result.failures.map((failure) => `${failure.photoId}: ${failure.error}`).join('; '))
    }
  }

  const resolveRemoval = async (request, action) => {
    if (action === 'delete-removal' && !window.confirm('Permanently delete this photo and its stored files?')) {
      return
    }
    const result = await runAdminAction(request.request_id, action, { requestId: request.request_id })
    if (!result) return
    setRemovalRequests((current) =>
      current.map((item) => item.request_id === request.request_id
        ? { ...item, status: action === 'restore-removal' ? 'restored' : 'deleted', contact: null, reason: null }
        : item),
    )
    if (action === 'delete-removal') {
      setPhotos((current) => current.filter((photo) => photo.id !== request.photo_id))
      setNotice('Photo permanently deleted and removal request closed.')
    } else {
      setPhotos((current) =>
        current.map((photo) => photo.id === request.photo_id
          ? { ...photo, is_hidden: false, hidden_at: null }
          : photo),
      )
      setNotice('Photo restored to the public gallery.')
    }
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
      'DANGER: This permanently deletes every photo record and every preview object in the "previews" and legacy "photos" buckets. High-resolution originals in "originals" and "photo-originals" will be retained. Continue?',
    )
    if (!confirmed) return
    if (window.prompt('Type RESET to permanently reset the gallery.') !== 'RESET') {
      setNotice('Gallery reset cancelled.')
      return
    }
    const result = await runAdminAction('reset', 'reset-gallery')
    if (!result) return
    setPhotos([])
    setRemovalRequests([])
    setNightReports([])
    setSales([])
    setSelectedPhotoIds([])
    setNotice(`Gallery reset. ${result.deletedCount} photo records removed; originals retained.`)
  }

  const logout = () => {
    storeSession('')
    setSessionToken('')
    setPhotos([])
    setRemovalRequests([])
    setNightReports([])
    setSales([])
    setSelectedPhotoIds([])
    setNotice('')
    setError('')
  }

  const galleryUrl = `${window.location.origin}/`
  const nightKeys = [...new Set(photos.map((photo) => nightKey(photo.timestamp)).filter(Boolean))]
  const hourKeys = [...new Set(
    photos
      .filter((photo) => !nightFilter || nightKey(photo.timestamp) === nightFilter)
      .map((photo) => formatAthensHour(photo.timestamp))
      .filter(Boolean),
  )].sort()
  const filteredPhotos = photos.filter((photo) =>
    (!nightFilter || nightKey(photo.timestamp) === nightFilter) &&
    (!hourFilter || formatAthensHour(photo.timestamp) === hourFilter),
  )
  const totalRevenueCents = sales.reduce((total, sale) => total + Number(sale.total_cents || 0), 0)
  const latestUploadReport = [...nightReports].sort(
    (left, right) => parseTimestamp(right.latest_upload) - parseTimestamp(left.latest_upload),
  )[0]
  const downloadQr = () => {
    const svg = document.querySelector('#gallery-qr-code')
    if (!svg) {
      setError('Could not find the gallery QR code to download.')
      return
    }
    const svgData = new XMLSerializer().serializeToString(svg)
    const url = URL.createObjectURL(new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'vaglan-clicks-gallery-qr.svg'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const downloadSalesCsv = () => {
    const columns = ['order_id', 'paid_at', 'email', 'photo_count', 'subtotal_cents', 'tip_cents', 'total_cents', 'currency', 'night_keys']
    const escapeCsv = (value) => {
      const text = String(value ?? '')
      const safeText = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text
      return `"${safeText.replaceAll('"', '""')}"`
    }
    const csv = [
      columns.join(','),
      ...sales.map((sale) => columns.map((column) => escapeCsv(sale[column])).join(',')),
    ].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'vaglan-clicks-sales.csv'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 text-neutral-900">
      <div className="mx-auto max-w-7xl">
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
            <section className="mb-6 grid gap-4 md:grid-cols-3">
              <article className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-bold"><QrCode className="h-4 w-4" /> Public gallery QR</div>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <QRCodeSVG id="gallery-qr-code" value={galleryUrl} size={128} level="M" includeMargin />
                  <div className="min-w-0">
                    <p className="break-all text-xs text-gray-500">{galleryUrl}</p>
                    <button type="button" onClick={downloadQr} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold">
                      <Download className="h-3.5 w-3.5" /> Download QR
                    </button>
                  </div>
                </div>
              </article>
              <article className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-bold">Sales overview</h2>
                <p className="mt-3 text-2xl font-black">{sales.length} paid orders</p>
                <p className="mt-1 text-sm text-gray-600">{formatMoney(totalRevenueCents / 100, 'EUR')} gross including tips</p>
                <button type="button" disabled={!sales.length} onClick={downloadSalesCsv} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold disabled:opacity-50">
                  <Download className="h-3.5 w-3.5" /> Export sales CSV
                </button>
              </article>
              <article className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-bold">Latest ingestion</h2>
                {latestUploadReport ? (
                  <>
                    <p className="mt-3 text-sm font-semibold">{formatDate(latestUploadReport.latest_upload)}</p>
                    <p className="mt-1 text-xs text-gray-500">Latest uploaded photo in {latestUploadReport.night_key} (Athens night)</p>
                  </>
                ) : <p className="mt-3 text-sm text-gray-500">No timestamped photos are available.</p>}
              </article>
            </section>

            <section className="mb-6 grid gap-4 md:grid-cols-2">
              <article className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <Upload className="h-4 w-4 text-blue-600" /> Upload & Watermark Photos
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Select camera photos. They will be downscaled (1280px WebP) and physically watermarked in your browser before uploading to Supabase.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="text-xs font-semibold text-gray-600">
                    Album ID:
                    <input
                      type="text"
                      value={uploadAlbum}
                      onChange={(e) => setUploadAlbum(e.target.value.trim() || 'general')}
                      placeholder="general"
                      className="ml-2 w-28 rounded border border-gray-300 px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                    <Upload className="h-3.5 w-3.5" />
                    {isUploading ? 'Processing…' : 'Choose photos'}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={isUploading}
                      onChange={handleUploadPhotos}
                      className="hidden"
                    />
                  </label>
                </div>
                {uploadStatus && (
                  <p className="mt-2 text-xs font-medium text-blue-600 animate-pulse">
                    {uploadStatus}
                  </p>
                )}
              </article>

              <article className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <RefreshCw className="h-4 w-4 text-emerald-600" /> Reprocess Existing Photos
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Have unwatermarked photos already in the database? Click below to load them, bake the physical watermark into pixel data, downscale to WebP, and update Supabase.
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    disabled={isReprocessing || !photos.length}
                    onClick={handleReprocessExisting}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold hover:bg-gray-50 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isReprocessing ? 'animate-spin' : ''}`} />
                    {isReprocessing ? 'Reprocessing…' : 'Watermark existing photos'}
                  </button>
                  <span className="text-[11px] text-gray-400">
                    {photos.filter((p) => !p.thumbnail_url).length} photo(s) missing thumbnails
                  </span>
                </div>
                {reprocessStatus && (
                  <p className="mt-2 text-xs font-medium text-blue-600 animate-pulse">
                    {reprocessStatus}
                  </p>
                )}
              </article>
            </section>

            <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-bold">Nights and expiry</h2>
              {nightReports.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left text-xs">
                    <thead className="text-gray-500"><tr><th className="py-2">Athens night</th><th>Photos</th><th>Visible</th><th>Hidden</th><th>Expired</th><th>Next expiry</th><th>Paid orders</th><th>Photo revenue</th></tr></thead>
                    <tbody>{nightReports.map((night) => (
                      <tr key={night.night_key} className="border-t border-gray-100">
                        <td className="py-2 font-semibold">{night.night_key}</td>
                        <td>{night.total_photos}</td><td>{night.visible_photos}</td><td>{night.hidden_photos}</td><td>{night.expired_photos}</td><td>{night.next_expiry ? formatDate(night.next_expiry) : '—'}</td><td>{night.paid_orders}</td>
                        <td>{formatMoney(Number(night.photo_revenue_cents || 0) / 100, 'EUR')}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="mt-3 text-xs text-gray-500">No gallery-night data.</p>}
            </section>

            <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-bold">Photo removal requests ({removalRequests.filter((item) => item.status === 'pending').length} pending)</h2>
              </div>
              {removalRequests.filter((item) => item.status === 'pending').length === 0 ? (
                <p className="mt-3 text-xs text-gray-500">No pending requests.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {removalRequests.filter((item) => item.status === 'pending').map((request) => (
                    <article key={request.request_id} className="rounded-lg border border-gray-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-bold">{request.filename || request.photo_id}</p>
                          <p className="mt-1 text-[11px] text-gray-500">{formatDate(request.created_at)} · {request.paid_order_count} paid order(s)</p>
                          {request.reason && <p className="mt-2 text-xs">{request.reason}</p>}
                          {request.contact && <p className="mt-1 text-xs text-gray-600">{request.contact}</p>}
                          {request.abuse_flagged && <p className="mt-2 text-xs font-bold text-red-700">High recent request volume: {request.recent_hide_count} in the last hour.</p>}
                        </div>
                        <div className="flex gap-2">
                          <button type="button" disabled={Boolean(busyAction)} onClick={() => resolveRemoval(request, 'restore-removal')} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold disabled:opacity-50">Restore</button>
                          <button type="button" disabled={Boolean(busyAction)} onClick={() => resolveRemoval(request, 'delete-removal')} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50">Delete permanently</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Photos ({filteredPhotos.length} of {photos.length})</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  <select aria-label="Filter photos by night" value={nightFilter} onChange={(event) => { setNightFilter(event.target.value); setHourFilter('') }} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs">
                    <option value="">All Athens nights</option>
                    {nightKeys.map((night) => <option key={night} value={night}>{night}</option>)}
                  </select>
                  <select aria-label="Filter photos by hour" value={hourFilter} onChange={(event) => setHourFilter(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs">
                    <option value="">All hours</option>
                    {hourKeys.map((hour) => <option key={hour} value={hour}>{hour}:00 Athens time</option>)}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500">{selectedPhotoIds.length} selected</span>
                <button type="button" disabled={!selectedPhotoIds.length || Boolean(busyAction)} onClick={makeSelectedFree} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold disabled:opacity-50">Make selected free</button>
                <button type="button" disabled={!selectedPhotoIds.length || Boolean(busyAction)} onClick={deleteSelected} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50">Delete selected</button>
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={resetGallery}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-bold text-red-700 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Reset Gallery
                </button>
              </div>
            </section>

            {filteredPhotos.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
                No photos match the current filters.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {filteredPhotos.map((photo) => (
                  <article key={photo.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <img
                      src={photo.thumbnail_url || photo.preview_url}
                      alt={photo.filename || 'Gallery photo'}
                      loading="lazy"
                      decoding="async"
                      className="aspect-square w-full object-cover"
                    />
                    <div className="p-3">
                      <label className="mb-2 flex items-center gap-2 text-[11px] font-semibold">
                        <input type="checkbox" checked={selectedPhotoIds.includes(photo.id)} onChange={() => togglePhotoSelection(photo.id)} />
                        Select photo
                      </label>
                      <p className="truncate text-xs font-semibold" title={photo.filename || ''}>
                        {photo.filename || 'Untitled photo'}
                      </p>
                      <p className="mt-1 text-[10px] text-gray-500">{formatDate(photo.timestamp)}</p>
                      <p className="mt-1 text-[10px] font-semibold text-gray-500">
                        {photo.is_hidden ? 'Hidden' : photo.expires_at && Date.parse(photo.expires_at) <= Date.now() ? 'Expired' : 'Visible'} · {photo.is_free ? 'Free' : 'Paid'}
                      </p>
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
