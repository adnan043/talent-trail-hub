import type {PublicBoard} from '../../lib/types-public';
import {backend, read} from '../backend';
import {pageContext} from '../page';

/**
 * What every on-demand PUBLIC board page needs: `pageContext` (brand, visitor) and the board's
 * public settings (`GET /site-api/board/settings`), read in parallel. `board` is null when the
 * Site Database cannot be read: pages then render their "not available" fallback.
 */
export async function boardPage(request: Request, response: {headers: Headers}) {
  const [ctx, settings] = await Promise.all([
    pageContext(request, response),
    read<{board: PublicBoard}>(backend(request).board.settings.$get()),
  ]);
  return {...ctx, board: settings?.board ?? null};
}

