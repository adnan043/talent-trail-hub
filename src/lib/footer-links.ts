/**
 * BROWSER: the board's footer links on a PRERENDERED page (built without the board settings).
 * Rendered pages already carry them. DOM built with `textContent` only; hrefs re-checked
 * (a site path or an https URL).
 */
import {siteFetch} from '../platform/browser';
import {isFooterHref} from './types-manage';
import type {PublicBoard} from './types-public';


export async function hydrateFooterLinks(): Promise<void> {
  const list = document.querySelector<HTMLElement>('[data-footer-links][data-hydrate="1"]');
  if (!list) return;
  list.removeAttribute('data-hydrate');
  let board: PublicBoard | null = null;
  try {
    const res = await siteFetch('/site-api/board/settings', {headers: {accept: 'application/json'}});
    board = res.ok ? ((await res.json()) as {board: PublicBoard}).board : null;
  } catch {
    board = null;
  }
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
