/**
 * F2 search parameters, shared by the `/jobs/` page (its GET form and URL), the in-process API
 * call and the `GET /site-api/jobs` validator, so the URL, the request and the query agree.
 * Never throws: invalid values are dropped. Browser-safe.
 */
import {EMPLOYMENT_TYPES, type EmploymentType, WORKPLACE_TYPES, type WorkplaceType} from './board';

export const POSTED_WITHIN = [
  {value: '1d', label: 'Last 24 hours', days: 1},
  {value: '7d', label: 'Last 7 days', days: 7},
  {value: '30d', label: 'Last 30 days', days: 30},
] as const;
export type PostedWithin = (typeof POSTED_WITHIN)[number]['value'];

export const JOB_SORTS = [
  {value: 'newest', label: 'Newest first'},
  {value: 'salary', label: 'Highest salary'},
] as const;
export type JobSort = (typeof JOB_SORTS)[number]['value'];

/** Yearly minimum salary choices, in whole units of the board currency. */
export const MIN_SALARY_OPTIONS = [30_000, 50_000, 75_000, 100_000, 150_000] as const;

export interface JobSearch {
  q: string;
  category: string;
  types: EmploymentType[];
  workplaces: WorkplaceType[];
  location: string;
  minSalary: number | null;
  posted: PostedWithin | null;
  sort: JobSort;
  /** `?featured=1`: only featured jobs, none pinned (noindex). */
  featured: boolean;
  /** Keyset cursor (`before`), '' on page 1. */
  before: string;
}

const MAX_TEXT = 100;

const text = (value: unknown, max = MAX_TEXT): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

function list<V extends string>(value: unknown, allowed: readonly V[]): V[] {
  const raw = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '';
  const picked = new Set(raw.slice(0, 200).split(','));
  // The canonical order, so equivalent URLs are identical.
  return allowed.filter(v => picked.has(v));
}

type Raw = Record<string, string | string[] | undefined>;

/** From a URL's search params (repeated checkbox keys allowed) or an API query. */
export function parseJobSearch(input: URLSearchParams | Raw): JobSearch {
  const raw: Raw =
    input instanceof URLSearchParams
      ? Object.fromEntries([...new Set(input.keys())].map(key => [key, input.getAll(key)]))
      : input;
  const one = (key: string) => {
    const v = raw[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const category = text(one('category'), 60);
  const minSalary = Number(one('minSalary'));
  const posted = POSTED_WITHIN.find(p => p.value === one('posted'))?.value ?? null;
  const before = text(one('before'), 40);
  return {
    q: text(one('q')),
    category: /^[a-z0-9-]+$/.test(category) ? category : '',
    types: list(raw.type, EMPLOYMENT_TYPES),
    workplaces: list(raw.workplace, WORKPLACE_TYPES),
    location: text(one('location'), 80),
    minSalary: Number.isInteger(minSalary) && minSalary > 0 && minSalary <= 10_000_000 ? minSalary : null,
    posted,
    sort: one('sort') === 'salary' ? 'salary' : 'newest',
    featured: one('featured') === '1',
    before: /^[0-9a-z_-]+$/i.test(before) ? before : '',
  };
}

/** The flat query the API takes (every key present: the typed client needs them). */
export function toApiQuery(s: JobSearch): Record<'q' | 'category' | 'type' | 'workplace' | 'location' | 'minSalary' | 'posted' | 'sort' | 'featured' | 'before', string> {
  return {
    q: s.q,
    category: s.category,
    type: s.types.join(','),
    workplace: s.workplaces.join(','),
    location: s.location,
    minSalary: s.minSalary ? String(s.minSalary) : '',
    posted: s.posted ?? '',
    sort: s.sort === 'newest' ? '' : s.sort,
    featured: s.featured ? '1' : '',
    before: s.before,
  };
}

/** The page URL for a search (defaults left out; repeated keys for the lists, like the form sends). */
export function jobSearchHref(s: JobSearch, overrides: Partial<JobSearch> = {}): string {
  const v = {...s, ...overrides};
  const qs = new URLSearchParams();
  if (v.q) qs.set('q', v.q);
  if (v.category) qs.set('category', v.category);
  for (const t of v.types) qs.append('type', t);
  for (const w of v.workplaces) qs.append('workplace', w);
  if (v.location) qs.set('location', v.location);
  if (v.minSalary) qs.set('minSalary', String(v.minSalary));
  if (v.posted) qs.set('posted', v.posted);
  if (v.sort !== 'newest') qs.set('sort', v.sort);
  if (v.featured) qs.set('featured', '1');
  if (v.before) qs.set('before', v.before);
  const query = qs.toString();
  return query ? `/jobs/?${query}` : '/jobs/';
}

/** Keyword, a filter or a sort set: such pages are `noindex,follow` (F34). Paging alone is not. */
export const isFilteredSearch = (s: JobSearch) =>
  Boolean(s.q || s.category || s.types.length || s.workplaces.length || s.location || s.minSalary || s.posted || s.sort !== 'newest' || s.featured);

/** Active filters other than keyword and sort (the "Filters (n)" count). */
export const activeFilterCount = (s: JobSearch) =>
  (s.category ? 1 : 0) + s.types.length + s.workplaces.length + (s.location ? 1 : 0) + (s.minSalary ? 1 : 0) + (s.posted ? 1 : 0);
