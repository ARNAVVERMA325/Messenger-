import { useRef, useState, type KeyboardEvent } from 'react';
import { useChat } from '@/context/ChatContext';
import styles from './MessageInput.module.scss';

export function MessageInput() {
  const { sendMessage, notifyTyping } = useChat();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    notifyTyping();
    requestAnimationFrame(resize);
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    setValue('');
    requestAnimationFrame(resize);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className={styles.wrap}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className={styles.field}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder="Message"
            rows={1}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            aria-label="Message"
            autoComplete="off"
          />
        </div>
        <button type="submit" className={styles.sendButton} disabled={!value.trim()} aria-label="Send message">
          <SendIcon />
        </button>
      </form>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12l16-7-7 16-2.5-6.5L4 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
