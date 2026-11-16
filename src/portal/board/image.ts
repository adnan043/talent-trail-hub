/**
 * BROWSER: an uploaded image made small enough for where it is shown, before it goes to storage:
 * at most `maxSide` px on its long side, as WebP. Logos are shown at tens of pixels on every page,
 * so a 1 MB original would cost each visitor hundreds of KB. Already small enough, unreadable, or a
 * browser that can't write WebP: the original file is kept (the server checks it the same way).
 */
export async function imageForStorage(file: File, maxSide: number): Promise<File> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 100 * 1024) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
  if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.webp', {type: 'image/webp'});
}
