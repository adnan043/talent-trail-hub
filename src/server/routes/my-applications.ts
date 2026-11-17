import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {APPLICATION_STATUSES, type ApplicationStatus, LIMITS} from '../../lib/board';
import type {MyApplicationRow} from '../../lib/types-apply';
import type {Viewer} from '../../lib/types';
import {requireAuth, requireVerified, withDb, withViewer} from '../../platform/guards';
import {idOf, isResumeExpired} from '../board/applicants';

/**
 * The candidate's own applications (mounted at `/site-api/my-applications`).
 *
 *   GET /    the signed-in user's applications, newest first (keyset page, `?before=<id>`), filtered by
 *            `?status=`, `?q=` (job title or company, contains), `?from=` / `?to=` (YYYY-MM-DD, applied
 *            on those days, UTC); with `counts` per status over ALL their applications (first page only)
 *
 * An application belongs to the ACCOUNT that sent it (`applicant_user_id`), so it stays theirs when
 * they change their email. The older guest applications (no account) belong to whoever owns their
 * EMAIL: only a signed-in user with a CONFIRMED email sees those (`requireVerified`), and the email
 * comes from the session, never from the request. Read only: the employer or the admin
 * decides the status. The employer's private notes are never selected.
 */
type Env = {Variables: {viewer: Viewer; db: PrismaClient}};
const PAGE = LIMITS.pageSize;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (v: unknown): Date | null => {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
};

const listQuery = validator('query', v => {
  const status = (APPLICATION_STATUSES as readonly unknown[]).includes(v.status) ? (v.status as ApplicationStatus) : null;
  const q = typeof v.q === 'string' ? v.q.trim().slice(0, 100) : '';
  const from = dayOf(v.from);
  const to = dayOf(v.to);
  return {before: idOf(typeof v.before === 'string' ? v.before : undefined), status, q, from, to: to ? new Date(to.getTime() + 86_400_000) : null};
});

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
  const userId = c.var.viewer.id;
  if (!userId) return c.json({items: [], nextBefore: null, counts: null});
  const {before, status, q, from, to} = c.req.valid('query');
  // On the (applicant_user_id, id) and (email, id) indexes: one person's applications, the job and
  // company joined in. The filters only narrow that person's own rows.
  const mine = {OR: [{applicantUserId: userId}, ...(email ? [{applicantUserId: null, email}] : [])]};
  const where = {
    AND: [mine],
    ...(status ? {status} : {}),
    ...(from || to ? {createdAt: {...(from ? {gte: from} : {}), ...(to ? {lt: to} : {})}} : {}),
    ...(q ? {OR: [{job: {title: {contains: q, mode: 'insensitive' as const}}}, {job: {company: {name: {contains: q, mode: 'insensitive' as const}}}}]} : {}),
  };
  const [rows, grouped] = await Promise.all([
    c.var.db.application.findMany({
      where: {...where, ...(before ? {id: {lt: before}} : {})},
      select,
      orderBy: {id: 'desc'},
      take: PAGE + 1,
    }),
    // The tiles: per status, over ALL of this person's applications (unfiltered), on the first page only.
    before ? null : c.var.db.application.groupBy({by: ['status'], where: mine, _count: {_all: true}}),
  ]);
  const counts = grouped
    ? Object.fromEntries(APPLICATION_STATUSES.map(s => [s, grouped.find(g => g.status === s)?._count._all ?? 0])) as Record<ApplicationStatus, number>
    : null;
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
  return c.json({items, nextBefore: rows.length > PAGE ? items.at(-1)!.id : null, counts});
});
