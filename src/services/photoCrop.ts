/**
 * Photo framing shared by the story card, the polaroid marker and the photo editor.
 * A crop is a focus point (0..1 of the image) and a zoom (1 = the frame is just covered).
 */

export interface PhotoCrop {
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_CROP: PhotoCrop = { x: 0.5, y: 0.5, zoom: 1 };
export const MAX_ZOOM = 4;

/** Width / height of the photo area on the story card and on the polaroid marker. */
export const CARD_PHOTO_ASPECT = 1.6;
export const POLAROID_PHOTO_ASPECT = 80 / 72;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Source rectangle of the image shown in a frame of the given aspect ratio. */
export function cropSourceRect(imgW: number, imgH: number, frameAspect: number, crop: PhotoCrop = DEFAULT_CROP) {
  const zoom = clamp(crop.zoom || 1, 1, MAX_ZOOM);
  let sw: number;
  let sh: number;
  if (imgW / imgH > frameAspect) {
    sh = imgH;
    sw = imgH * frameAspect;
  } else {
    sw = imgW;
    sh = imgW / frameAspect;
  }
  sw /= zoom;
  sh /= zoom;
  const sx = clamp(crop.x * imgW - sw / 2, 0, imgW - sw);
  const sy = clamp(crop.y * imgH - sh / 2, 0, imgH - sh);
  return { sx, sy, sw, sh };
}

/** Keep the focus point where the frame can actually be centred on it. */
export function normalizeCrop(imgW: number, imgH: number, frameAspect: number, crop: PhotoCrop): PhotoCrop {
  const { sx, sy, sw, sh } = cropSourceRect(imgW, imgH, frameAspect, crop);
  return { x: (sx + sw / 2) / imgW, y: (sy + sh / 2) / imgH, zoom: clamp(crop.zoom || 1, 1, MAX_ZOOM) };
}

export function drawCropped(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  crop?: PhotoCrop,
) {
  const { sx, sy, sw, sh } = cropSourceRect(img.width, img.height, dw / dh, crop ?? DEFAULT_CROP);
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

export const cropKey = (crop?: PhotoCrop) => (crop ? `${crop.x.toFixed(3)},${crop.y.toFixed(3)},${crop.zoom.toFixed(2)}` : 'c');
