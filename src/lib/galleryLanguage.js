import { useEffect, useState } from 'react'

export const LANGUAGES = ['en', 'el']
const LANGUAGE_KEY = 'vaglan-gallery-language'
const LANGUAGE_EVENT = 'gallery-language-change'

export const getInitialLanguage = () => {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_KEY)
    if (LANGUAGES.includes(stored)) return stored
  } catch {
    return 'en'
  }
  return navigator.language?.toLowerCase().startsWith('el') ? 'el' : 'en'
}

export const persistLanguage = (language) => {
  if (!LANGUAGES.includes(language)) throw new Error('Unsupported gallery language.')
  try {
    window.localStorage.setItem(LANGUAGE_KEY, language)
  } catch {
    window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: language }))
    return false
  }
  window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: language }))
  return true
}

export const useGalleryLanguage = () => {
  const [language, setLanguage] = useState(getInitialLanguage)
  useEffect(() => {
    const onChange = (event) => setLanguage(event.detail)
    const onStorage = (event) => {
      if (event.key === LANGUAGE_KEY) setLanguage(getInitialLanguage())
    }
    window.addEventListener(LANGUAGE_EVENT, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(LANGUAGE_EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return language
}

export const applyDocumentLanguage = (language) => {
  document.documentElement.lang = language
}

export const galleryText = {
  en: {
    photos: 'Photos',
    information: 'Information',
    followTitle: 'Want to see more shots & night highlights?',
    followSubtitle: 'Follow @vaglan_clicks on Instagram for full-night drops & updates.',
    followButton: 'Follow @vaglan_clicks',
    copyright: '© 2026 @vaglan_clicks. All rights reserved.',
    photoInfo: 'Photo information',
    orderInfo: 'Read photo information and request removal.',
    successInfo: 'Photo information and removal requests',
    noticeTitle: 'About these photos',
    noticeText: 'Photos are available for a limited time. You can request removal from the photo preview or read the photo information page.',
    dismiss: 'Got it',
    removalTitle: 'Request photo removal',
    removalText: 'This photo will be hidden immediately while the request is reviewed. Add details if you wish.',
    reason: 'Reason (optional)',
    contact: 'Email or contact details (optional)',
    submitRemoval: 'Hide photo and send request',
    cancel: 'Cancel',
    removalSent: 'The photo has been hidden and your request was sent.',
    removalFailed: 'Could not send the removal request. Please try again.',
    infoTitle: 'Photo information',
    infoIntro: 'Information about viewing, purchasing, and requesting removal of photos from @vaglan_clicks.',
    privacyTitle: 'Privacy and use',
    privacyText: 'Gallery previews are visible to visitors. Purchased originals are delivered through expiring, private download links. Payment is processed by Viva Payments; card details are not stored by this site.',
    retentionTitle: 'Availability and retention',
    retentionText: 'Photos are grouped by the Athens event night and are normally removed after the published availability period. A purchase does not extend public gallery visibility.',
    removalInfoTitle: 'Request removal',
    removalInfoText: 'Open a photo, choose “Request removal,” and submit the form. The image is hidden from the public gallery immediately. Requests are reviewed by the photographer; include contact information only if you want a reply.',
    contactTitle: 'Contact',
    contactText: 'For privacy or purchase questions, contact the photographer through @vaglan_clicks on Instagram.',
    legalTitle: 'Legal details',
    legalText: 'The operator should publish their legal name, business address, contact email, applicable privacy notice, processor details, and governing consumer terms before offering this service publicly.',
    backToPhotos: 'Back to photos',
    requestRemoval: 'Request removal',
  },
  el: {
    photos: 'Φωτογραφίες',
    information: 'Πληροφορίες',
    followTitle: 'Θέλεις περισσότερες φωτογραφίες και στιγμές από τη βραδιά;',
    followSubtitle: 'Ακολούθησε το @vaglan_clicks στο Instagram για νέες φωτογραφίες και ενημερώσεις.',
    followButton: 'Ακολούθησε @vaglan_clicks',
    copyright: '© 2026 @vaglan_clicks. Με επιφύλαξη παντός δικαιώματος.',
    photoInfo: 'Πληροφορίες φωτογραφιών',
    orderInfo: 'Διάβασε τις πληροφορίες και ζήτησε αφαίρεση φωτογραφίας.',
    successInfo: 'Πληροφορίες και αιτήματα αφαίρεσης',
    noticeTitle: 'Σχετικά με τις φωτογραφίες',
    noticeText: 'Οι φωτογραφίες είναι διαθέσιμες για περιορισμένο διάστημα. Μπορείς να ζητήσεις αφαίρεση από την προεπισκόπηση ή να διαβάσεις τη σελίδα πληροφοριών.',
    dismiss: 'Εντάξει',
    removalTitle: 'Αίτημα αφαίρεσης φωτογραφίας',
    removalText: 'Η φωτογραφία θα αποκρυφτεί αμέσως όσο εξετάζεται το αίτημα. Πρόσθεσε λεπτομέρειες αν θέλεις.',
    reason: 'Αιτία (προαιρετικό)',
    contact: 'Email ή στοιχεία επικοινωνίας (προαιρετικά)',
    submitRemoval: 'Απόκρυψη φωτογραφίας και αποστολή',
    cancel: 'Ακύρωση',
    removalSent: 'Η φωτογραφία αποκρύφτηκε και το αίτημά σου στάλθηκε.',
    removalFailed: 'Δεν ήταν δυνατή η αποστολή του αιτήματος. Δοκίμασε ξανά.',
    infoTitle: 'Πληροφορίες φωτογραφιών',
    infoIntro: 'Πληροφορίες για την προβολή, αγορά και αίτηση αφαίρεσης φωτογραφιών από το @vaglan_clicks.',
    privacyTitle: 'Απόρρητο και χρήση',
    privacyText: 'Οι προεπισκοπήσεις της γκαλερί είναι ορατές στους επισκέπτες. Τα αγορασμένα πρωτότυπα παραδίδονται με ιδιωτικούς συνδέσμους λήψης που λήγουν. Η πληρωμή γίνεται μέσω Viva Payments· ο ιστότοπος δεν αποθηκεύει στοιχεία κάρτας.',
    retentionTitle: 'Διαθεσιμότητα και διατήρηση',
    retentionText: 'Οι φωτογραφίες οργανώνονται ανά βραδιά στην Αθήνα και συνήθως αφαιρούνται μετά την αναγραφόμενη περίοδο διαθεσιμότητας. Η αγορά δεν παρατείνει την ορατότητα στη δημόσια γκαλερί.',
    removalInfoTitle: 'Αίτημα αφαίρεσης',
    removalInfoText: 'Άνοιξε μια φωτογραφία, επίλεξε «Αίτημα αφαίρεσης» και υπέβαλε τη φόρμα. Η φωτογραφία αποκρύπτεται αμέσως από τη δημόσια γκαλερί. Ο φωτογράφος εξετάζει τα αιτήματα· πρόσθεσε στοιχεία επικοινωνίας μόνο αν θέλεις απάντηση.',
    contactTitle: 'Επικοινωνία',
    contactText: 'Για ερωτήσεις σχετικά με το απόρρητο ή αγορές, επικοινώνησε με τον φωτογράφο μέσω Instagram στο @vaglan_clicks.',
    legalTitle: 'Νομικές πληροφορίες',
    legalText: 'Πριν από τη δημόσια λειτουργία, ο διαχειριστής πρέπει να δημοσιεύσει τη νόμιμη επωνυμία, επαγγελματική διεύθυνση, email επικοινωνίας, ενημέρωση απορρήτου, στοιχεία εκτελούντων την επεξεργασία και όρους καταναλωτή.',
    backToPhotos: 'Επιστροφή στις φωτογραφίες',
    requestRemoval: 'Αίτημα αφαίρεσης',
  },
}
