/**
 * Photographs of cards the catalog has not published yet.
 *
 * A card bought on release day has no artwork anywhere, so the only picture of it is the
 * one taken in the shop. That picture is committed to the repository, which is why it is
 * shrunk hard first: the plan's one standing rule about repository size is that card
 * images are never committed, and this is the single exception it allows.
 */

/** Long edge. Enough to recognise a card, nowhere near enough to be worth storing at full size. */
const MAX_EDGE = 1000;

/** The ceiling the exception was granted under. */
const MAX_BYTES = 200 * 1024;

const QUALITIES = [0.82, 0.7, 0.6, 0.5, 0.4];

async function toBitmap(file: File): Promise<ImageBitmap> {
  // createImageBitmap honours EXIF orientation, which a phone photo almost always has.
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

function scaled(bitmap: ImageBitmap): { canvas: HTMLCanvasElement; width: number; height: number } {
  const ratio = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * ratio);
  const height = Math.round(bitmap.height * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  return { canvas, width, height };
}

const encode = (canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

export interface PreparedPhoto {
  /** Base64 of the JPEG, ready to commit without further encoding. */
  base64: string;
  bytes: number;
  width: number;
  height: number;
  /** For showing the picture before it has been published. */
  dataUrl: string;
}

/**
 * Shrinks a photo until it fits, and says so if it cannot.
 *
 * Failing loudly matters: a photo that quietly went in at three megabytes would sit in
 * git history for good, and history cannot be made smaller afterwards.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await toBitmap(file);
  const { canvas, width, height } = scaled(bitmap);
  bitmap.close();

  for (const quality of QUALITIES) {
    const blob = await encode(canvas, quality);
    if (!blob) continue;
    if (blob.size > MAX_BYTES) continue;

    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of buffer) binary += String.fromCharCode(byte);
    const base64 = btoa(binary);

    return { base64, bytes: blob.size, width, height, dataUrl: `data:image/jpeg;base64,${base64}` };
  }

  throw new Error('That photo will not shrink below 200 KB. Try a smaller crop.');
}
