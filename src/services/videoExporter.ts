import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { AspectRatio, ExportProgress, ResolutionPreset } from '../types';

export interface VideoExportOptions {
  width: number;
  height: number;
  fps: number;
  totalSeconds: number;
  /** Render the frame for a timeline time and resolve once it is on screen. */
  renderFrame: (time: number) => Promise<void>;
  /** Canvases to composite (bottom to top). */
  getSources: () => (HTMLCanvasElement | null)[];
  onProgress: (p: ExportProgress) => void;
  signal?: AbortSignal;
  /** Interleaved stereo float samples to mux as an AAC/Opus track (optional). */
  audio?: { samples: Float32Array; sampleRate: number };
}

export function getExportDimensions(aspectRatio: AspectRatio, resolution: ResolutionPreset): { width: number; height: number } {
  const long = { '720p': 1280, '1080p': 1920, '1440p': 2560, '4k': 3840 }[resolution];
  const short = { '720p': 720, '1080p': 1080, '1440p': 1440, '4k': 2160 }[resolution];
  if (aspectRatio === '16:9') return { width: long, height: short };
  if (aspectRatio === '9:16') return { width: short, height: long };
  return { width: short, height: short };
}

export const hasWebCodecs = () => typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;

function pickAvcCodec(width: number, height: number): string {
  const mb = (width * height) / 256;
  // level by macroblocks per frame (approx): 4.0 = 8192 (1080p), 5.1 = 36864 (4K)
  if (mb > 22000) return 'avc1.640033'; // High 5.1
  if (mb > 8192) return 'avc1.640032'; // High 5.0
  return 'avc1.640028'; // High 4.0
}

function compose(sources: (HTMLCanvasElement | null)[], ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, width, height);
  for (const src of sources) {
    if (!src || src.width === 0 || src.height === 0) continue;
    // cover-fit (the preview container already has the target aspect; this only corrects rounding)
    const s = Math.max(width / src.width, height / src.height);
    const w = src.width * s;
    const h = src.height * s;
    ctx.drawImage(src, (width - w) / 2, (height - h) / 2, w, h);
  }
}

/**
 * Frame-accurate MP4 (H.264) export through WebCodecs. Every frame is rendered, waited for and encoded
 * with an explicit timestamp, so the output never depends on machine speed.
 */
