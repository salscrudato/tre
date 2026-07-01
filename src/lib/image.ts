// Client-side downscale for the AI vision uploads (receipts and statements). Phone
// photos run 3 to 8 MB; the models read them fine with the longest side at 1600px, so we
// resize on-device before upload to cut the callable payload and the wait. Anything the
// browser cannot decode (for example a HEIC file) falls back to the raw file bytes so
// nothing regresses.

// Callers gate their file inputs to these types before calling, so the raw fallback can
// keep the original type honestly.
export type EncodedImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface EncodedImage {
  // Base64 payload without the data: prefix, ready for a callable.
  base64: string
  mediaType: EncodedImageMediaType
}

function fileToRawBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
}

function decodeViaElement(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      // The decoded pixels are retained by the element once load fires, so the object
      // URL can be released before we draw.
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not decode the image.'))
    }
    img.src = url
  })
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Honor the EXIF orientation so a portrait phone photo stays upright.
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      try {
        return await createImageBitmap(file)
      } catch {
        // Fall through to the element decoder.
      }
    }
  }
  return decodeViaElement(file)
}

// Decode an image file, scale it so the longest side is at most maxDim (never upscale),
// and re-encode as JPEG at quality 0.8. When the browser cannot decode or re-encode the
// file, the raw bytes are returned unchanged with their original type.
export async function imageFileToBase64(file: File, maxDim = 1600): Promise<EncodedImage> {
  const rawType: EncodedImageMediaType =
    file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg'
  try {
    const source = await decodeImage(file)
    const width = 'naturalWidth' in source ? source.naturalWidth : source.width
    const height = 'naturalHeight' in source ? source.naturalHeight : source.height
    if (width <= 0 || height <= 0) throw new Error('Empty image.')
    const scale = Math.min(1, maxDim / Math.max(width, height))
    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable.')
    // JPEG has no alpha channel: flatten any transparency onto white, not black, so a
    // transparent PNG statement screenshot stays readable.
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, targetWidth, targetHeight)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight)
    if ('close' in source) source.close()
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    const comma = dataUrl.indexOf(',')
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''
    if (base64.length === 0) throw new Error('Empty encode.')
    return { base64, mediaType: 'image/jpeg' }
  } catch {
    return { base64: await fileToRawBase64(file), mediaType: rawType }
  }
}
