import { GwrError } from './errors.js';

const SUPPORTED = ['image/png', 'image/jpeg'];

let cached = null;

/**
 * Resolve the image codec, memoized. Prefers native sharp; falls back to a
 * pure-JS codec (fast-png + jpeg-js) when sharp cannot be imported at all.
 * @returns {Promise<{name: string, decode: Function, encode: Function, supports: Function}>}
 */
export async function resolveCodec() {
  if (cached) return cached;
  try {
    const sharp = (await import('sharp')).default;
    cached = makeSharpCodec(sharp);
  } catch {
    cached = makePureCodec();
  }
  return cached;
}

/** Reset the memoized codec (test seam). */
export function resetCodecCache() {
  cached = null;
}

/**
 * Describe the active codec.
 * @returns {Promise<{name: string, formats: string[]}>}
 */
export async function describeCodec() {
  const codec = await resolveCodec();
  const formats = codec.supports('image/webp')
    ? ['image/png', 'image/jpeg', 'image/webp']
    : ['image/png', 'image/jpeg'];
  return { name: codec.name, formats };
}

/**
 * Normalize fast-png / sharp raw output to exactly width*height*4 RGBA.
 * Never mutates the source buffer.
 */
function toRgba(width, height, data, channels, palette) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r;
    let g;
    let b;
    let a = 255;
    if (palette) {
      const idx = data[i] * 3;
      const entry = palette[idx] || [0, 0, 0];
      r = entry[0];
      g = entry[1];
      b = entry[2];
      // palette alpha lives in a parallel tRNS array via index 4 when present
      if (palette.alpha && palette.alpha[data[i]] !== undefined) {
        a = palette.alpha[data[i]];
      }
    } else if (channels === 1) {
      r = g = b = data[i];
    } else if (channels === 2) {
      r = g = b = data[i * 2];
      a = data[i * 2 + 1];
    } else if (channels === 3) {
      r = data[i * 3];
      g = data[i * 3 + 1];
      b = data[i * 3 + 2];
    } else {
      r = data[i * 4];
      g = data[i * 4 + 1];
      b = data[i * 4 + 2];
      a = data[i * 4 + 3];
    }
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return out;
}

/** True when every alpha byte is fully opaque. */
function isFullyOpaque(data) {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return false;
  }
  return true;
}

function makeSharpCodec(sharp) {
  return {
    name: 'sharp',
    supports() {
      return true;
    },
    async decode(buffer, { mimeType } = {}) {
      const { info, data } = await sharp(buffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      // sharp already handed us RGBA (ensureAlpha), copy into Uint8ClampedArray
      return {
        width: info.width,
        height: info.height,
        data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
      };
    },
    async encode(imageData, { mimeType } = {}) {
      const { width, height, data } = imageData;
      let pipe = sharp(Buffer.from(data.buffer, data.byteOffset, data.length), {
        raw: { width, height, channels: 4 },
      });
      // JPEG has no alpha channel; dropping it avoids a black-alpha composite
      if (mimeType === 'image/jpeg') {
        return pipe.flatten({ background: '#ffffff' }).jpeg({ quality: 95 }).toBuffer();
      }
      if (mimeType === 'image/webp') {
        return pipe.webp({ quality: 95 }).toBuffer();
      }
      // PNG: store 3-channel RGB when there is no transparency (smaller files)
      if (isFullyOpaque(data)) {
        pipe = sharp(
          Buffer.from(data.buffer, data.byteOffset, data.length),
          { raw: { width, height, channels: 4 } }
        ).removeAlpha();
      }
      return pipe.png().toBuffer();
    },
  };
}

function makePureCodec() {
  return {
    name: 'pure',
    supports(mimeType) {
      return SUPPORTED.includes(mimeType);
    },
    async decode(buffer, { mimeType } = {}) {
      if (mimeType === 'image/webp') {
        throw new GwrError('WebP decoding requires the native sharp codec', {
          code: 'E_CODEC',
          hint: 'WebP needs the native sharp codec. Install it with: npm i -g sharp',
        });
      }
      if (mimeType === 'image/jpeg') {
        const jpeg = await import('jpeg-js');
        const img = jpeg.decode(buffer, { useTArray: true });
        return {
          width: img.width,
          height: img.height,
          data: new Uint8ClampedArray(img.data),
        };
      }
      const { decode } = await import('fast-png');
      const img = decode(new Uint8Array(buffer));
      if (img.palette) {
        return {
          width: img.width,
          height: img.height,
          data: toRgba(img.width, img.height, img.data, 1, img.palette),
        };
      }
      return {
        width: img.width,
        height: img.height,
        data: toRgba(img.width, img.height, img.data, img.channels),
      };
    },
    async encode(imageData, { mimeType } = {}) {
      const { width, height, data } = imageData;
      if (mimeType === 'image/webp') {
        throw new GwrError('WebP encoding requires the native sharp codec', {
          code: 'E_CODEC',
          hint: 'WebP needs the native sharp codec. Install it with: npm i -g sharp',
        });
      }
      if (mimeType === 'image/jpeg') {
        const jpeg = await import('jpeg-js');
        // JPEG has no alpha: feed a fresh 3-channel buffer, never mutate input
        const rgb = new Uint8Array(width * height * 3);
        for (let i = 0; i < width * height; i++) {
          rgb[i * 3] = data[i * 4];
          rgb[i * 3 + 1] = data[i * 4 + 1];
          rgb[i * 3 + 2] = data[i * 4 + 2];
        }
        const out = jpeg.encode({ width, height, data: rgb }, 95);
        return Buffer.from(out.data);
      }
      const { encode } = await import('fast-png');
      const channels = isFullyOpaque(data) ? 3 : 4;
      const pixels = new Uint8Array(width * height * channels);
      for (let i = 0; i < width * height; i++) {
        pixels[i * channels] = data[i * 4];
        pixels[i * channels + 1] = data[i * 4 + 1];
        pixels[i * channels + 2] = data[i * 4 + 2];
        if (channels === 4) pixels[i * channels + 3] = data[i * 4 + 3];
      }
      return Buffer.from(encode({ width, height, data: pixels, channels }));
    },
  };
}
