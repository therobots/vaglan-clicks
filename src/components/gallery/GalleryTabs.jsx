import { useEffect } from 'react'
import { applyDocumentLanguage, galleryText, persistLanguage, useGalleryLanguage } from '@/lib/galleryLanguage'

export default function GalleryTabs({ active }) {
  const language = useGalleryLanguage()
  const text = galleryText[language]

  useEffect(() => {
    applyDocumentLanguage(language)
  }, [language])

  const changeLanguage = (nextLanguage) => {
    persistLanguage(nextLanguage)
  }

  return (
    <nav aria-label="Gallery pages" className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
      <div className="flex gap-5 text-xs font-semibold">
        <a
          href="/"
          aria-current={active === 'photos' ? 'page' : undefined}
          className={active === 'photos' ? 'border-b-2 border-black pb-2 text-black' : 'pb-2 text-neutral-500'}
        >
          {text.photos}
        </a>
        <a
          href="/info"
          aria-current={active === 'info' ? 'page' : undefined}
          className={active === 'info' ? 'border-b-2 border-black pb-2 text-black' : 'pb-2 text-neutral-500'}
        >
          {text.information}
        </a>
      </div>
      <div className="flex gap-1 text-[11px] font-semibold" aria-label="Language">
        {['en', 'el'].map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={language === option}
            onClick={() => changeLanguage(option)}
            className={`rounded px-1.5 py-1 uppercase ${language === option ? 'bg-black text-white' : 'text-neutral-500'}`}
          >
            {option}
          </button>
        ))}
      </div>
    </nav>
  )
}
