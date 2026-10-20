import { useState } from 'react'
import { X } from 'lucide-react'
import { galleryText } from '@/lib/galleryLanguage'

export default function PhotoRemovalDialog({ open, language = 'en', busy = false, error = '', onClose, onSubmit }) {
  const [reason, setReason] = useState('')
  const [contact, setContact] = useState('')
  const text = galleryText[language]
  if (!open) return null

  const submit = async (event) => {
    event.preventDefault()
    const submitted = await onSubmit({ reason: reason.trim(), contact: contact.trim() })
    if (submitted) {
      setReason('')
      setContact('')
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="removal-title"
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="removal-title" className="text-lg font-black">{text.removalTitle}</h2>
            <p className="mt-2 text-sm leading-5 text-neutral-600">{text.removalText}</p>
          </div>
          <button type="button" disabled={busy} onClick={onClose} aria-label={text.cancel} className="rounded-full p-1 text-neutral-500 disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className="mt-5 block text-xs font-bold" htmlFor="removal-reason">{text.reason}</label>
        <textarea
          id="removal-reason"
          maxLength={1000}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-sm"
        />
        <label className="mt-4 block text-xs font-bold" htmlFor="removal-contact">{text.contact}</label>
        <input
          id="removal-contact"
          type="text"
          maxLength={320}
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-sm"
        />
        {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="flex-1 rounded-xl border border-neutral-300 px-3 py-3 text-sm font-bold disabled:opacity-50">
            {text.cancel}
          </button>
          <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-black px-3 py-3 text-sm font-bold text-white disabled:opacity-50">
            {busy ? '…' : text.submitRemoval}
          </button>
        </div>
      </form>
    </div>
  )
}
