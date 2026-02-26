import { useEffect, useState } from 'react';

/**
 * Returns whether the given media query matches. Updates on change (e.g. resize).
 * SSR-safe: defaults to false so narrow layout is safe; use (min-width) for desktop.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** Breakpoint: sidebar is inline (desktop). Below this, sidebar is a drawer. */
export const SIDEBAR_INLINE_BREAKPOINT = '(min-width: 768px)';
