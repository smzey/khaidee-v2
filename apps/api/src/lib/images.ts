import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { HttpError } from './errors.js';

export const UPLOAD_DIR =
  process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

/** Roughly a phone photo. Anything larger is a mistake, not a menu picture. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Dish photos are shown in a grid two across on a phone. 800px covers that at
 * 2x on the widest phone, and webp at quality 78 puts a typical dish photo
 * around 40–60KB — which matters, because the customer is loading this on
 * market mobile data while standing in front of the stall.
 */
const EDGE = 800;
const QUALITY = 78;

export interface StoredImage {
  /** Path to serve back, relative to the API origin. */
  url: string;
  bytes: number;
}

/**
 * Re-encodes whatever the vendor's phone produced into a square webp.
 *
 * Going through sharp is also the validation: a file that is not really an
 * image fails to decode, so nothing is trusted on the strength of its name or
 * its content-type header.
 */
export async function storeDishImage(input: Buffer): Promise<StoredImage> {
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    throw new HttpError(
      413,
      'image_too_large',
      'That picture is too big. Try taking it again.',
    );
  }

  let output: Buffer;
  try {
    output = await sharp(input)
      .rotate() // honour EXIF, or half the photos arrive sideways
      .resize(EDGE, EDGE, { fit: 'cover', position: 'centre' })
      .webp({ quality: QUALITY })
      .toBuffer();
  } catch {
    throw new HttpError(
      415,
      'not_an_image',
      'That file is not a picture we can read. Try a photo from your camera.',
    );
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${randomUUID()}.webp`;
  await writeFile(join(UPLOAD_DIR, name), output);

  return { url: `/uploads/${name}`, bytes: output.byteLength };
}
