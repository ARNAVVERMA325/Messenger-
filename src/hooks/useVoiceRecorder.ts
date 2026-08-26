import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttachmentDraft } from '@/lib/attachments';

/**
 * Records a voice note with MediaRecorder.
 *
 * Opus is asked for explicitly where supported: it's dramatically smaller
 * than the alternatives at speech quality (roughly 30kB a minute), which is
 * the difference between a voice note that sends on patchy data and one
 * that times out. Where the browser disagrees, whatever it offers is used
 * instead and the real MIME type is recorded with the message.
 */

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/mp4',
];

// A voice note, not a podcast — and an upper bound on what a stuck recorder
// can consume if someone pockets the phone mid-record.
const MAX_DURATION_MS = 5 * 60 * 1000;

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'unsupported' | 'denied';

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>(() =>
    typeof MediaRecorder === 'undefined' || !navigator.mediaDevices ? 'unsupported' : 'idle',
  );
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const stopTracks = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  // The microphone must be released if this unmounts mid-recording —
  // otherwise the browser's "recording" indicator stays on after the UI is
  // long gone, which is alarming on someone else's phone.
  useEffect(() => stopTracks, [stopTracks]);

  const start = useCallback(async () => {
    if (state === 'unsupported') return;
    setState('requesting');
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      recorder.start();
      setState('recording');

      tickRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        if (elapsed >= MAX_DURATION_MS) recorderRef.current?.stop();
      }, 200);
    } catch {
      // Covers both a refused permission prompt and a device with no
      // usable microphone — neither is recoverable by retrying here.
      setState('denied');
    }
  }, [state]);

  /** Stops and returns the recording, or null if it was cancelled or empty. */
  const stop = useCallback(async (): Promise<AttachmentDraft | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return null;

    const durationMs = Date.now() - startedAtRef.current;

    const blob = await new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        if (cancelledRef.current || chunksRef.current.length === 0) return resolve(null);
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }));
      };
      recorder.stop();
    });

    stopTracks();
    recorderRef.current = null;
    chunksRef.current = [];
    setState('idle');
    setElapsedMs(0);

    // Sub-second taps are almost always a mis-tap on the record button
    // rather than an intended message.
    if (!blob || durationMs < 500) return null;

    return {
      blob,
      kind: 'audio',
      mime: recorder.mimeType || 'audio/webm',
      durationMs,
    };
  }, [stopTracks]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    void stop();
  }, [stop]);

  return { state, elapsedMs, start, stop, cancel, isRecording: state === 'recording' };
}
