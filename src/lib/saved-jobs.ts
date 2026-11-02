/**
 * F6 saved jobs: slugs in this browser's localStorage (candidates have no accounts). BROWSER ONLY.
 * Every read and write is guarded: blocked storage means nothing is saved, never an error.
 */

export const SAVED_JOBS_KEY = 'board:saved-jobs:v1';
export const MAX_SAVED_JOBS = 100;
const SLUG = /^[a-z0-9-]{1,120}$/;

export interface SavedEntry {
  slug: string;
  savedAt: string;
}

/** The stored entries (newest first), ignoring anything malformed. */
export function parseSaved(raw: string | null): SavedEntry[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((e): e is SavedEntry => typeof e?.slug === 'string' && SLUG.test(e.slug) && typeof e.savedAt === 'string')
      .slice(0, MAX_SAVED_JOBS);
  } catch {
    return [];
  }
}

export function readSaved(): SavedEntry[] {
  try {
    return parseSaved(window.localStorage.getItem(SAVED_JOBS_KEY));
  } catch {
    return [];
  }
}

/** Fired on `window` after every save / unsave in this tab (other tabs get the `storage` event). */
export const SAVED_JOBS_EVENT = 'board:saved-jobs-change';

function writeSaved(entries: SavedEntry[]): boolean {
  try {
    window.localStorage.setItem(SAVED_JOBS_KEY, JSON.stringify(entries.slice(0, MAX_SAVED_JOBS)));
    window.dispatchEvent(new Event(SAVED_JOBS_EVENT));
    return true;
  } catch {
    return false;
  }
}

export const isSaved = (slug: string) => readSaved().some(e => e.slug === slug);

/** Adds (newest first) or removes `slug`; answers the new state, or null when storage is blocked. */
export function toggleSaved(slug: string): boolean | null {
  if (!SLUG.test(slug)) return null;
  const entries = readSaved();
  const saved = entries.some(e => e.slug === slug);
  const next = saved ? entries.filter(e => e.slug !== slug) : [{slug, savedAt: new Date().toISOString()}, ...entries];
  return writeSaved(next) ? !saved : null;
}

export function removeSaved(slug: string): void {
  writeSaved(readSaved().filter(e => e.slug !== slug));
}
