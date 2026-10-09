/**
 * Uploaded photos live in IndexedDB (browser storage meant for files) and are referenced from the
 * project as `local:<id>`, so projects stay small enough for autosave.
 */

const DB_NAME = 'visual-trip-maker';
const STORE = 'photos';
export const LOCAL_PREFIX = 'local:';

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const isLocalPhoto = (url?: string) => !!url && url.startsWith(LOCAL_PREFIX);

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function putPhoto(blob: Blob, id = newId()): Promise<string> {
  await tx('readwrite', (s) => s.put(blob, id));
  return LOCAL_PREFIX + id;
}

const objectUrls = new Map<string, Promise<string | null>>();

/** A URL an <img> can load: object URL for local photos, the URL itself otherwise. */
export function resolvePhotoSrc(url: string): Promise<string | null> {
  if (!isLocalPhoto(url)) return Promise.resolve(url);
  if (!objectUrls.has(url)) {
    objectUrls.set(
      url,
      tx<Blob | undefined>('readonly', (s) => s.get(url.slice(LOCAL_PREFIX.length)))
        .then((blob) => (blob ? URL.createObjectURL(blob) : null))
        .catch(() => null),
    );
  }
  return objectUrls.get(url)!;
}

/** Longest side of stored uploads (px). Plenty for a 4K export card, small enough for storage. */
const MAX_SIDE = 2048;

/** Decode, auto-rotate (EXIF), downscale and re-encode an uploaded image, then store it. */
export async function storeUpload(file: Blob): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This image format is not supported by your browser. Try a JPEG, PNG or WebP.');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  if (!blob) throw new Error('Could not process the image.');
  return putPhoto(blob);
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Data URLs of the given local photos, for saving inside a project file. */
export async function exportPhotos(urls: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const url of new Set(urls.filter(isLocalPhoto))) {
    const id = url.slice(LOCAL_PREFIX.length);
    const blob = await tx<Blob | undefined>('readonly', (s) => s.get(id)).catch(() => undefined);
    if (blob) out[id] = await blobToDataUrl(blob);
  }
  return out;
}

/** Restore photos saved inside a project file (keeps their ids). */
export async function importPhotos(photos: Record<string, string>): Promise<void> {
  for (const [id, dataUrl] of Object.entries(photos)) {
    const blob = await (await fetch(dataUrl)).blob();
    await putPhoto(blob, id);
  }
}

/** Move an embedded data: URL into storage and return its local reference. */
export async function localizeDataUrl(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return storeUpload(blob);
}
