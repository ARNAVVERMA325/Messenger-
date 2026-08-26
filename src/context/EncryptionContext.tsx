import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  deriveKeyFromPassphrase,
  exportKey,
  importKey,
  encryptText,
  decryptText,
  isEncryptedContent,
  isWebCryptoSupported,
} from '@/lib/crypto';
import { deviceSessionStorage } from '@/lib/deviceSession';
import { supabase } from '@/lib/supabaseClient';
import { releaseAttachments } from '@/lib/attachments';

/**
 * PHASE 4 — the optional privacy layer. This context is the ONLY place a
 * derived encryption key exists outside `src/lib/crypto.ts` itself: it
 * lives in memory and, so it survives a refresh, as an exported key cached
 * in browser storage — via deviceSessionStorage, so on a borrowed phone the
 * key is discarded with the tab rather than left behind. It is also cleared
 * on sign-out (see the effect below). Nothing here ever calls the network —
 * there is no server component to this feature at all. See the "Privacy
 * layer" section of the README for exactly what this does and doesn't
 * protect against.
 */

const STORAGE_KEY_EXPORTED_KEY = 'anya-encryption-key';
const STORAGE_KEY_ENABLED = 'anya-encryption-enabled';

export type DecryptResult =
  | { status: 'plain'; text: string }
  | { status: 'decrypted'; text: string }
  | { status: 'locked' } // encrypted, but this browser has no key cached yet
  | { status: 'failed' }; // encrypted, we have a key, but it didn't match (wrong passphrase, or corrupted)

interface EncryptionContextValue {
  isSupported: boolean;
  hasKey: boolean;
  isEnabled: boolean;
  setPassphrase: (passphrase: string) => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  forgetKey: () => void;
  /**
   * The raw key, for encrypting attachment bytes (see src/lib/attachments.ts).
   * A getter rather than a value so callers read it at the moment of use and
   * can't capture a stale key in a closure after the passphrase changes.
   */
  getKey: () => CryptoKey | null;
  encryptOutgoing: (text: string) => Promise<string>;
  decrypt: (content: string) => Promise<DecryptResult>;
}

const EncryptionContext = createContext<EncryptionContextValue | null>(null);

export function EncryptionProvider({ children }: { children: ReactNode }) {
  const isSupported = useMemo(isWebCryptoSupported, []);
  const [key, setKey] = useState<CryptoKey | null>(null);
  // Read synchronously (localStorage itself is sync) so the "encrypt
  // outgoing messages" intent is correct from the very first render — only
  // actually importing the cached key back into a CryptoKey needs a
  // (typically sub-20ms) async step, tracked by isRestoring below so
  // encryptOutgoing can't race it and silently send plaintext instead.
  const [isEnabled, setIsEnabledState] = useState(() => {
    try {
      return deviceSessionStorage.getItem(STORAGE_KEY_ENABLED) === '1';
    } catch {
      return false;
    }
  });
  const [isRestoring, setIsRestoring] = useState(true);

  const keyRef = useRef<CryptoKey | null>(null);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  // Restore a previously cached key on mount.
  useEffect(() => {
    if (!isSupported) {
      setIsRestoring(false);
      return;
    }
    (async () => {
      try {
        const storedKey = deviceSessionStorage.getItem(STORAGE_KEY_EXPORTED_KEY);
        if (storedKey) setKey(await importKey(storedKey));
      } catch {
        // Corrupted storage or storage disabled: fall back to no key, encryption off.
      } finally {
        setIsRestoring(false);
      }
    })();
  }, [isSupported]);

  const setPassphrase = useCallback(async (passphrase: string) => {
    const derived = await deriveKeyFromPassphrase(passphrase);
    const exported = await exportKey(derived);
    try {
      deviceSessionStorage.setItem(STORAGE_KEY_EXPORTED_KEY, exported);
    } catch {
      // Storage disabled: the key still works for this tab via state, it just won't survive a refresh.
    }
    setKey(derived);
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setIsEnabledState(enabled);
    try {
      deviceSessionStorage.setItem(STORAGE_KEY_ENABLED, enabled ? '1' : '0');
    } catch {
      // Ignore.
    }
  }, []);

  const forgetKey = useCallback(() => {
    setKey(null);
    setIsEnabledState(false);
    try {
      deviceSessionStorage.removeItem(STORAGE_KEY_EXPORTED_KEY);
      deviceSessionStorage.removeItem(STORAGE_KEY_ENABLED);
    } catch {
      // Ignore.
    }
  }, []);

  // Signing out has to take the decryption key with it. Without this, tapping
  // "Leave chat" on someone else's phone ended the Supabase session but left
  // an exported AES key sitting in that browser's storage — secret material
  // stranded on a device that isn't yours. Listening for the auth event
  // rather than having logout() call in also covers the session simply
  // expiring, which no button press is involved in.
  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        forgetKey();
        // Decrypted photos and voice notes are held as in-memory blob URLs;
        // leaving them alive after sign-out would keep readable copies on a
        // phone whose owner just handed it back.
        releaseAttachments();
      }
    });
    return () => subscription.unsubscribe();
  }, [forgetKey]);

  const getKey = useCallback(() => keyRef.current, []);

  const encryptOutgoing = useCallback(
    async (text: string) => {
      if (!isEnabled || !keyRef.current) return text;
      return encryptText(keyRef.current, text);
    },
    [isEnabled],
  );

  // Referentially stable (reads the ref, not `key`, so it never changes
  // identity) — lets callers depend on it in effects without re-running
  // every time the key itself changes.
  const decrypt = useCallback(async (content: string): Promise<DecryptResult> => {
    if (!isEncryptedContent(content)) return { status: 'plain', text: content };
    if (!keyRef.current) return { status: 'locked' };
    try {
      const text = await decryptText(keyRef.current, content);
      return { status: 'decrypted', text };
    } catch {
      return { status: 'failed' };
    }
  }, []);

  const value = useMemo<EncryptionContextValue>(
    () => ({
      isSupported,
      hasKey: key !== null,
      isEnabled: isEnabled && !isRestoring,
      setPassphrase,
      setEnabled,
      forgetKey,
      getKey,
      encryptOutgoing,
      decrypt,
    }),
    [isSupported, key, isEnabled, isRestoring, setPassphrase, setEnabled, forgetKey, getKey, encryptOutgoing, decrypt],
  );

  return <EncryptionContext.Provider value={value}>{children}</EncryptionContext.Provider>;
}

export function useEncryption(): EncryptionContextValue {
  const ctx = useContext(EncryptionContext);
  if (!ctx) throw new Error('useEncryption must be used within an EncryptionProvider');
  return ctx;
}
