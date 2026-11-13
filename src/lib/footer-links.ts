/**
 * BROWSER: the board's footer links on a PRERENDERED page (built without the board settings).
 * Rendered pages already carry them. DOM built with `textContent` only; hrefs re-checked
 * (a site path or an https URL).
 *
 * The settings (`GET /site-api/board/settings`, public) are read ONCE per visit and kept in memory
 * across client navigations (like `/me` in account-fill.ts); a failed read is tried again on the
 * next page. Once known, the layout fills the links in on `astro:after-swap`, before the new page
 * is painted, so the footer does not move.
 */
import {siteFetch} from '../platform/browser';
import {isFooterHref} from './types-manage';
import type {PublicBoard} from './types-public';

let pending: Promise<PublicBoard | null> | null = null;
/** The answer once it has arrived (`undefined` until then): used synchronously after a swap. */
let known: PublicBoard | undefined;

/** The board's public settings, one read per visit. `null` when they could not be read. */
export const boardSettings = (): Promise<PublicBoard | null> =>
  (pending ??= siteFetch('/site-api/board/settings', {headers: {accept: 'application/json'}})
    .then(res => (res.ok ? (res.json() as Promise<{board: PublicBoard}>) : null))
    .then(answer => answer?.board ?? null)
    .catch(() => null)
    .then(board => {
      if (board) known = board;
      else pending = null; // not kept: try again next page
      return board;
    }));

export async function hydrateFooterLinks(): Promise<void> {
  const list = document.querySelector<HTMLElement>('[data-footer-links][data-hydrate="1"]');
  if (!list) return;
  list.removeAttribute('data-hydrate');
  // Known already: no `await`, so the links go in synchronously (right after the swap, before paint).
  const board = known ?? (await boardSettings());
  if (!board?.footerLinks.length) return;
  const items = board.footerLinks
    .filter(link => isFooterHref(link.href))
    .map(link => {
      const li = document.createElement('li');
      li.dataset.boardLink = '';
      const a = document.createElement('a');
      a.href = link.href;
      if (!link.href.startsWith('/')) a.rel = 'noopener noreferrer';
      a.textContent = link.label;
      li.append(a);
      return li;
    });
  list.prepend(...items);
}
