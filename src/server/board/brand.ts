import type {PrismaClient} from '../../generated/prisma/client';
import type {FontPreset} from '../../lib/board';
import {contrast, luminance, mix, toRgb} from '../../lib/colour';
import {sidebarTokens} from '../../lib/sidebar-colours';
import {cache} from '../../platform/cache';
import {forgetPublicLists} from './public-cache';
import {type BoardSettings, getBoardSettings} from './settings';

export {contrast};

/**
 * Runtime branding (F30): the board settings read through the Site Cache (public data, the same
 * for every visitor, one key), and the stylesheet built from them (`GET /site-api/board/brand.css`,
 * linked by the layouts). The CSP blocks inline style attributes, so the brand is a real stylesheet.
 */

const DAY = 86_400;

/** The Site Cache key of the board settings (docs/agent/cache.md). */
export const BOARD_SETTINGS_KEY = 'board:settings';
/**
 * The board settings for SHOWING and routing (name, brand, mode, moderation): kept 7 days in the
 * Site Cache, cleared by every write to `board_settings` (`forgetBoardSettings`). A route that
 * CHARGES (free posting, the currency of an order) reads `getBoardSettings` instead.
 * The value has no dates (JSON-safe as it is).
 */
export function cachedBoardSettings(db: PrismaClient): Promise<BoardSettings> {
  return cache.getOrSet(BOARD_SETTINGS_KEY, 7 * DAY, () => getBoardSettings(db));
}

/**
 * Clears the cached settings and the public reads built from them, for every Worker instance. Call
 * (and await) it right after ANY write to `board_settings` succeeds, outside the transaction.
 */
export async function forgetBoardSettings(): Promise<void> {
  // The public lists are built with the settings (single-company scope, currency): they go too.
  await Promise.all([cache.del(BOARD_SETTINGS_KEY), forgetPublicLists()]);
}

export const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

/**
 * The surfaces brand colours must read on, per scheme (global.css: `--bg`, `--hover` (the
 * old design's `secondary` tint, the darkest tinted surface in light mode) and `--card`).
 */
const LIGHT = {bg: '#faf7f2', secondary: '#f3eee6', card: '#ffffff'};
const DARK = {bg: '#161310', secondary: '#29241f', card: '#1f1b17'};

/** Ink: the fill of primary buttons while the brand is a neutral or the default terracotta. */
const INK = '#1a1714';
/** Paper: the same fill in dark mode (ink buttons invert). */
const PAPER = '#f3eee6';
/** Terracotta: the design's accent (dots, Featured, link hovers, focus ring) and the default brand colour. */
export const DEFAULT_BRAND = '#a63d23';
/** Share of the accent in its tint (`--brand-soft`), light and dark. */
const SOFT_TINT = {light: 0.09, dark: 0.2};

/** Black, white and greys (no visible hue). */
const isNeutral = (hex: string) => {
  const rgb = toRgb(hex);
  return Math.max(...rgb) - Math.min(...rgb) <= 24;
};

/** `color` moved toward black (on a light surface) or white (on a dark one) until it reaches `ratio` on `bg`. */
function readableOn(color: string, bg: string, ratio = 4.5): string {
  const toward = luminance(toRgb(bg)) < 0.18 ? '#ffffff' : '#000000';
  for (let step = 0; step <= 20; step++) {
    const candidate = mix(color, toward, step / 20);
    if (contrast(candidate, bg) >= ratio) return candidate;
  }
  return toward;
}

/**
 * The brand tokens for one scheme (the old design's F30 theming, on the template's token names):
 * - `--accent` / `--accent-hover` / `--accent-ink`: the primary FILL (buttons, the active page).
 *   Ink (paper in dark mode) while the brand is a neutral or the default terracotta, else the brand.
 * - `--brand`, `--brand-text`, `--brand-soft`, `--brand-soft-ink`, `--ring`: the accent (live dot,
 *   Featured, link hovers, focus ring). Terracotta while the brand is a neutral, else the brand.
 * - `--accent-soft` / `--accent-text` = `--brand-soft` / `--brand-text` (template names).
 * Every text pair is at least WCAG AA (4.5:1) on the page and on the tinted surfaces.
 * The default brand (#a63d23) gives exactly the `:root` values of global.css.
 */
export function accentTokens(primary: string, scheme: 'light' | 'dark'): Record<string, string> {
  const base = isHexColor(primary) ? primary.toLowerCase() : DEFAULT_BRAND;
  const surfaces = scheme === 'light' ? LIGHT : DARK;
  const neutral = isNeutral(base);
  const inkFill = neutral || base === DEFAULT_BRAND;
  const fillBase = inkFill ? (scheme === 'dark' ? PAPER : INK) : base;
  const fill = readableOn(readableOn(fillBase, surfaces.bg), surfaces.card);
  const ink = contrast('#ffffff', fill) >= contrast('#000000', fill) ? '#ffffff' : '#000000';
  const accent = neutral ? DEFAULT_BRAND : base;
  const brandText = readableOn(readableOn(accent, surfaces.bg), surfaces.secondary);
  const soft = mix(surfaces.bg, accent, SOFT_TINT[scheme]);
  return {
    '--accent': fill,
    '--accent-hover': mix(fill, surfaces.bg, 0.15),
    '--accent-ink': ink,
    '--accent-soft': soft,
    '--accent-text': brandText,
    '--brand': accent,
    '--brand-text': brandText,
    '--brand-soft': soft,
    '--brand-soft-ink': readableOn(accent, soft, 7),
    '--ring': brandText,
  };
}

const FONTS: Record<FontPreset, string | null> = {
  // The stored value `inter` means the design's own font: Plus Jakarta Sans (global.css).
  inter: null,
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

const block = (selector: string, tokens: Record<string, string>) =>
  `${selector} {\n${Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')}\n}`;

/**
 * The brand stylesheet: accent tokens per scheme (light, dark by choice, dark by the device) and
 * the font preset. Single-company boards also hide marketplace-only links (`[data-marketplace-only]`),
 * which reaches prerendered pages too. `html:root` outranks global.css's `:root` whatever the
 * order of the stylesheets. Only validated values reach the CSS (hex, fixed font stacks).
 */
export function brandCss(settings: Pick<BoardSettings, 'primaryColor' | 'fontPreset' | 'sidebarBg' | 'sidebarText'>, singleCompany: boolean): string {
  const font = FONTS[settings.fontPreset] ?? null;
  const light = {...accentTokens(settings.primaryColor, 'light'), ...(font ? {'--font-sans': font, '--font-display': font} : {})};
  const dark = accentTokens(settings.primaryColor, 'dark');
  const sidebar = settings.sidebarBg || settings.sidebarText ? sidebarTokens(settings.sidebarBg, settings.sidebarText) : null;
  return [
    '/* Board branding (F30): generated from the board settings. */',
    block('html:root', light),
    block("html:root[data-theme='dark']", dark),
    `@media (prefers-color-scheme: dark) {\n${block("html:root:not([data-theme='light'])", dark).replace(/^/gm, '  ')}\n}`,
    ...(sidebar ? [block('html:root .app-sidebar', {...sidebar, background: sidebar['--card']})] : []),
    ...(singleCompany ? ['[data-marketplace-only] {\n  display: none !important;\n}'] : []),
    '',
  ].join('\n\n');
}
