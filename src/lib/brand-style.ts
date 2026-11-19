/**
 * The board's brand stylesheet (`brandCss`, src/server/board/brand.ts) INLINE on rendered pages.
 *
 * A rendered board page already has the board settings (`boardPage()`), so `Base.astro` writes the
 * brand as a `<style data-brand-style>` element and adds its hash to the page's CSP, instead of a
 * `<link>` to `/site-api/board/brand.css` that every page would wait on (a render-blocking Worker
 * request). Prerendered pages know no settings: they keep the link.
 *
 * The CSP is a `<meta>` per page, and with the ClientRouter the FIRST page's policy stays in force for
 * the whole visit (a later page's policy can only add to it). A prerendered first page allows no
 * brand hash, so an inline brand style arriving by client navigation would be blocked.
 * `keepBrandStyleAllowed()` (browser, once per visit) swaps such a style for the stylesheet link
 * before the swap. Only an identical style already on the page is kept as it is: it has been in
 * every page's policy since the first load.
 */

/** The stylesheet prerendered pages link (and client navigations fall back to). */
export const BRAND_CSS_HREF = '/site-api/board/brand.css';
/** The same without the brand colours, for a page with its own palette (`data-brand-plain`: the home page). */
export const BRAND_CSS_PLAIN_HREF = `${BRAND_CSS_HREF}?colours=0`;

/** Loads a stylesheet before it is put on the page (no flash of the default colours). */
const preloadStyle = (href: string) =>
  new Promise<void>(resolve => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'style';
    link.href = href;
    const done = () => {
      link.remove();
      resolve();
    };
    link.addEventListener('load', done);
    link.addEventListener('error', done);
    document.head.append(link);
  });

type Preparation = Event & {loader: () => Promise<void>; newDocument: Document};

/** BROWSER, once per visit (Base.astro): see the module comment. */
export function keepBrandStyleAllowed(): void {
  document.addEventListener('astro:before-preparation', event => {
    const prep = event as Preparation;
    const load = prep.loader;
    prep.loader = async () => {
      await load();
      const incoming = prep.newDocument?.head.querySelector('style[data-brand-style]');
      if (!incoming) return;
      const current = document.head.querySelector('style[data-brand-style]');
      if (current && current.textContent === incoming.textContent) return; // kept by the router as it is
      const href = incoming.hasAttribute('data-brand-plain') ? BRAND_CSS_PLAIN_HREF : BRAND_CSS_HREF;
      const link = prep.newDocument.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.brandStyle = '';
      incoming.replaceWith(link);
      if (!document.head.querySelector(`link[rel="stylesheet"][href="${href}"]`)) await preloadStyle(href);
    };
  });
}