export async function exportVideo(opts: VideoExportOptions): Promise<{ url: string; fileName: string }> {
  const { width, height, fps, totalSeconds, renderFrame, getSources, onProgress, signal, audio } = opts;
  const totalFrames = Math.max(1, Math.round(totalSeconds * fps));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create the export canvas.');

  const report = (frame: number, statusText: string, extra: Partial<ExportProgress> = {}) =>
    onProgress({ isExporting: true, progressPercent: Math.round((frame / totalFrames) * 100), currentFrame: frame, totalFrames, statusText, ...extra });

  if (!hasWebCodecs()) return exportWithMediaRecorder(opts, canvas, ctx, totalFrames, stamp);

  const codec = pickAvcCodec(width, height);
  const bitrate = Math.min(80_000_000, Math.round(width * height * fps * 0.1));
  const config: VideoEncoderConfig = { codec, width, height, framerate: fps, bitrate, latencyMode: 'quality', hardwareAcceleration: 'no-preference' };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) {
    // try a plain baseline/high 4.2 fallback before bailing out
    config.codec = 'avc1.64002a';
    const s2 = await VideoEncoder.isConfigSupported(config);
    if (!s2.supported) return exportWithMediaRecorder(opts, canvas, ctx, totalFrames, stamp);
  }

  // audio: AAC if the browser can encode it, else Opus, else silent
  let audioCodec: 'aac' | 'opus' | null = null;
  let audioConfig: AudioEncoderConfig | null = null;
  if (audio && 'AudioEncoder' in window) {
    for (const [codecName, codec] of [['aac', 'mp4a.40.2'], ['opus', 'opus']] as const) {
      const cfg: AudioEncoderConfig = { codec, sampleRate: audio.sampleRate, numberOfChannels: 2, bitrate: 128_000 };
      try {
        if ((await AudioEncoder.isConfigSupported(cfg)).supported) {
          audioCodec = codecName;
          audioConfig = cfg;
          break;
        }
      } catch {
        /* try next */
      }
    }
  }
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: audioCodec && audio ? { codec: audioCodec, sampleRate: audio.sampleRate, numberOfChannels: 2 } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encodeError = e as Error;
    },
  });
  encoder.configure(config);

  report(0, 'Preparing…');
  const frameUs = 1_000_000 / fps;
  const keyEvery = fps * 2;
  try {
    for (let f = 0; f < totalFrames; f++) {
      if (signal?.aborted) throw new Error('Export cancelled.');
      if (encodeError) throw encodeError;
      const t = f / fps;
      await renderFrame(t);
      compose(getSources(), ctx, width, height);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(f * frameUs), duration: Math.round(frameUs) });
      encoder.encode(frame, { keyFrame: f % keyEvery === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      if (f % 2 === 0) report(f, `Rendering frame ${f + 1} of ${totalFrames}`);
    }
    report(totalFrames, 'Finishing encode…');
    await encoder.flush();
    encoder.close();
    if (audio && audioConfig) {
      report(totalFrames, 'Encoding sound…');
      let audioError: Error | null = null;
      const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (audioError = e as Error) });
      aenc.configure(audioConfig);
      const frames = Math.ceil(audio.samples.length / 2);
      const chunkFrames = 4096;
      for (let f = 0; f < frames; f += chunkFrames) {
        const count = Math.min(chunkFrames, frames - f);
        const data = new AudioData({ format: 'f32', sampleRate: audio.sampleRate, numberOfFrames: count, numberOfChannels: 2, timestamp: Math.round((f / audio.sampleRate) * 1_000_000), data: audio.samples.slice(f * 2, (f + count) * 2) as Float32Array<ArrayBuffer> });
        aenc.encode(data);
        data.close();
        if (audioError) throw audioError;
        while (aenc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 2));
      }
      await aenc.flush();
      aenc.close();
    }
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const fileName = `visual-trip-${stamp}.mp4`;
    onProgress({ isExporting: false, progressPercent: 100, currentFrame: totalFrames, totalFrames, statusText: 'Done', downloadUrl: url, fileName });
    return { url, fileName };
  } catch (err) {
    try {
      encoder.close();
    } catch {
      /* ignore */
    }
    const message = err instanceof Error ? err.message : 'Unknown export error';
    onProgress({ isExporting: false, progressPercent: 0, currentFrame: 0, totalFrames, statusText: 'Export failed', error: message });
    throw err;
  }
}

/** Fallback for browsers without WebCodecs (Firefox/Safari): WebM via MediaRecorder with manual frame requests. */
async function exportWithMediaRecorder(
  opts: VideoExportOptions,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  totalFrames: number,
  stamp: string,
): Promise<{ url: string; fileName: string }> {
  const { fps, renderFrame, getSources, onProgress, signal, width, height } = opts;
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('This browser cannot encode video. Use Chrome or Edge for MP4 export.');
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.min(60_000_000, width * height * fps * 0.1) });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<Blob>((resolve) => (recorder.onstop = () => resolve(new Blob(chunks, { type: mime }))));
  recorder.start();
  const frameMs = 1000 / fps;
  const start = performance.now();
  try {
    for (let f = 0; f < totalFrames; f++) {
      if (signal?.aborted) throw new Error('Export cancelled.');
      await renderFrame(f / fps);
      compose(getSources(), ctx, width, height);
      track.requestFrame?.();
      // pace to real time so the recorder's clock matches the timeline
      const target = start + f * frameMs;
      const wait = target - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (f % 2 === 0) onProgress({ isExporting: true, progressPercent: Math.round((f / totalFrames) * 100), currentFrame: f, totalFrames, statusText: `Recording frame ${f + 1} of ${totalFrames} (WebM fallback)` });
    }
    recorder.stop();
    const blob = await stopped;
    const url = URL.createObjectURL(blob);
    const fileName = `visual-trip-${stamp}.webm`;
    onProgress({ isExporting: false, progressPercent: 100, currentFrame: totalFrames, totalFrames, statusText: 'Done', downloadUrl: url, fileName });
    return { url, fileName };
  } catch (err) {
    if (recorder.state !== 'inactive') recorder.stop();
    const message = err instanceof Error ? err.message : 'Unknown export error';
    onProgress({ isExporting: false, progressPercent: 0, currentFrame: 0, totalFrames, statusText: 'Export failed', error: message });
    throw err;
  }
}
