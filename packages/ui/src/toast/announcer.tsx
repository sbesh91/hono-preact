import { h, type JSX, type VNode } from 'preact';
import { useCallback, useRef } from 'preact/hooks';
import type { ToastRecord } from './toast-store.js';

// How long announcement text lingers before it is cleared, so re-announcing the
// same string later still triggers the live region.
const ANNOUNCE_CLEAR_MS = 1000;

// Visually-hidden but available to assistive tech (the standard sr-only recipe).
export const SR_ONLY_STYLE: JSX.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

// Flatten a record's title + description to a plain announcement string. Only
// string/number children contribute; non-text VNodes are skipped.
export function announcementText(record: ToastRecord): string {
  const parts: string[] = [];
  for (const part of [record.title, record.description]) {
    if (typeof part === 'string' || typeof part === 'number') {
      parts.push(String(part));
    }
  }
  return parts.join(' ');
}

export interface UseAnnouncerResult {
  politeRef: { current: HTMLDivElement | null };
  assertiveRef: { current: HTMLDivElement | null };
  announce: (text: string, important: boolean) => void;
}

export function useAnnouncer(): UseAnnouncerResult {
  const politeRef = useRef<HTMLDivElement | null>(null);
  const assertiveRef = useRef<HTMLDivElement | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((text: string, important: boolean) => {
    if (!text) return;
    const node = important ? assertiveRef.current : politeRef.current;
    if (!node) return;
    node.textContent = text;
    if (clearTimer.current != null) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      if (politeRef.current) politeRef.current.textContent = '';
      if (assertiveRef.current) assertiveRef.current.textContent = '';
    }, ANNOUNCE_CLEAR_MS);
  }, []);

  return { politeRef, assertiveRef, announce };
}

export interface ToastAnnouncerProps {
  politeRef: { current: HTMLDivElement | null };
  assertiveRef: { current: HTMLDivElement | null };
}

export function ToastAnnouncer(props: ToastAnnouncerProps): VNode {
  return h('div', { style: SR_ONLY_STYLE }, [
    h('div', {
      key: 'polite',
      ref: props.politeRef,
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    }),
    h('div', {
      key: 'assertive',
      ref: props.assertiveRef,
      role: 'alert',
      'aria-live': 'assertive',
      'aria-atomic': 'true',
    }),
  ]);
}
