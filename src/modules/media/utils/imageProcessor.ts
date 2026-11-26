import sharp from 'sharp';
import CustomError from '../../../helpers/CustomError';
import { MediaKind } from '../media.interface';
import { VARIANT_WIDTHS } from './mediaKey';

/**
 * Image processing for key-based providers (R2). Cloudinary uploads are NOT processed here —
 * Cloudinary keeps applying its own transformation exactly as before.
 */

// Keep memory usage predictable on the VPS
sharp.cache({ memory: 64, files: 0, items: 100 });

export const ALLOWED_INPUT_FORMATS = ['jpeg', 'png', 'webp'] as const;
export const MAX_INPUT_PIXELS = 40_000_000; // ~ 6300 x 6300
export const MAX_INPUT_SIDE = 8000;
export const MIN_INPUT_SIDE = 16;
/** Already-optimized WebP uploads within the size box and under this size are stored as-is. */
export const PASSTHROUGH_WEBP_MAX_BYTES = 300 * 1024;

interface KindProfile {
  maxWidth: number;
  maxHeight: number;
  quality: number;
  alphaQuality: number;
}

export const KIND_PROFILES: Record<MediaKind, KindProfile> = {
  product: { maxWidth: 1200, maxHeight: 1200, quality: 80, alphaQuality: 90 },
  category: { maxWidth: 800, maxHeight: 800, quality: 80, alphaQuality: 90 },
  banner: { maxWidth: 1920, maxHeight: 1080, quality: 82, alphaQuality: 90 },
  logo: { maxWidth: 512, maxHeight: 512, quality: 90, alphaQuality: 100 },
  avatar: { maxWidth: 400, maxHeight: 400, quality: 80, alphaQuality: 90 },
  blog: { maxWidth: 1600, maxHeight: 1600, quality: 80, alphaQuality: 90 },
};

export interface ProcessedOutput {
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
}

export interface ProcessedImage {
  main: ProcessedOutput;
  variants: Array<ProcessedOutput & { variantWidth: number }>;
  mimeType: 'image/webp';
  sourceFormat: string;
  sourceBytes: number;
  hasAlpha: boolean;
}

const sharpInput = (input: Buffer) =>
  sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false });

export const inspectImage = async (input: Buffer) => {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    throw new CustomError(400, 'Uploaded image is empty.');
  }

  let meta: sharp.Metadata;
  try {
    meta = await sharpInput(input).metadata();
  } catch {
    throw new CustomError(400, 'Invalid or corrupted image file.');
  }

  const format = meta.format || '';
  if (!(ALLOWED_INPUT_FORMATS as readonly string[]).includes(format)) {
    throw new CustomError(400, 'Unsupported file type! Only JPEG, PNG, JPG and WEBP are allowed.');
  }

  const width = meta.width || 0;
  const height = meta.height || 0;
  if (width < MIN_INPUT_SIDE || height < MIN_INPUT_SIDE) {
    throw new CustomError(400, `Image is too small. Minimum size is ${MIN_INPUT_SIDE}x${MIN_INPUT_SIDE} pixels.`);
  }
  if (width > MAX_INPUT_SIDE || height > MAX_INPUT_SIDE || width * height > MAX_INPUT_PIXELS) {
    throw new CustomError(400, `Image dimensions are too large. Maximum is ${MAX_INPUT_SIDE}x${MAX_INPUT_SIDE} pixels.`);
  }

  return { format, width, height, hasAlpha: Boolean(meta.hasAlpha), orientation: meta.orientation };
};

const toWebp = async (
  input: Buffer,
  boxWidth: number,
  boxHeight: number,
  profile: KindProfile,
): Promise<ProcessedOutput> => {
  const { data, info } = await sharpInput(input)
    .rotate() // honour EXIF orientation, then metadata is stripped by default
    .resize({ width: boxWidth, height: boxHeight, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: profile.quality, alphaQuality: profile.alphaQuality, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, bytes: info.size };
};

export const processImage = async (input: Buffer, kind: MediaKind): Promise<ProcessedImage> => {
  const profile = KIND_PROFILES[kind];
  if (!profile) throw new CustomError(400, 'Invalid media kind');

  const info = await inspectImage(input);

  let main: ProcessedOutput;
  const canPassThrough =
    info.format === 'webp' &&
    info.width <= profile.maxWidth &&
    info.height <= profile.maxHeight &&
    input.length <= PASSTHROUGH_WEBP_MAX_BYTES &&
    (!info.orientation || info.orientation === 1);

  try {
    main = canPassThrough
      ? { buffer: input, width: info.width, height: info.height, bytes: input.length }
      : await toWebp(input, profile.maxWidth, profile.maxHeight, profile);

    const variants = [] as ProcessedImage['variants'];
    for (const w of VARIANT_WIDTHS) {
      const out = await toWebp(input, w, w, profile);
      variants.push({ ...out, variantWidth: w });
    }

    return {
      main,
      variants,
      mimeType: 'image/webp',
      sourceFormat: info.format,
      sourceBytes: input.length,
      hasAlpha: info.hasAlpha,
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(400, 'Failed to process image. Please upload a valid JPEG, PNG or WEBP file.');
  }
};
