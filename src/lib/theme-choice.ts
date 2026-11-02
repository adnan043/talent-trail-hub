/**
 * BROWSER: the visitor's theme (Light / Dark / System, default System), shared by the header's
 * theme menu and the mobile menu. Kept under the portal's key (`site:theme`) and applied as
 * `data-theme` on <html> (global.css, brand.css). The layout's hashed boot script
 * (src/lib/theme-boot.ts) applies it before first paint.
 */
export type Theme = 'light' | 'dark' | 'system';

const KEY = 'site:theme';
/** Fired on `document` after a change, so every control on the page shows it. */
export const THEME_EVENT = 'site:theme-change';

export const THEMES: {value: Theme; label: string}[] = [
  {value: 'light', label: 'Light'},
  {value: 'dark', label: 'Dark'},
  {value: 'system', label: 'System'},
];

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme): void {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  document.dispatchEvent(new CustomEvent(THEME_EVENT, {detail: theme}));
}

export const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark' || value === 'system';
