/**
 * Theme utilities for light/dark mode.
 * Theme is stored in localStorage under THEME_STORAGE_KEY and applied via class "dark" on document.documentElement.
 * Resolution order: stored preference → prefers-color-scheme → light.
 */

export const THEME_STORAGE_KEY = 'logs-viewer-theme';

export type Theme = 'light' | 'dark';

export function getSystemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(THEME_STORAGE_KEY);
  if (v === 'dark' || v === 'light') return v;
  return null;
}

/** Resolve effective theme: stored → system → light */
export function getEffectiveTheme(): Theme {
  return getStoredTheme() ?? getSystemTheme();
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/** Run once at app init to apply theme before first paint (call from main.tsx). */
export function initTheme(): void {
  const theme = getEffectiveTheme();
  applyTheme(theme);
}

export function setStoredTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}
