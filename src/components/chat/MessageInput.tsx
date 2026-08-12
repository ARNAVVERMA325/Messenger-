import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useChat } from '@/context/ChatContext';
import { MAX_MESSAGE_LENGTH } from '@/utils/constants';
import styles from './MessageInput.module.scss';

export function MessageInput() {
  const { sendMessage, notifyTyping, editingMessage, editMessage, cancelEdit } = useChat();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isEditing = Boolean(editingMessage);

  useEffect(() => {
    if (editingMessage) {
      setValue(editingMessage.text);
      textareaRef.current?.focus();
      requestAnimationFrame(resize);
    }
  }, [editingMessage]);

  function resize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    if (!isEditing) notifyTyping();
    requestAnimationFrame(resize);
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (editingMessage) {
      editMessage(editingMessage.id, trimmed);
    } else {
      sendMessage(trimmed);
    }
    setValue('');
    requestAnimationFrame(resize);
  }

  function handleCancelEdit() {
    cancelEdit();
    setValue('');
    requestAnimationFrame(resize);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape' && isEditing) {
      handleCancelEdit();
    }
  }

  return (
    <div className={styles.wrap}>
      {isEditing && (
        <div className={styles.editingBanner}>
          <span>Editing message</span>
          <button type="button" onClick={handleCancelEdit} className={styles.editingCancel}>
            Cancel
          </button>
        </div>
      )}
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
            maxLength={MAX_MESSAGE_LENGTH}
          />
        </div>
        <button
          type="submit"
          className={styles.sendButton}
          disabled={!value.trim()}
          aria-label={isEditing ? 'Save edit' : 'Send message'}
        >
          {isEditing ? <CheckIcon /> : <SendIcon />}
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

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12.5l5 5L20 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
