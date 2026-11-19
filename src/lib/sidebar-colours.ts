import {luminance, mix, toRgb, until} from './colour';

/** The dashboard sidebar's default white panel (app.css `.app-sidebar`, light theme). */
export const DEFAULT_SIDEBAR_BG = '#ffffff';
export const DEFAULT_SIDEBAR_TEXT = '#0d0c22';
/** The text a picked dark background starts from. */
const LIGHT_TEXT = '#f4f4f5';

const DEFAULTS: Record<string, string> = {
  '--ink': '#0d0c22',
  '--muted': '#5e5e6d',
  '--subtle': '#6e6d7a',
  '--line': '#ececee',
  '--line-strong': '#e2e2e5',
  '--hover': '#f3f3f4',
  '--card': '#ffffff',
  '--accent': '#0d0c22',
  '--accent-ink': '#ffffff',
};

/**
 * The sidebar's tokens for the picked background and text colour (empty or null = the default).
 * Text is nudged to at least 4.5:1 on the background; the active item inverts (text colour fill,
 * background ink). `--card` doubles as the panel's background.
 */
export function sidebarTokens(bgPick: string | null, textPick: string | null): Record<string, string> {
  if (!bgPick && !textPick) return DEFAULTS;
  const bg = bgPick || DEFAULT_SIDEBAR_BG;
  const dark = luminance(toRgb(bg)) < 0.18;
  const toward = dark ? '#ffffff' : '#000000';
  const text = until(textPick || (dark ? LIGHT_TEXT : DEFAULT_SIDEBAR_TEXT), toward, bg, 4.5);
  return {
    '--ink': text,
    '--muted': mix(text, bg, 0.25),
    '--subtle': mix(text, bg, 0.45),
    '--line': mix(bg, toward, 0.14),
    '--line-strong': mix(bg, toward, 0.24),
    '--hover': mix(bg, toward, 0.08),
    '--card': bg,
    '--accent': text,
    '--accent-ink': bg,
  };
}
