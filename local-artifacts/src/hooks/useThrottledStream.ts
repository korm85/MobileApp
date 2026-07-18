import { useCallback, useRef, useState } from 'react';

export function useThrottledStream(flushIntervalMs = 80) {
  const [text, setText] = useState('');
  const buffer = useRef('');
  const lastFlush = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    setText(buffer.current);
    lastFlush.current = Date.now();
    timer.current = null;
  }, []);

  const append = useCallback((token: string) => {
    buffer.current += token;
    const elapsed = Date.now() - lastFlush.current;
    if (elapsed >= flushIntervalMs) flush();
    else if (!timer.current) timer.current = setTimeout(flush, flushIntervalMs - elapsed);
  }, [flush, flushIntervalMs]);

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    buffer.current = '';
    lastFlush.current = 0;
    setText('');
  }, []);

  return { text, append, reset };
}
