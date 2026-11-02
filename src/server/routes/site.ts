import {Hono} from 'hono';

import type {Site} from '../../lib/types';
import {publicGet} from '../../platform/api';
import {getDb} from '../../platform/db';
import {cachedBoardSettings} from '../board/brand';
import {safeUrl} from '../board/public-shapes';

/**
 * `GET /site-api/site` — the site's brand: name, logo, favicon, read from the
 * platform's public API (`/api/public/site/v1/initial-data`, cached 60 s per
 * isolate). Re-projected field by field.
 *
 * The job board's branding (F30, `board_settings`) wins: its name, and its logo when one is
 * uploaded. So every page, the prerendered ones' hydration and the portal show the board's brand.
 */
export const siteRoutes = new Hono().get('/', async c => {
  const db = getDb();
  const [raw, board] = await Promise.all([
    publicGet<Record<string, unknown>>(c.req.url, '/site/v1/initial-data', {ttlSeconds: 60}).catch(() => null),
    db ? cachedBoardSettings(db).catch(() => null) : null,
  ]);
  const platform: Site | null = raw
    ? {
        id: Number(raw.id),
        name: String(raw.name ?? '') || 'My site',
        favIcon: (raw.favIcon as string | null) ?? null,
        logo: (raw.logo as string | null) ?? null,
      }
    : null;
  const site: Site | null = board
    ? {
        id: platform?.id ?? 0,
        name: board.name || platform?.name || 'My site',
        favIcon: safeUrl(board.faviconUrl) ?? platform?.favIcon ?? null,
        logo: safeUrl(board.logoUrl) ?? platform?.logo ?? null,
      }
    : platform;
  return c.json({site});
});
