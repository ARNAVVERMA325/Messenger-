/**
 * ANYA LABS — client-side message encryption (Phase 4, optional).
 *
 * Only two primitives are used, both from the browser's native Web Crypto
 * API — nothing here is a home-grown algorithm:
 *   - PBKDF2 to turn a human passphrase into a 256-bit key.
 *   - AES-GCM (authenticated encryption) to encrypt/decrypt message text.
 *
 * See the "Privacy layer" section of the README for what this does and
 * doesn't protect, in plain language. The short version: the passphrase and
 * every key derived from it exist ONLY in each person's browser — this
 * module has no network calls, no server dependency, nothing to configure
 * server-side. Supabase only ever stores whatever string encryptText()
 * produces; it cannot derive the key or recover the plaintext from it.
 */

const ENCRYPTED_PREFIX = 'ENCv1:';
const PBKDF2_ITERATIONS = 250_000;
const AES_KEY_LENGTH = 256;
const GCM_IV_BYTES = 12;

// The PBKDF2 salt is public (it has to be — both people's browsers need the
// identical value with no way to exchange it out of band) and constant per
// deployment. That means it defends the passphrase against generic
// rainbow-table precomputation but not one built specifically for this
// deployment's salt — set VITE_ENCRYPTION_SALT to something unique per
// deployment (see .env.example) and choose a passphrase that isn't a
// common word or phrase. The iteration count is what makes each individual
// guess expensive; the salt just stops guesses being reused across sites.
const DEFAULT_SALT = 'anya-labs-default-salt-set-VITE_ENCRYPTION_SALT-per-deployment';

/**
 * Each room created since multi-tenancy has its own random salt, stored on
 * its rooms row; the original (legacy) room has none and keeps using the
 * deployment-wide value. That fallback is not optional — the same
 * passphrase with a different salt derives a different key, so changing
 * the legacy room's salt would make every message it ever encrypted
 * unreadable.
 */
function getSalt(roomSalt?: string | null): Uint8Array {
  if (roomSalt) return new TextEncoder().encode(roomSalt);
  const configured = import.meta.env.VITE_ENCRYPTION_SALT;
  const value = configured && configured.length > 0 ? configured : DEFAULT_SALT;
  return new TextEncoder().encode(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// TypeScript's DOM lib types Uint8Array as generic over its backing buffer
// (Uint8Array<ArrayBufferLike>), which no longer structurally matches the
// stricter BufferSource (ArrayBuffer-only) the Web Crypto API expects.
// Every Uint8Array this module produces is genuinely ArrayBuffer-backed at
// runtime (never a SharedArrayBuffer view) — this is just narrowing that
// back to what TypeScript can't infer on its own.
function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource;
}

export function isWebCryptoSupported(): boolean {
  return typeof crypto !== 'undefined' && Boolean(crypto.subtle);
}

/** Derives a fresh, extractable AES-GCM key from a passphrase. Never stores or transmits the passphrase itself. */
export async function deriveKeyFromPassphrase(passphrase: string, roomSalt?: string | null): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toBufferSource(getSalt(roomSalt)), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    true, // extractable, so it can be cached locally (see EncryptionContext)
    ['encrypt', 'decrypt'],
  );
}

/** Exports a key to a storable string, for caching in localStorage. */
export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bytesToBase64(new Uint8Array(raw));
}

/** Re-imports a key previously produced by exportKey(). */
export async function importKey(base64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(base64);
  return crypto.subtle.importKey('raw', toBufferSource(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export function isEncryptedContent(content: string): boolean {
  return content.startsWith(ENCRYPTED_PREFIX);
}

/** Encrypts plaintext with a fresh random IV, returning a self-describing envelope string. */
export async function encryptText(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBufferSource(iv) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${ENCRYPTED_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

/**
 * Encrypts raw bytes (a photo, a voice note) with a fresh random IV.
 *
 * Unlike encryptText's string envelope, the IV is prepended to the
 * ciphertext as raw bytes — base64 would inflate an already-large file by
 * a third for no benefit, since nothing needs to read this as text. Layout
 * is simply [12-byte IV][ciphertext].
 */
export async function encryptBytes(key: CryptoKey, data: ArrayBuffer): Promise<Blob> {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toBufferSource(iv) }, key, data);
  return new Blob([iv, new Uint8Array(ciphertext)]);
}

/**
 * Reverses encryptBytes(). Throws on a wrong key or corrupted data rather
 * than returning garbage — AES-GCM's authentication tag guarantees that.
 */
export async function decryptBytes(key: CryptoKey, payload: ArrayBuffer): Promise<ArrayBuffer> {
  if (payload.byteLength <= GCM_IV_BYTES) throw new Error('Encrypted payload is too short to contain an IV');
  const iv = new Uint8Array(payload, 0, GCM_IV_BYTES);
  const ciphertext = new Uint8Array(payload, GCM_IV_BYTES);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBufferSource(iv) }, key, toBufferSource(ciphertext));
}

/**
 * Decrypts an envelope produced by encryptText(). Throws if `encoded` isn't
 * one (check isEncryptedContent first), or if the key is wrong / content is
 * corrupted — AES-GCM's authentication tag makes that distinction reliable:
 * it never silently returns garbage, only a clean failure.
 */
export async function decryptText(key: CryptoKey, encoded: string): Promise<string> {
  if (!isEncryptedContent(encoded)) throw new Error('Content is not an encrypted envelope');

  const [ivB64, ciphertextB64] = encoded.slice(ENCRYPTED_PREFIX.length).split(':');
  if (!ivB64 || !ciphertextB64) throw new Error('Malformed encrypted envelope');

  const iv = base64ToBytes(ivB64);
  const ciphertext = base64ToBytes(ciphertextB64);
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBufferSource(iv) },
    key,
    toBufferSource(ciphertext),
  );
  return new TextDecoder().decode(plaintextBuffer);
}
