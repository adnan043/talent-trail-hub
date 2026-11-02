import type {Prisma} from '../../generated/prisma/client';
import {type BoardSettings, isSingleCompany} from './settings';

/**
 * THE rule for what the public sees: published, not past `expiresAt` (checked here, so a late
 * expiry run never leaks a job), company not blocked, and in single-company mode only the owner
 * company's jobs. Every public read of jobs (lists, detail, sitemap, home, companies) uses it.
 */
export function publicJobWhere(settings: BoardSettings, now = new Date()): Prisma.JobWhereInput {
  return {
    status: 'published',
    expiresAt: {gt: now},
    company: {isBlocked: false},
    ...(isSingleCompany(settings) ? {companyId: settings.ownerCompanyId!} : {}),
  };
}

/** A job counts as featured while `isFeatured` and `featuredUntil` is unset or in the future. */
export function featuredWhere(now = new Date()): Prisma.JobWhereInput {
  return {isFeatured: true, OR: [{featuredUntil: null}, {featuredUntil: {gt: now}}]};
}
