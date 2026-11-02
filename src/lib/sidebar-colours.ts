import {luminance, mix, toRgb, until} from './colour';

/** The dashboard sidebar's default dark panel (app.css `.app-sidebar`). */
export const DEFAULT_SIDEBAR_BG = '#1f1a16';
export const DEFAULT_SIDEBAR_TEXT = '#f3eee6';

const DEFAULTS: Record<string, string> = {
  '--ink': '#f3eee6',
  '--muted': '#b9b1a6',
  '--subtle': '#8c857b',
  '--line': '#3a332c',
  '--line-strong': '#4d453c',
  '--hover': '#2d2722',
  '--card': '#1f1a16',
  '--accent': '#f3eee6',
  '--accent-ink': '#1a1714',
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
  const text = until(textPick || (dark ? DEFAULT_SIDEBAR_TEXT : '#1a1714'), toward, bg, 4.5);
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
