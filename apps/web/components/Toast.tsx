'use client';

import { useEffect, useState } from 'react';

/** The prototype's single-line toast, which is the game's only error channel. */
export function Toast({ message }: { message: string | null }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!message) return;
    setShown(true);
    const timer = setTimeout(() => setShown(false), 1700);
    return () => clearTimeout(timer);
  }, [message]);

  return <div id="toast" className={shown ? 'on' : ''}>{message ?? ''}</div>;
}
