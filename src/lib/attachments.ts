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

/**
 * Downscales and re-encodes a picked image.
 *
 * This also quietly strips EXIF — including GPS coordinates, which phone
 * cameras embed by default — because the canvas re-encode only carries
 * pixels across, not the original file's metadata. Worth knowing that's a
 * deliberate side effect and not an accident to be "fixed" later.
 */
export async function prepareImage(file: File): Promise<AttachmentDraft> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', IMAGE_QUALITY),
    );
    if (!blob) throw new Error('Could not process this image');

    return { blob, kind: 'image', mime: 'image/jpeg', width, height };
  } finally {
    // Bitmaps hold decoded pixel data — on a 12MP photo that's ~48MB of
    // memory, which a low-end phone will not forgive us for leaking.
    bitmap.close();
  }
}

/** Encrypts and uploads a prepared draft, returning what the message row needs. */
export async function uploadAttachment(
  draft: AttachmentDraft,
  key: CryptoKey,
): Promise<UploadedAttachment> {
  if (!supabase) throw new Error('Not connected');
  if (draft.blob.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('That file is too large to send');
  }

  const encrypted = await encryptBytes(key, await draft.blob.arrayBuffer());

  // A random name, with no extension and nothing derived from the original
  // filename: the bucket listing shouldn't hint at what any file contains,
  // and the real type is recorded on the message row instead.
  const path = `${crypto.randomUUID()}`;

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
