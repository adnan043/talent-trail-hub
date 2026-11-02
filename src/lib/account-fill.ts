/**
 * BROWSER: fills the header's account menu and the mobile menu for a signed-in visitor: the email
 * (prerendered pages know no visitor) and the Admin item (`[data-account-admin]`, shown only when
 * `/site-api/me` grants an admin ability). `textContent` only. One `/me` read per page load,
 * kept in memory across client navigations (a sign-out reloads the page).
 */
import {siteFetch} from '../platform/browser';
import type {Abilities, Viewer} from './types';

type Me = {viewer: Viewer; abilities?: Partial<Abilities>};

let me: Promise<Me | null> | null = null;

const readMe = (): Promise<Me | null> =>
  (me ??= siteFetch('/site-api/me', {headers: {accept: 'application/json'}})
    .then(res => (res.ok ? (res.json() as Promise<Me>) : null))
    .catch(() => null)
    .then(answer => {
      if (!answer || answer.viewer.state !== 'user') me = null; // not cached: try again next page
      return answer;
    }));

export async function fillAccount(): Promise<void> {
  if (document.body.dataset.viewer !== 'user' || !document.querySelector('[data-account-initial]')) return;
  const answer = await readMe();
  if (answer?.viewer.state !== 'user') return;
  const email = answer.viewer.email ?? answer.viewer.name ?? '';
  if (email) {
    document.querySelectorAll<HTMLElement>('[data-account-initial]').forEach(el => (el.textContent = email.charAt(0).toUpperCase()));
    document.querySelectorAll<HTMLElement>('[data-account-email]').forEach(el => (el.textContent = email));
  }
  const admin = Boolean(answer.abilities?.manageJobs || answer.abilities?.moderateJobs);
  document.querySelectorAll<HTMLElement>('[data-account-admin]').forEach(el => (el.hidden = !admin));
}
