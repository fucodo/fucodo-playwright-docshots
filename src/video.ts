import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface VideoOptions {
  /** Output template, like the screenshot output: {id} {viewport} {scheme} {lang} {project} */
  output: string;
  /** 'mp4' (H.264, plays everywhere) or 'webm' (VP9) */
  format: 'mp4' | 'webm';
  fps: number;
  /** JPEG quality of the captured frames (1–100) */
  quality: number;
  /** Show an animated mouse pointer and click marks (Playwright showActions) */
  cursor: boolean;
  /** Pause after each action while recording, so viewers can follow (ms) */
  stepDelay: number;
  /** Pause after markers were added or removed (ms) */
  markDelay: number;
  /** Still frames at the start and the end (ms) */
  hold: number;
  /** Padding around an element video (px) */
  padding: number;
  /** ffmpeg binary – default: $DOCSHOTS_FFMPEG, then ffmpeg-static (if installed), then "ffmpeg" on PATH */
  ffmpeg?: string;
}

export const DEFAULT_VIDEO: VideoOptions = {
  output: 'Documentation/Videos/{id}/{viewport}-{scheme}-{lang}.mp4',
  format: 'mp4',
  fps: 25,
  quality: 90,
  cursor: true,
  stepDelay: 700,
  markDelay: 1200,
  hold: 800,
  padding: 48, // room for badges left of fields – the crop cannot grow during a video
};

export interface Frame {
  data: Buffer;
  /** ms */
  timestamp: number;
  viewportWidth: number;
  viewportHeight: number;
}

/** Crop in CSS pixels of the viewport. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

let cachedFfmpeg: string | null | undefined;

export function findFfmpeg(configured?: string): string | undefined {
  if (configured) return configured;
  if (cachedFfmpeg !== undefined) return cachedFfmpeg ?? undefined;
  const candidates: string[] = [];
  if (process.env.DOCSHOTS_FFMPEG) candidates.push(process.env.DOCSHOTS_FFMPEG);
  try {
    // optional: npm i -D ffmpeg-static
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require(require.resolve('ffmpeg-static', { paths: [process.cwd()] }));
    if (typeof p === 'string') candidates.push(p);
  } catch {
    /* not installed */
  }
  candidates.push('ffmpeg');
  for (const c of candidates) {
    const r = spawnSync(c, ['-version'], { stdio: 'ignore' });
    if (r.status === 0) return (cachedFfmpeg = c);
  }
  cachedFfmpeg = null;
  return undefined;
}

export const FFMPEG_HINT =
  'Für Videos wird ffmpeg benötigt: installieren (z. B. apt install ffmpeg), "npm i -D ffmpeg-static" oder DOCSHOTS_FFMPEG=/pfad/zu/ffmpeg setzen.';

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * Encodes variable-rate screencast frames into a constant-rate video.
 * Each frame is shown until the next one arrives (screencast only sends frames on change);
 * the last frame is held until `endTimestamp`.
 */
export function encodeVideo(args: {
  frames: Frame[];
  endTimestamp: number;
  file: string;
  options: VideoOptions;
  region?: Region;
}): { file: string; width: number; height: number; duration: number } {
  const { options } = args;
  if (!args.frames.length) throw new Error('Keine Video-Frames aufgenommen – war die Seite während der Aufnahme sichtbar?');
  // Screenshots taken during the recording (full page / element shots) briefly resize the viewport.
  // Those frames show a different layout and size – drop them, the previous frame is held instead.
  const sizeOf = (f: Frame) => {
    const px = probeJpegSize(f.data);
    return `${f.viewportWidth}x${f.viewportHeight}/${px?.width}x${px?.height}`;
  };
  const ref = sizeOf(args.frames[0]);
  const frames = args.frames.filter((f) => sizeOf(f) === ref);
  const ffmpeg = findFfmpeg(options.ffmpeg);
  if (!ffmpeg) throw new Error(FFMPEG_HINT);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'docshots-video-'));
  try {
    // concat demuxer list: every frame with its real display duration
    const lines: string[] = ['ffconcat version 1.0'];
    const hold = options.hold / 1000;
    frames.forEach((f, i) => {
      const name = `f${String(i).padStart(6, '0')}.jpg`;
      fs.writeFileSync(path.join(work, name), f.data);
      const next = i + 1 < frames.length ? frames[i + 1].timestamp : args.endTimestamp;
      let duration = Math.max(0.001, (next - f.timestamp) / 1000);
      if (i === 0) duration += hold;
      if (i === frames.length - 1) duration += hold;
      lines.push(`file '${name}'`, `duration ${duration.toFixed(4)}`);
    });
    // the concat demuxer ignores the duration of the last entry unless the file is repeated
    lines.push(`file 'f${String(frames.length - 1).padStart(6, '0')}.jpg'`);
    fs.writeFileSync(path.join(work, 'frames.txt'), lines.join('\n'));

    const first = frames[0];
    const frameW = probeJpegSize(first.data)?.width ?? first.viewportWidth;
    const scale = frameW / first.viewportWidth; // frames may be larger than CSS pixels
    const filters: string[] = [];
    let outW = frameW;
    let outH = probeJpegSize(first.data)?.height ?? first.viewportHeight;
    if (args.region) {
      const r = args.region;
      const x = Math.max(0, Math.round(r.x * scale));
      const y = Math.max(0, Math.round(r.y * scale));
      outW = even(Math.min(outW - x, r.width * scale));
      outH = even(Math.min(outH - y, r.height * scale));
      filters.push(`crop=${outW}:${outH}:${x}:${y}`);
    } else {
      outW = even(outW);
      outH = even(outH);
      filters.push(`crop=${outW}:${outH}:0:0`);
    }
    filters.push(`fps=${options.fps}`, 'format=yuv420p');

    const codec =
      options.format === 'webm'
        ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1']
        : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart'];
    fs.mkdirSync(path.dirname(args.file), { recursive: true });
    const r = spawnSync(
      ffmpeg,
      ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'frames.txt'), '-vf', filters.join(','), ...codec, '-an', args.file],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`ffmpeg ist fehlgeschlagen: ${(r.stderr || r.error?.message || '').trim().slice(0, 800)}`);
    const duration = (args.endTimestamp - first.timestamp) / 1000 + hold * 2;
    return { file: args.file, width: outW, height: outH, duration };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Reads width/height from a baseline or progressive JPEG header. */
export function probeJpegSize(buf: Buffer): { width: number; height: number } | undefined {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return undefined;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return undefined;
}

/** Replaces the extension of the output template with the configured format. */
export function withFormat(file: string, format: VideoOptions['format']): string {
  return file.replace(/\.(mp4|webm|mov|mkv)$/i, '') + `.${format}`;
}
