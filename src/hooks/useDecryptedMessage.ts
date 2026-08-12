import { useEffect, useState } from 'react';
import { useEncryption, type DecryptResult } from '@/context/EncryptionContext';
import { isEncryptedContent } from '@/lib/crypto';

/**
 * Resolves a message's stored `content` (which may be plaintext or an
 * encrypted envelope) to what should actually be shown. Plain content
 * resolves synchronously on first render — only encrypted content goes
 * through the async decrypt path, so ordinary messages never show a
 * "decrypting…" flicker.
 */
export function useDecryptedMessage(rawContent: string): DecryptResult | { status: 'decrypting' } {
  const { decrypt } = useEncryption();
  const alreadyPlain = !isEncryptedContent(rawContent);

  const [state, setState] = useState<DecryptResult | { status: 'decrypting' }>(() =>
    alreadyPlain ? { status: 'plain', text: rawContent } : { status: 'decrypting' },
  );

  useEffect(() => {
    if (alreadyPlain) {
      setState({ status: 'plain', text: rawContent });
      return;
    }

    let cancelled = false;
    setState({ status: 'decrypting' });
    decrypt(rawContent).then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [rawContent, alreadyPlain, decrypt]);

  return state;
}
