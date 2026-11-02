/**
 * BROWSER: a menu button (the header's theme and account menus), WAI-ARIA menu pattern.
 *
 * Markup: a `[data-menu]` root holding a `<button data-menu-trigger aria-haspopup="menu"
 * aria-expanded="false" aria-controls="<id>">` and `<div id="<id>" role="menu" data-menu-list
 * hidden>` with `role="menuitem"` / `"menuitemradio"` items. Click or ArrowDown/ArrowUp opens;
 * arrows, Home and End move; Esc closes and returns focus; Tab, a click outside or choosing an
 * item closes. No inline handlers (CSP): call `bindMenus()` on `astro:page-load`.
 */

const items = (list: HTMLElement) =>
  [...list.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')].filter(
    // Skips disabled items and hidden ones (`hidden`, single-company mode's `[data-marketplace-only]`).
    el => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0
  );

const parts = (root: HTMLElement) => ({
  trigger: root.querySelector<HTMLButtonElement>('[data-menu-trigger]'),
  list: root.querySelector<HTMLElement>('[data-menu-list]'),
});

function closeMenu(root: HTMLElement, restoreFocus: boolean): void {
  const {trigger, list} = parts(root);
  if (!trigger || !list || list.hidden) return;
  list.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  delete root.dataset.open;
  if (restoreFocus) trigger.focus();
}

function openMenu(root: HTMLElement, focus: 'first' | 'last' | 'current'): void {
  const {trigger, list} = parts(root);
  if (!trigger || !list) return;
  document.querySelectorAll<HTMLElement>('[data-menu][data-open]').forEach(other => other !== root && closeMenu(other, false));
  list.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  root.dataset.open = '';
  const all = items(list);
  const checked = all.find(el => el.getAttribute('aria-checked') === 'true');
  (focus === 'last' ? all.at(-1) : focus === 'current' ? (checked ?? all[0]) : all[0])?.focus();
}

function bindMenu(root: HTMLElement): void {
  const {trigger, list} = parts(root);
  if (!trigger || !list || root.dataset.bound) return;
  root.dataset.bound = '1';

  trigger.addEventListener('click', () => (list.hidden ? openMenu(root, 'current') : closeMenu(root, false)));
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(root, event.key === 'ArrowDown' ? 'first' : 'last');
    }
  });
  list.addEventListener('keydown', event => {
    const all = items(list);
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => all[(index + all.length) % all.length]?.focus();
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(all.length - 1);
    else if (event.key === 'Escape') closeMenu(root, true);
    else if (event.key === 'Tab') return closeMenu(root, false);
    else return;
    event.preventDefault();
  });
  // Choosing an item closes the menu (its own click handler runs first). A pending Sign out
  // keeps it open so the busy state shows.
  list.addEventListener('click', event => {
    const item = (event.target as HTMLElement).closest('[role="menuitem"], [role="menuitemradio"]');
    if (item && !item.hasAttribute('data-logout')) closeMenu(root, item.getAttribute('role') === 'menuitemradio');
  });
}

/** Binds every menu on the page (once each). */
export function bindMenus(): void {
  document.querySelectorAll<HTMLElement>('[data-menu]').forEach(bindMenu);
}

// Once for the document: a click or tap outside closes any open menu.
document.addEventListener('pointerdown', event => {
  document.querySelectorAll<HTMLElement>('[data-menu][data-open]').forEach(root => {
    if (!root.contains(event.target as Node)) closeMenu(root, false);
  });
});
