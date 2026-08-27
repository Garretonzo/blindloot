/** Avatar images are resized client-side to a tiny square data URL before upload. */
const SIZE = 128; // 2x retina headroom for the largest display size (Avatar lg = 56px)
export const MAX_AVATAR_CHARS = 65536;

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> (e.g. unsupported format path) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That does not look like an image.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Center cover-crop the image to a small square and return it as a compact data URL. */
export async function fileToAvatar(file: File): Promise<string> {
  const img = await loadImage(file);
  const w = img.width;
  const h = img.height;
  if (!w || !h) throw new Error('That does not look like an image.');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not process the image.');
  const s = Math.min(w, h);
  ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, SIZE, SIZE);
  let url = canvas.toDataURL('image/webp', 0.85);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.85); // older Safari
  if (url.length > MAX_AVATAR_CHARS) throw new Error('Image is too complex — try a simpler one.');
  return url;
}
