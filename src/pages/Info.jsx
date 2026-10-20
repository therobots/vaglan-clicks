import { useEffect } from 'react'
import GalleryHeader from '@/components/gallery/GalleryHeader'
import GalleryTabs from '@/components/gallery/GalleryTabs'
import GalleryFooter from '@/components/gallery/GalleryFooter'
import { applyDocumentLanguage, galleryText, useGalleryLanguage } from '@/lib/galleryLanguage'

export default function Info() {
  const language = useGalleryLanguage()
  const text = galleryText[language]

  useEffect(() => {
    applyDocumentLanguage(language)
  }, [language])

  return (
    <div className="min-h-screen bg-white pt-14 font-sans text-neutral-900">
      <GalleryHeader photoCount={undefined} children={<span className="sr-only">Photo information</span>} />
      <main className="mx-auto max-w-3xl">
        <GalleryTabs active="info" />
        <article className="px-5 py-10 sm:px-8">
          <h1 className="text-2xl font-black tracking-tight">{text.infoTitle}</h1>
          <p className="mt-3 text-sm leading-6 text-neutral-600">{text.infoIntro}</p>
          <div className="mt-8 space-y-7">
            {[
              [text.privacyTitle, text.privacyText],
              [text.retentionTitle, text.retentionText],
              [text.removalInfoTitle, text.removalInfoText],
              [text.contactTitle, text.contactText],
              [text.legalTitle, text.legalText],
            ].map(([title, body]) => (
              <section key={title}>
                <h2 className="text-sm font-bold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-neutral-600">{body}</p>
              </section>
            ))}
          </div>
          <a href="/" className="mt-9 inline-flex rounded-xl bg-black px-4 py-3 text-sm font-bold text-white">
            {text.backToPhotos}
          </a>
        </article>
        <GalleryFooter language={language} />
      </main>
    </div>
  )
}
