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

export type RecorderState =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'unsupported'
  | 'denied' // the permission prompt was refused, or a previous refusal is remembered
  | 'no-device' // no microphone attached, or it's disabled at the OS level
  | 'busy' // a microphone exists but something else is holding it
  | 'insecure' // getUserMedia needs HTTPS (or localhost)
  | 'failed';

/**
 * getUserMedia rejects for several very different reasons, and reporting
 * them all as "you refused" is actively misleading — a laptop with no
 * microphone never shows a prompt at all, so "refused" sends people hunting
 * through browser settings for a permission they were never asked for.
 */
export function describeRecorderProblem(state: RecorderState): string | null {
  switch (state) {
    case 'denied':
      // A stored block is why no prompt appears — the browser answers on the
      // page's behalf. Nothing the page does can re-trigger the prompt, so
      // the only useful thing to say is where the setting lives.
      return 'Your browser is blocking the microphone for this site, so it never shows the permission prompt. Tap the padlock (or ⓘ) next to the address bar → Permissions → allow Microphone, then try again.';
    case 'no-device':
      return "No microphone was found on this device, so voice notes can't be recorded here.";
    case 'busy':
      return 'Something else is using the microphone. Close it and try again.';
    case 'insecure':
      return 'Voice notes need a secure (https) connection.';
    case 'unsupported':
      return "This browser can't record audio.";
    case 'failed':
      return "The microphone couldn't be started. Try again.";
    default:
      return null;
  }
}

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
      // Checked first because a stored block makes getUserMedia reject
      // instantly with the same error a fresh refusal produces — without
      // this, "denied" can't be distinguished from "you just said no", and
      // the advice for each is different.
      let alreadyBlocked = false;
      try {
        const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
        alreadyBlocked = status?.state === 'denied';
      } catch {
        // Firefox rejects an unknown permission name; fall through and let
        // getUserMedia itself be the judge.
      }
      if (alreadyBlocked) {
        setState('denied');
        return;
      }

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
    } catch (error) {
      // Browsers signal the distinction through DOMException.name; without
      // this every cause collapses into "refused" and sends people looking
      // for a prompt they never saw.
      const name = error instanceof DOMException ? error.name : '';
      if (!window.isSecureContext) setState('insecure');
      else if (name === 'NotAllowedError' || name === 'SecurityError') setState('denied');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setState('no-device');
      else if (name === 'NotReadableError' || name === 'AbortError') setState('busy');
      else setState('failed');
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
