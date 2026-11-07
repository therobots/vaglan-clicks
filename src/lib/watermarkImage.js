import watermarkPng from '@/assets/watermark.png'

let cachedWatermarkImage = null

/**
 * Preloads the watermark image as an HTMLImageElement for canvas compositing.
 */
export const getWatermarkImage = async () => {
  if (cachedWatermarkImage) return cachedWatermarkImage
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      cachedWatermarkImage = img
      resolve(img)
    }
    img.onerror = () => reject(new Error('Failed to load watermark image asset'))
    img.src = watermarkPng
  })
}

/**
 * Loads an image from a File, Blob, or URL into an HTMLImageElement.
 */
export const loadImage = (source) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    let url = ''
    if (typeof source === 'string') {
      url = source
    } else if (source instanceof Blob || source instanceof File) {
      url = URL.createObjectURL(source)
    } else {
      return reject(new Error('Invalid image source'))
    }

    img.onload = () => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
      reject(new Error('Failed to decode image from source'))
    }
    img.src = url
  })

/**
 * Converts a Canvas to a Blob with fallback to JPEG if WebP is unsupported.
 */
export const canvasToBlob = (canvas, type = 'image/webp', quality = 0.75) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else {
          canvas.toBlob(
            (fallbackBlob) => {
              if (fallbackBlob) resolve(fallbackBlob)
              else reject(new Error('Canvas to Blob conversion failed'))
            },
            'image/jpeg',
            quality,
          )
        }
      },
      type,
      quality,
    )
  })

/**
 * Converts a Blob to a base64 string (without the data: url prefix).
 */
export const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result
      if (typeof dataUrl === 'string') {
        const commaIndex = dataUrl.indexOf(',')
        resolve(commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl)
      } else {
        reject(new Error('FileReader returned non-string data'))
      }
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

/**
 * Takes an input image (File, Blob, or image URL), resizes it so its maximum
 * dimension does not exceed maxDimension, physically composites the watermark
 * onto the center, and generates both a 1280px max preview and a 300px max thumbnail.
 *
 * @param {File|Blob|string} source
 * @returns {Promise<{
 *   previewBlob: Blob,
 *   thumbnailBlob: Blob,
 *   previewBase64: string,
 *   thumbnailBase64: string,
 *   width: number,
 *   height: number
 * }>}
 */
export async function createWatermarkedPreviews(source) {
  const [img, watermark] = await Promise.all([loadImage(source), getWatermarkImage()])

  // 1. Calculate dimensions for preview (max 1280px)
  const maxPreviewDim = 1280
  let previewWidth = img.naturalWidth || img.width
  let previewHeight = img.naturalHeight || img.height

  if (Math.max(previewWidth, previewHeight) > maxPreviewDim) {
    if (previewWidth >= previewHeight) {
      previewWidth = maxPreviewDim
      previewHeight = Math.max(1, Math.round(((img.naturalHeight || img.height) * maxPreviewDim) / (img.naturalWidth || img.width)))
    } else {
      previewHeight = maxPreviewDim
      previewWidth = Math.max(1, Math.round(((img.naturalWidth || img.width) * maxPreviewDim) / (img.naturalHeight || img.height)))
    }
  }

  // Draw preview onto canvas
  const previewCanvas = document.createElement('canvas')
  previewCanvas.width = previewWidth
  previewCanvas.height = previewHeight
  const previewCtx = previewCanvas.getContext('2d', { alpha: false })
  previewCtx.imageSmoothingEnabled = true
  previewCtx.imageSmoothingQuality = 'high'
  previewCtx.drawImage(img, 0, 0, previewWidth, previewHeight)

  // Composite physical watermark onto center (up to 70% of preview width/height)
  if (watermark) {
    const maxWmWidth = previewWidth * 0.7
    const maxWmHeight = previewHeight * 0.7
    const wmOrigWidth = watermark.naturalWidth || watermark.width
    const wmOrigHeight = watermark.naturalHeight || watermark.height
    const scale = Math.min(maxWmWidth / wmOrigWidth, maxWmHeight / wmOrigHeight, 1)
    const wmWidth = Math.max(1, Math.round(wmOrigWidth * scale))
    const wmHeight = Math.max(1, Math.round(wmOrigHeight * scale))
    const posX = Math.round((previewWidth - wmWidth) / 2)
    const posY = Math.round((previewHeight - wmHeight) / 2)

    previewCtx.save()
    previewCtx.globalAlpha = 0.55
    previewCtx.drawImage(watermark, posX, posY, wmWidth, wmHeight)
    previewCtx.restore()
  }

  // 2. Generate 300px thumbnail from the already-watermarked preview canvas
  const maxThumbDim = 300
  let thumbWidth = previewWidth
  let thumbHeight = previewHeight

  if (Math.max(thumbWidth, thumbHeight) > maxThumbDim) {
    if (thumbWidth >= thumbHeight) {
      thumbWidth = maxThumbDim
      thumbHeight = Math.max(1, Math.round((previewHeight * maxThumbDim) / previewWidth))
    } else {
      thumbHeight = maxThumbDim
      thumbWidth = Math.max(1, Math.round((previewWidth * maxThumbDim) / previewHeight))
    }
  }

  const thumbCanvas = document.createElement('canvas')
  thumbCanvas.width = thumbWidth
  thumbCanvas.height = thumbHeight
  const thumbCtx = thumbCanvas.getContext('2d', { alpha: false })
  thumbCtx.imageSmoothingEnabled = true
  thumbCtx.imageSmoothingQuality = 'high'
  thumbCtx.drawImage(previewCanvas, 0, 0, thumbWidth, thumbHeight)

  // Export blobs and base64 strings
  const [previewBlob, thumbnailBlob] = await Promise.all([
    canvasToBlob(previewCanvas, 'image/webp', 0.75),
    canvasToBlob(thumbCanvas, 'image/webp', 0.75),
  ])

  const [previewBase64, thumbnailBase64] = await Promise.all([
    blobToBase64(previewBlob),
    blobToBase64(thumbnailBlob),
  ])

  return {
    previewBlob,
    thumbnailBlob,
    previewBase64,
    thumbnailBase64,
    width: previewWidth,
    height: previewHeight,
  }
}
