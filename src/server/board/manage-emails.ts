import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import type {EmailLogPage, EmailLogStatus} from '../../lib/types-manage';
import {getAccess, SYSTEM_ROLES} from '../../platform/auth';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';

/**
 * The board's email log (`email_logs`), newest first, keyset by id; filter by status or exact
 * recipient. Recipients are other people (candidates, employers, moderators). The owner's rule
 * (2026-11-01, as the users screen): the full address only for the site's OWNER, masked
 * (`m•••@domain`) for everyone else with `site:board:reports`. The exact-address filter is a POST
 * (`/search`), so an address never sits in a URL, and is the owner's alone too (anyone else could
 * test which addresses got mail from the board).
 */
const PAGE = 50;

/** Whether the viewer is the site's owner: only they see full recipient addresses. */
const isOwner = async (c: {req: {raw: Request}}) => (await getAccess(c.req.raw)).roles.includes(SYSTEM_ROLES.OWNER);
const STATUSES: EmailLogStatus[] = ['sent', 'failed', 'skipped'];

interface Filter {
  before: string;
  status: string;
  to: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const query = validator('query', v => ({before: text(v.before), status: text(v.status)}));

const searchBody = validator('json', v => {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return {before: text(o.before), status: text(o.status), to: text(o.to).trim().toLowerCase().slice(0, 254)};
});

/** `m•••@gmail.com`: the first letter and the domain. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${address[0]}•••${address.slice(at)}`;
}

async function emailPage(db: PrismaClient, filter: Filter, fullAddresses: boolean): Promise<EmailLogPage> {
  const before = /^\d{1,18}$/.test(filter.before) ? BigInt(filter.before) : null;
  const status = (STATUSES as string[]).includes(filter.status) ? filter.status : null;
  const to = filter.to;
  const rows = await db.emailLog.findMany({
    where: {...(before ? {id: {lt: before}} : {}), ...(status ? {status} : {}), ...(to ? {to} : {})},
    select: {id: true, templateKey: true, to: true, status: true, error: true, createdAt: true},
    orderBy: {id: 'desc'},
    take: PAGE + 1,
  });
  const emails = rows.slice(0, PAGE).map(r => ({
    id: r.id.toString(),
    templateKey: r.templateKey,
    to: fullAddresses ? r.to : maskEmail(r.to),
    status: r.status as EmailLogStatus,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  }));
  return {emails, nextBefore: rows.length > PAGE ? emails.at(-1)!.id : null};
}

export const manageEmailRoutes = new Hono()
  .get('/', query, withViewer, requireAuth, requirePermission(PERMISSIONS.BOARD_REPORTS), withDb, async c =>
    c.json(await emailPage(c.var.db, {...c.req.valid('query'), to: ''}, await isOwner(c)))
  )
  .post('/search', searchBody, withViewer, requireAuth, requirePermission(PERMISSIONS.BOARD_REPORTS), withDb, async c => {
    const filter = c.req.valid('json');
    const fullAddresses = await isOwner(c);
    if (filter.to && !fullAddresses) {
      return c.json(problem('forbidden', 'Only the site owner can find emails by address.'), 403);
    }
    return c.json(await emailPage(c.var.db, filter, fullAddresses));
  });
