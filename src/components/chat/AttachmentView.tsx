import { useCallback, useEffect, useRef, useState } from 'react';
import type { Attachment } from '@/types';
import { useEncryption } from '@/context/EncryptionContext';
import { loadAttachment } from '@/lib/attachments';
import { Spinner } from '@/components/common/Spinner';
import styles from './AttachmentView.module.scss';

/**
 * Renders a photo or voice note attached to a message.
 *
 * Nothing is fetched until it's asked for. On a borrowed phone with a few
 * minutes of patchy data, a chat that silently pulls down every photo in
 * the history is worse than useless — so each attachment shows a
 * correctly-shaped placeholder (sized from metadata stored alongside the
 * message) and downloads only on tap.
 */

type LoadState = 'idle' | 'loading' | 'ready' | 'locked' | 'failed';

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentView({ attachment }: { attachment: Attachment }) {
  const { getKey } = useEncryption();
  const [state, setState] = useState<LoadState>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (state === 'loading' || state === 'ready') return null;
    const key = getKey();
    if (!key) {
      setState('locked');
      return null;
    }
    setState('loading');
    try {
      const objectUrl = await loadAttachment(attachment.path, key, attachment.mime);
      if (!mounted.current) return null;
      setUrl(objectUrl);
      setState('ready');
      return objectUrl;
    } catch {
      if (mounted.current) setState('failed');
      return null;
    }
  }, [attachment.path, attachment.mime, getKey, state]);

  if (attachment.kind === 'image') {
    return <ImageAttachment attachment={attachment} state={state} url={url} onLoad={load} />;
  }
  return <AudioAttachment attachment={attachment} state={state} url={url} onLoad={load} />;
}

interface PartProps {
  attachment: Attachment;
  state: LoadState;
  url: string | null;
  onLoad: () => Promise<string | null>;
}

function ImageAttachment({ attachment, state, url, onLoad }: PartProps) {
  // Reserve the real shape up front so loading a photo doesn't shove the
  // conversation around — the dimensions come from the message row, not
  // from the file, so this costs no bandwidth.
  const ratio =
    attachment.width && attachment.height ? `${attachment.width} / ${attachment.height}` : '4 / 3';

  if (state === 'ready' && url) {
    return (
      <div className={styles.imageWrap} style={{ aspectRatio: ratio }}>
        {/* draggable + touch-callout are switched off so a long press doesn't
            offer "save image". This is friction, not a guarantee: a
            screenshot always works, and the README says so plainly. */}
        <img src={url} alt="Photo" className={styles.image} draggable={false} />
      </div>
    );
  }

  return (
    <button
      type="button"
      className={styles.imagePlaceholder}
      style={{ aspectRatio: ratio }}
      onClick={(e) => {
        e.stopPropagation();
        void onLoad();
      }}
      disabled={state === 'loading'}
    >
      {state === 'loading' ? (
        <Spinner size={20} thickness={2} />
      ) : state === 'locked' ? (
        <span className={styles.placeholderLabel}>🔒 Enter your passphrase to view</span>
      ) : state === 'failed' ? (
        <span className={styles.placeholderLabel}>Couldn't load — tap to retry</span>
      ) : (
        <span className={styles.placeholderLabel}>
          <PhotoIcon />
          Tap to view · {formatSize(attachment.size)}
        </span>
      )}
    </button>
  );
}

function AudioAttachment({ attachment, state, url, onLoad }: PartProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  async function togglePlay(e: React.MouseEvent) {
    e.stopPropagation();

    if (state !== 'ready') {
      const objectUrl = await onLoad();
      if (!objectUrl) return;
      // The <audio> element mounts in the same render that sets state to
      // 'ready', so it isn't in the DOM yet — wait a frame before playing.
      requestAnimationFrame(() => void audioRef.current?.play());
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }

  return (
    <div className={styles.audio}>
      <button
        type="button"
        className={styles.audioButton}
        onClick={togglePlay}
        disabled={state === 'loading'}
        aria-label={isPlaying ? 'Pause voice note' : 'Play voice note'}
      >
        {state === 'loading' ? <Spinner size={16} thickness={2} /> : isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div className={styles.audioMeta}>
        <WaveIcon />
        <span className={styles.audioDuration}>
          {state === 'locked'
            ? 'Locked'
            : state === 'failed'
              ? 'Failed'
              : attachment.durationMs
                ? formatDuration(attachment.durationMs)
                : 'Voice note'}
        </span>
      </div>

      {state === 'ready' && url && (
        <audio
          ref={audioRef}
          src={url}
          preload="none"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />
      )}
    </div>
  );
}

function PhotoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8.5" cy="10" r="1.5" fill="currentColor" />
      <path d="M21 16l-5-5-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5L8 5.5Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="7" y="5" width="3.5" height="14" rx="1" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg width="42" height="16" viewBox="0 0 42 16" fill="none" aria-hidden="true">
      {[2, 7, 12, 17, 22, 27, 32, 37].map((x, i) => {
        const heights = [6, 11, 4, 14, 8, 12, 5, 9];
        const h = heights[i];
        return (
          <rect key={x} x={x} y={(16 - h) / 2} width="2.5" height={h} rx="1.25" fill="currentColor" opacity="0.55" />
        );
      })}
    </svg>
  );
}
