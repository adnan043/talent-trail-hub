import type {Prisma, PrismaClient} from '../../generated/prisma/client';
import {LIMITS, type SalaryPeriod} from '../../lib/board';
import {countryCodesMatching} from '../../lib/job-display';
import {type JobSearch, POSTED_WITHIN} from '../../lib/job-search';
import type {BoardSettings} from './settings';
import {featuredWhere, publicJobWhere} from './public';

/**
 * F2 search on top of `publicJobWhere`: the filters, the keyset cursor (no offsets) and the
 * featured pin cap (≤ LIMITS.featuredPinCap featured matches pinned on page 1, rotated per UTC hour).
 */

const insensitive = (value: string) => ({contains: value, mode: 'insensitive' as const});
const MAX_TERMS = 5;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Featured candidates the rotation picks from: far above any real board's featured count. */
const PIN_CANDIDATES = 200;

/** Paid periods per year, to compare any salary with a yearly minimum. */
export const PERIODS_PER_YEAR: Record<SalaryPeriod, number> = {YEAR: 1, MONTH: 12, WEEK: 52, DAY: 260, HOUR: 2080};

/** Every keyword term matches the title, the company, a tag or the description. */
function keywordWhere(q: string): Prisma.JobWhereInput[] {
  const terms = [...new Set(q.toLowerCase().split(' ').filter(Boolean))].slice(0, MAX_TERMS);
  return terms.map(term => ({
    OR: [
      {title: insensitive(term)},
      {company: {name: insensitive(term)}},
      {tags: {some: {tag: {name: insensitive(term)}}}},
      {descriptionMd: insensitive(term)},
    ],
  }));
}

function locationWhere(location: string): Prisma.JobWhereInput {
  if (/^remote$/i.test(location)) return {workplaceType: 'remote'};
  const codes = countryCodesMatching(location);
  return {
    OR: [{locationCity: insensitive(location)}, {locationRegion: insensitive(location)}, ...(codes.length ? [{locationCountry: {in: codes}}] : [])],
  };
}

/** Paying at least `yearly` whole units of `currency` a year; other currencies are left out. */
export function minSalaryWhere(yearly: number, currency: string): Prisma.JobWhereInput {
  return {
    salaryCurrency: currency,
    OR: (Object.entries(PERIODS_PER_YEAR) as [SalaryPeriod, number][]).map(([period, perYear]) => {
      const cents = Math.ceil((yearly * 100) / perYear);
      return {salaryPeriod: period, OR: [{salaryMaxCents: {gte: cents}}, {salaryMaxCents: null, salaryMinCents: {gte: cents}}]};
    }),
  };
}

/** Every filter of `s` (not the cursor), on top of the public rule. */
export function searchWhere(s: JobSearch, settings: BoardSettings, now: Date): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = [publicJobWhere(settings, now)];
  if (s.featured) and.push(featuredWhere(now));
  if (s.q) and.push(...keywordWhere(s.q));
  if (s.category) and.push({category: {slug: s.category, isActive: true}});
  if (s.types.length) and.push({employmentType: {in: s.types}});
  if (s.workplaces.length) and.push({workplaceType: {in: s.workplaces}});
  if (s.location) and.push(locationWhere(s.location));
  if (s.minSalary) and.push(minSalaryWhere(s.minSalary, settings.currency));
  if (s.posted) {
    const days = POSTED_WITHIN.find(p => p.value === s.posted)!.days;
    and.push({publishedAt: {gte: new Date(now.getTime() - days * DAY_MS)}});
  }
  return {AND: and};
}

export const NEWEST: Prisma.JobOrderByWithRelationInput[] = [{publishedAt: 'desc'}, {id: 'desc'}];
const SALARY: Prisma.JobOrderByWithRelationInput[] = [{salaryMaxCents: {sort: 'desc', nulls: 'last'}}, {id: 'desc'}];

export const orderFor = (sort: JobSearch['sort']) => (sort === 'salary' ? SALARY : NEWEST);

interface CursorRow {
  id: number;
  publishedAt: Date | null;
  salaryMaxCents: number | null;
}

/**
 * `n<publishedAt ms>_<id>` (newest) or `s<max cents | x>_<id>` (salary), plus `_h<UTC hour>`: the
 * pin rotation's hour of page 1, so later pages leave out the SAME pinned jobs across the hour.
 */
export function encodeCursor(sort: JobSearch['sort'], row: CursorRow, hour: number): string {
  const key = sort === 'salary' ? `s${row.salaryMaxCents ?? 'x'}_${row.id}` : `n${row.publishedAt?.getTime() ?? 0}_${row.id}`;
  return `${key}_h${hour}`;
}

/** The UTC hour the pins of `now` are chosen by. */
export const pinHour = (now: Date) => Math.floor(now.getTime() / HOUR_MS);

/** The pin hour a cursor carries (null without one). */
export function cursorHour(cursor: string): number | null {
  const m = /_h(\d{1,9})$/.exec(cursor);
  return m ? Number(m[1]) : null;
}

/** The rows after the cursor in that sort's order; null when the cursor is not valid. */
export function cursorWhere(sort: JobSearch['sort'], cursor: string): Prisma.JobWhereInput | null {
  const m = /^([ns])(\d+|x)_(\d+)(?:_h\d{1,9})?$/.exec(cursor);
  if (!m || (m[1] === 'n') !== (sort === 'newest')) return null;
  const id = Number(m[3]);
  if (m[1] === 'n') {
    if (m[2] === 'x') return null;
    const at = new Date(Number(m[2]));
    return {OR: [{publishedAt: {lt: at}}, {publishedAt: at, id: {lt: id}}]};
  }
  if (m[2] === 'x') return {salaryMaxCents: null, id: {lt: id}};
  const cents = Number(m[2]);
  return {OR: [{salaryMaxCents: {lt: cents}}, {salaryMaxCents: cents, id: {lt: id}}, {salaryMaxCents: null}]};
}

/** FNV-1a, 32 bit: small and the same on every runtime. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * The featured ids pinned this UTC hour: a shuffle seeded by the hour, so each featured job gets
 * its turn and every render within the hour agrees. Input order does not matter.
 */
export function pickPinned(ids: readonly number[], now: Date, limit: number = LIMITS.featuredPinCap): number[] {
  const seed = pinHour(now);
  return ids
    .map(id => ({id, key: hash32(`${seed}:${id}`)}))
    .sort((a, b) => a.key - b.key || a.id - b.id)
    .slice(0, limit)
    .map(x => x.id);
}

/** The pinned ids among the featured jobs matching `where`. */
export async function pinnedIds(db: PrismaClient, where: Prisma.JobWhereInput, now: Date, seedAt: Date = now): Promise<number[]> {
  const rows = await db.job.findMany({where: {AND: [where, featuredWhere(now)]}, orderBy: {id: 'asc'}, take: PIN_CANDIDATES, select: {id: true}});
  return pickPinned(
    rows.map(r => r.id),
    seedAt
  );
}

/** Featured jobs counted up to this many; more reads "100+" (never an unbounded count). */
export const FEATURED_COUNT_CAP = 100;

/** Featured jobs on the whole board, capped (one small bounded read of ids). */
export async function featuredCount(db: PrismaClient, settings: BoardSettings, now: Date): Promise<number> {
  const rows = await db.job.findMany({
    where: {AND: [publicJobWhere(settings, now), featuredWhere(now)]},
    take: FEATURED_COUNT_CAP,
    select: {id: true},
  });
  return rows.length;
}

/** "See all 12 featured jobs" / "See all 100+ featured jobs". */
export const moreFeatured = (count: number) => count > LIMITS.featuredPinCap;
