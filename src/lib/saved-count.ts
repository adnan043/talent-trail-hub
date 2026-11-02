/**
 * BROWSER: the saved-jobs count on the "Saved jobs" nav links (header and mobile menu), from this
 * browser's saved list (src/lib/saved-jobs.ts). Hidden at 0; the link's name says the number
 * ("Saved jobs, 3 saved"). Updated on save / unsave in this tab and in other tabs.
 */
import {readSaved, SAVED_JOBS_EVENT, SAVED_JOBS_KEY} from './saved-jobs';

export function showSavedCount(): void {
  const count = readSaved().length;
  document.querySelectorAll<HTMLElement>('[data-saved-count]').forEach(badge => {
    badge.textContent = count ? String(count) : '';
    badge.hidden = count === 0;
    const link = badge.closest('a');
    if (!link) return;
    const label =
      [...link.childNodes]
        .filter(node => node !== badge)
        .map(node => node.textContent ?? '')
        .join('')
        .trim() || 'Saved jobs';
    if (count) link.setAttribute('aria-label', `${label}, ${count} saved`);
    else link.removeAttribute('aria-label');
  });
}

// Once for the document.
window.addEventListener(SAVED_JOBS_EVENT, showSavedCount);
window.addEventListener('storage', event => {
  if (event.key === SAVED_JOBS_KEY || event.key === null) showSavedCount();
});
