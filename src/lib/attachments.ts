/**
 * ANYA LABS — photo and voice-note attachments.
 *
 * Every file is encrypted in the browser before upload (see encryptBytes in
 * crypto.ts) and decrypted back in the browser on view. The Storage bucket
 * only ever holds ciphertext, and the readable file exists solely as an
 * in-memory blob URL that dies with the tab — it is never written to the
 * phone's gallery or downloads folder.
 *
 * What this does NOT prevent: a screenshot. Nothing a web page can do stops
 * that, and it would be dishonest to imply otherwise.
 *
 * Bandwidth is treated as scarce throughout, because one side of this chat
 * is often on a borrowed phone with a few minutes of patchy data: photos
 * are downscaled and re-encoded before they ever leave the device, and
 * nothing is fetched until it's actually asked for (see MessageBubble).
 */

import { supabase } from '@/lib/supabaseClient';
import { encryptBytes, decryptBytes } from '@/lib/crypto';
import { createId } from '@/utils/id';

export const ATTACHMENT_BUCKET = 'attachments';

/** Mirrors the database ceiling in migration 0006; that one is authoritative. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// Large enough to still look good full-screen on a phone, small enough that
// sending doesn't eat someone's data allowance. A 12MP camera photo lands
// around 200-400kB after this.
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_QUALITY = 0.82;

export interface AttachmentDraft {
  blob: Blob;
  kind: 'image' | 'audio';
  mime: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface UploadedAttachment {
  path: string;
  kind: 'image' | 'audio';
  mime: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * Decodes a picked file into something canvas can draw.
 *
 * createImageBitmap is the efficient path but doesn't exist on Safari < 15
 * or older Android WebViews — again, the phones most likely to be borrowed —
 * so there's an <img> fallback. Both drop EXIF on the canvas re-encode and
 * both honour EXIF orientation, so a photo taken sideways stays upright
 * either way.
 */
async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      // Bitmaps hold decoded pixel data — on a 12MP photo that's ~48MB of
      // memory, which a low-end phone will not forgive us for leaking.
      release: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('That file could not be read as an image'));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * Downscales and re-encodes a picked image.
 *
 * This also quietly strips EXIF — including GPS coordinates, which phone
 * cameras embed by default — because the canvas re-encode only carries
 * pixels across, not the original file's metadata. Worth knowing that's a
 * deliberate side effect and not an accident to be "fixed" later.
 */
export async function prepareImage(file: File): Promise<AttachmentDraft> {
  const decoded = await decodeImage(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(decoded.source, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', IMAGE_QUALITY),
    );
    if (!blob) throw new Error('Could not process this image');

    return { blob, kind: 'image', mime: 'image/jpeg', width, height };
  } finally {
    decoded.release();
  }
}

/** Encrypts and uploads a prepared draft, returning what the message row needs. */
export async function uploadAttachment(
  draft: AttachmentDraft,
  key: CryptoKey,
  roomId: string,
): Promise<UploadedAttachment> {
  if (!supabase) throw new Error('Not connected');
  if (draft.blob.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('That file is too large to send');
  }

  const encrypted = await encryptBytes(key, await draft.blob.arrayBuffer());

  // Inside the room's own folder — the storage policies only let a member
  // read and write under their room's id (see migration 0007). The name is
  // random, with no extension and nothing derived from the original file:
  // a listing shouldn't hint at what anything contains, and the real type
  // lives on the message row. createId() rather than crypto.randomUUID()
  // directly — the latter is missing on Safari < 15.4 and older Android
  // WebViews, which are exactly the phones most likely to be borrowed.
  const path = `${roomId}/${createId()}`;

  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, encrypted, {
    contentType: 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;

  return {
    path,
    kind: draft.kind,
    mime: draft.mime,
    size: encrypted.size,
    width: draft.width,
    height: draft.height,
    durationMs: draft.durationMs,
  };
}

// Decrypted blob URLs, keyed by storage path. Viewing the same photo twice
// in one session shouldn't re-download and re-decrypt it — which on a slow
// connection is the difference between instant and several seconds.
const objectUrlCache = new Map<string, string>();

/**
 * Fetches, decrypts, and returns a blob URL for an attachment.
 *
 * The URL points at memory, not disk, and is revoked by releaseAttachments()
 * when the session ends.
 */
export async function loadAttachment(path: string, key: CryptoKey, mime: string): Promise<string> {
  const cached = objectUrlCache.get(path);
  if (cached) return cached;

  if (!supabase) throw new Error('Not connected');
  const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).download(path);
  if (error) throw error;

  const decrypted = await decryptBytes(key, await data.arrayBuffer());
  const url = URL.createObjectURL(new Blob([decrypted], { type: mime }));

  // Re-check: a concurrent call for the same path may have finished first,
  // and two live URLs for one file would leak the loser.
  const raced = objectUrlCache.get(path);
  if (raced) {
    URL.revokeObjectURL(url);
    return raced;
  }

  objectUrlCache.set(path, url);
  return url;
}

/** Deletes an attachment's stored file. Best-effort — see deleteMessage. */
export async function removeAttachment(path: string): Promise<void> {
  if (!supabase) return;
  await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
  const url = objectUrlCache.get(path);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrlCache.delete(path);
  }
}

/**
 * Revokes every cached blob URL. Called on sign-out so decrypted photos and
 * audio don't linger in memory after someone leaves — which matters most on
 * exactly the borrowed phone this app expects to be opened on.
 */
export function releaseAttachments(): void {
  for (const url of objectUrlCache.values()) URL.revokeObjectURL(url);
  objectUrlCache.clear();
}
