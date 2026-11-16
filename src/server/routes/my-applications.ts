import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {type ApplicationStatus, LIMITS} from '../../lib/board';
import type {MyApplicationRow} from '../../lib/types-apply';
import type {Viewer} from '../../lib/types';
import {requireAuth, requireVerified, withDb, withViewer} from '../../platform/guards';
import {idOf, isResumeExpired} from '../board/applicants';

/**
 * The candidate's own applications (mounted at `/site-api/my-applications`).
 *
 *   GET /    the signed-in user's applications, newest first (keyset page, `?before=<id>`)
 *
 * Applying needs no account, so an application belongs to whoever owns its EMAIL: only a signed-in
 * user with a CONFIRMED email sees the ones sent with that address (`requireVerified`), and the
 * email comes from the session, never from the request. Read only: the employer or the admin
 * decides the status. The employer's private notes are never selected.
 */
type Env = {Variables: {viewer: Viewer; db: PrismaClient}};
const PAGE = LIMITS.pageSize;

const listQuery = validator('query', v => ({before: idOf(typeof v.before === 'string' ? v.before : undefined)}));

const select = {
  id: true,
  status: true,
  createdAt: true,
  name: true,
  phone: true,
  profileUrl: true,
  coverNote: true,
  resumeFileName: true,
  job: {select: {title: true, slug: true, status: true, company: {select: {name: true}}}},
} as const;

export const myApplicationRoutes = new Hono<Env>().get('/', listQuery, withViewer, requireAuth, requireVerified, withDb, async c => {
  c.header('Cache-Control', 'private, no-store');
  // The site's owner signs in from the dashboard with no address here: nothing of theirs to match.
  const email = c.var.viewer.email?.trim().toLowerCase();
  if (!email) return c.json({items: [], nextBefore: null});
  const {before} = c.req.valid('query');
  // ONE query on the (email, id) index, the job and company joined in.
  const rows = await c.var.db.application.findMany({
    where: {email, ...(before ? {id: {lt: before}} : {})},
    select,
    orderBy: {id: 'desc'},
    take: PAGE + 1,
  });
  const now = new Date();
  const items: MyApplicationRow[] = rows.slice(0, PAGE).map(r => ({
    id: r.id,
    status: r.status as ApplicationStatus,
    appliedAt: r.createdAt.toISOString(),
    name: r.name,
    phone: r.phone,
    profileUrl: r.profileUrl,
    coverNote: r.coverNote,
    resumeFileName: isResumeExpired(r.createdAt, now) ? null : r.resumeFileName,
    job: {title: r.job.title, company: r.job.company.name, slug: r.job.status === 'published' ? r.job.slug : null},
  }));
  return c.json({items, nextBefore: rows.length > PAGE ? items.at(-1)!.id : null});
});
