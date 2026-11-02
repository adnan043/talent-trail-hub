/**
 * The theme before first paint: a tiny inline <head> script that applies the visitor's saved
 * theme (`site:theme`, the portal's key) as `data-theme` on <html>. It is the only inline script:
 * a FIXED string (no data in it) whose hash the layouts add to the page's CSP with
 * `Astro.csp.insertScriptHash(THEME_BOOT_HASH)`. `tests/json-ld.test.ts` checks the hash matches.
 * Edit both together (`node -e` with crypto.createHash('sha256') … digest('base64')).
 */
export const THEME_BOOT =
  'try{var t=localStorage.getItem("site:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}';

export const THEME_BOOT_HASH = 'sha256-neDx99kUz8hlMNAKAt/HQa5mQpBj5BBpUfUeuIImseA=' as const;
