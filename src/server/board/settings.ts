import type {PrismaClient} from '../../generated/prisma/client';
import {type BoardMode, FONT_PRESETS, type FontPreset, type ModerationMode} from '../../lib/board';

/** The board's settings as the code uses them (the `board_settings` row, id 1, with its defaults). */
export interface BoardSettings {
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  sidebarBg: string | null;
  sidebarText: string | null;
  fontPreset: FontPreset;
  heroTitle: string;
  heroSubtitle: string;
  footerLinks: {label: string; href: string}[];
  currency: string;
  moderationMode: ModerationMode;
  freePostingEnabled: boolean;
  boardMode: BoardMode;
  ownerCompanyId: number | null;
}

const select = {
  name: true,
  logoUrl: true,
  faviconUrl: true,
  primaryColor: true,
  sidebarBg: true,
  sidebarText: true,
  fontPreset: true,
  heroTitle: true,
  heroSubtitle: true,
  footerLinks: true,
  currency: true,
  moderationMode: true,
  freePostingEnabled: true,
  boardMode: true,
  ownerCompanyId: true,
} as const;

/** Reads the settings row; creates it with the defaults when missing (one row, `id = 1`). */
export async function getBoardSettings(db: PrismaClient): Promise<BoardSettings> {
  const row =
    (await db.boardSettings.findUnique({where: {id: 1}, select})) ??
    (await db.boardSettings.upsert({where: {id: 1}, create: {id: 1}, update: {}, select}));
  // Checked on read too (the row is JSON and text): a bad value falls back, it never reaches a page.
  const links = (Array.isArray(row.footerLinks) ? row.footerLinks : [])
    .filter(
      (link): link is {label: string; href: string} =>
        typeof link === 'object' && link !== null &&
        typeof (link as {label?: unknown}).label === 'string' && typeof (link as {href?: unknown}).href === 'string'
    )
    .slice(0, 8);
  return {
    ...row,
    primaryColor: /^#[0-9a-f]{6}$/i.test(row.primaryColor) ? row.primaryColor : '#a63d23',
    sidebarBg: row.sidebarBg && /^#[0-9a-f]{6}$/i.test(row.sidebarBg) ? row.sidebarBg : null,
    sidebarText: row.sidebarText && /^#[0-9a-f]{6}$/i.test(row.sidebarText) ? row.sidebarText : null,
    fontPreset: (FONT_PRESETS as readonly string[]).includes(row.fontPreset) ? (row.fontPreset as FontPreset) : 'inter',
    moderationMode: row.moderationMode === 'auto' ? 'auto' : 'all',
    boardMode: row.boardMode === 'single_company' ? 'single_company' : 'marketplace',
    footerLinks: links,
  };
}

/** Single-company mode (F39) is on only with an owner company; without one the board is a marketplace. */
export const isSingleCompany = (s: Pick<BoardSettings, 'boardMode' | 'ownerCompanyId'>) =>
  s.boardMode === 'single_company' && s.ownerCompanyId !== null;
