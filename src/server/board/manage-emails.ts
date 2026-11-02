import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {EmailLogPage, EmailLogStatus} from '../../lib/types-manage';
import {requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';

/** The board's email log (`email_logs`), newest first, keyset by id; filter by status or exact recipient. */
const PAGE = 50;
const STATUSES: EmailLogStatus[] = ['sent', 'failed', 'skipped'];

const query = validator('query', v => ({
  before: typeof v.before === 'string' ? v.before : '',
  status: typeof v.status === 'string' ? v.status : '',
  to: typeof v.to === 'string' ? v.to.trim().toLowerCase().slice(0, 254) : '',
}));

export const manageEmailRoutes = new Hono().get(
  '/',
  query,
  withViewer,
  requireAuth,
  requirePermission(PERMISSIONS.BOARD_REPORTS),
  withDb,
  async c => {
    const q = c.req.valid('query');
    const before = /^\d{1,18}$/.test(q.before) ? BigInt(q.before) : null;
    const status = (STATUSES as string[]).includes(q.status) ? q.status : null;
    const to = q.to;
    const rows = await c.var.db.emailLog.findMany({
      where: {...(before ? {id: {lt: before}} : {}), ...(status ? {status} : {}), ...(to ? {to} : {})},
      select: {id: true, templateKey: true, to: true, status: true, error: true, createdAt: true},
      orderBy: {id: 'desc'},
      take: PAGE + 1,
    });
    const emails = rows.slice(0, PAGE).map(r => ({
      id: r.id.toString(),
      templateKey: r.templateKey,
      to: r.to,
      status: r.status as EmailLogStatus,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    }));
    const body: EmailLogPage = {emails, nextBefore: rows.length > PAGE ? emails.at(-1)!.id : null};
    return c.json(body);
  }
);
