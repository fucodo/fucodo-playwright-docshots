import type { Browser, BrowserContext, Page } from '@playwright/test';

export type ImageFormat = 'webp' | 'png' | 'jpeg';

export interface ImageOptions {
  /** 'webp' (default), 'png' or 'jpeg' */
  format: ImageFormat;
  /** 1–100 for webp and jpeg. 100 = lossless WebP, but larger than PNG */
  quality: number;
}

export const DEFAULT_IMAGE: ImageOptions = { format: 'webp', quality: 90 };

/** WebP cannot store larger images. */
const WEBP_MAX_SIDE = 16383;

export const IMAGE_CONTENT_TYPE: Record<ImageFormat, string> = { webp: 'image/webp', png: 'image/png', jpeg: 'image/jpeg' };

/** Replaces the extension of the output template with the configured format. */
export function withImageFormat(file: string, format: ImageFormat): string {
  return file.replace(/\.(png|jpe?g|webp)$/i, '') + `.${format === 'jpeg' ? 'jpg' : format}`;
}

/** Width/height from a PNG header. */
export function probePngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// one encoder page per browser, in its own context: no app routes, scripts or CSP involved
const encoders = new WeakMap<Browser | BrowserContext, Promise<Page>>();

async function encoderPage(context: BrowserContext): Promise<Page> {
  const browser = context.browser();
  const key = browser ?? context; // persistent contexts have no browser to open a new context in
  const cached = await encoders.get(key)?.catch(() => undefined);
  // Playwright closes contexts created during a test when the test ends
  if (cached && !cached.isClosed()) return cached;
  const page = browser ? browser.newContext().then((c) => c.newPage()) : context.newPage();
  encoders.set(key, page);
  return page;
}

/** Encodes a PNG screenshot as WebP with the browser's own encoder (no native dependency). */
export async function pngToWebp(context: BrowserContext, png: Buffer, quality = DEFAULT_IMAGE.quality): Promise<Buffer> {
  const { width, height } = probePngSize(png);
  if (width > WEBP_MAX_SIDE || height > WEBP_MAX_SIDE) {
    throw new Error(`Screenshot ist zu groß für WebP (${width}×${height}, max. ${WEBP_MAX_SIDE} px pro Seite) – imageFormat: 'png' verwenden.`);
  }
  const page = await encoderPage(context);
  const b64 = await page.evaluate(
    async ({ src, q }) => {
      const bytes = Uint8Array.from(atob(src), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: q });
      if (blob.type !== 'image/webp') return null; // browser cannot encode WebP (WebKit)
      const out = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { src: png.toString('base64'), q: quality / 100 },
  );
  if (b64 === null) {
    throw new Error(`Dieser Browser kann kein WebP erzeugen – browserName: 'chromium' oder imageFormat: 'png' verwenden.`);
  }
  return Buffer.from(b64, 'base64');
}
