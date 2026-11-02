import {createMiddleware} from 'hono/factory';

import type {PrismaClient} from '../../generated/prisma/client';
import {LIMITS} from '../../lib/board';
import {htmlToMarkdown, renderMarkdown} from '../../lib/markdown';
import {type CompanySocials, type EmployerCompany, type NewCompanyValues, SOCIAL_KEYS} from '../../lib/types-employer';
import type {Viewer} from '../../lib/types';
import {problem} from '../../platform/guards';
import {cachedBoardSettings} from './brand';
import {isSingleCompany} from './settings';

/**
 * The employer area's company side (F17). An employer is any signed-in, verified user; their
 * company is the ONE row with `owner_user_id` = their id, always looked up from the session,
 * never from an id in the request. The whole area is 404 in single-company mode (F39).
 */

/** After `withDb`: the employer area does not exist on a single-company board. */
export const employerArea = createMiddleware<{Variables: {db: PrismaClient; viewer: Viewer}}>(async (c, next) => {
  if (isSingleCompany(await cachedBoardSettings(c.var.db))) return c.json(problem('not_found', 'No such Site API route.'), 404);
  await next();
});

export const companySelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  logoFileId: true,
  website: true,
  location: true,
  aboutHtml: true,
  socials: true,
  isBlocked: true,
  isTrusted: true,
} as const;

type CompanyRow = {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  website: string | null;
  location: string | null;
  aboutHtml: string | null;
  socials: unknown;
  isBlocked: boolean;
};

export const ownCompany = (db: PrismaClient, userId: number) =>
  db.company.findUnique({where: {ownerUserId: userId}, select: companySelect});

export function socialsOf(value: unknown): CompanySocials {
  const stored = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const get = (key: string) => (typeof stored[key] === 'string' ? (stored[key] as string) : '');
  return {linkedin: get('linkedin'), x: get('x') || get('twitter'), github: get('github'), instagram: get('instagram')};
}

export function toEmployerCompany(row: CompanyRow): EmployerCompany {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logoUrl,
    website: row.website ?? '',
    location: row.location ?? '',
    about: row.aboutHtml ? htmlToMarkdown(row.aboutHtml) : '',
    aboutHtml: row.aboutHtml ?? '',
    socials: socialsOf(row.socials),
    isBlocked: row.isBlocked,
  };
}

const HTTPS = /^https:\/\/[^\s/]+\.[^\s]+$/i;

/** The editable profile fields (name excluded: it is the company's URL and never changes). */
export interface CompanyProfile {
  website: string | null;
  location: string | null;
  about: string;
  socials: Partial<CompanySocials>;
}

/** Website, location, about, socials: checked field by field. Returns the fields' errors, or the values. */
export function readCompanyProfile(raw: unknown): {fields: Record<string, string>} | {value: CompanyProfile} {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const text = (key: string, max: number) => (typeof v[key] === 'string' ? (v[key] as string).trim().slice(0, max + 1) : '');
  const fields: Record<string, string> = {};
  const website = text('website', 300);
  if (website && !HTTPS.test(website)) fields.website = 'Enter the full link, starting with https://';
  else if (website.length > 300) fields.website = 'Keep the link to 300 characters.';
  const location = text('location', 80);
  if (location.length > 80) fields.location = 'Keep the location to 80 characters.';
  const about = text('about', LIMITS.companyAbout);
  if (about.length > LIMITS.companyAbout) fields.about = `Keep it to ${LIMITS.companyAbout} characters.`;
  const rawSocials = v.socials && typeof v.socials === 'object' ? (v.socials as Record<string, unknown>) : {};
  const socials: Partial<CompanySocials> = {};
  for (const key of SOCIAL_KEYS) {
    const value = typeof rawSocials[key] === 'string' ? (rawSocials[key] as string).trim() : '';
    if (!value) continue;
    if (value.length > 300 || !HTTPS.test(value)) fields[`socials.${key}`] = 'Enter the full link, starting with https://';
    else socials[key] = value;
  }
  if (Object.keys(fields).length) return {fields};
  return {value: {website: website || null, location: location || null, about, socials}};
}

/** The wizard's company step (first post): name + the profile. */
export function readNewCompany(raw: unknown): {fields: Record<string, string>} | {value: CompanyProfile & {name: string}} {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<NewCompanyValues>;
  const name = typeof v.companyName === 'string' ? v.companyName.trim() : '';
  const profile = readCompanyProfile({website: v.website, location: v.location, about: v.about});
  const fields = 'fields' in profile ? {...profile.fields} : {};
  if (name.length < 2) fields.companyName = 'Add the company name (at least 2 characters).';
  else if (name.length > LIMITS.companyName) fields.companyName = `Keep the name to ${LIMITS.companyName} characters.`;
  if (Object.keys(fields).length || 'fields' in profile) return {fields};
  return {value: {...profile.value, name}};
}

/** The profile as columns: the about text rendered and sanitized like a job description. */
export const profileColumns = (p: CompanyProfile) => ({
  website: p.website,
  location: p.location,
  aboutHtml: p.about ? renderMarkdown(p.about) || null : null,
  socials: p.socials,
});

/** Which profile fields an update changes (names only: what the audit log records). */
export function changedFields(row: CompanyRow, next: ReturnType<typeof profileColumns>): string[] {
  const changed: string[] = [];
  if ((row.website ?? null) !== next.website) changed.push('website');
  if ((row.location ?? null) !== next.location) changed.push('location');
  if ((row.aboutHtml ?? null) !== next.aboutHtml) changed.push('about');
  const before = socialsOf(row.socials);
  for (const key of SOCIAL_KEYS) if ((before[key] || '') !== (next.socials[key] ?? '')) changed.push(`socials.${key}`);
  return changed;
}

/**
 * Keeps `companies.active_job_count` (published, unexpired jobs: the companies directory) in
 * step after a job of the company changes. One bounded count over the company's own jobs.
 */
export async function refreshActiveJobCount(db: PrismaClient, companyId: number, now = new Date()): Promise<void> {
  const active = await db.job.count({where: {companyId, status: 'published', expiresAt: {gt: now}}});
  await db.company.update({where: {id: companyId}, data: {activeJobCount: active}, select: {id: true}});
}
