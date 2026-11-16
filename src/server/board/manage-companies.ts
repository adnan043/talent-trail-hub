import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {AdminCompanyState} from '../../lib/types-manage';
import {audit} from '../../platform/auth';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';
import {actorOf, asObject, idParam, invalid} from './manage-shared';
import {getBoardSettings} from './settings';

/**
 * A company's standing (site:job:moderate): block / unblock and trust / untrust. A blocked company
 * is off every public page (its page, its jobs, the directory: `company.isBlocked` is checked there)
 * and its employer can no longer post or change jobs. A trusted one's next jobs skip review
 * (`submissionTarget`). The public lists are cleared by `clearPublicListsAfterWrite` (routes/manage.ts).
 */
const guard = [withViewer, requireAuth, requirePermission(PERMISSIONS.JOB_MODERATE), withDb] as const;

const blockedBody = validator('json', (value, c) => {
  const blocked = asObject(value).blocked;
  if (typeof blocked !== 'boolean') return invalid(c, {blocked: 'Send true or false.'});
  return {blocked};
});
const trustedBody = validator('json', (value, c) => {
  const trusted = asObject(value).trusted;
  if (typeof trusted !== 'boolean') return invalid(c, {trusted: 'Send true or false.'});
  return {trusted};
});

const noCompany = problem('not_found', 'No such company.');
const select = {id: true, name: true, isBlocked: true, isTrusted: true} as const;
const stateOf = (row: {id: number; name: string; isBlocked: boolean; isTrusted: boolean}): AdminCompanyState => ({
  id: row.id,
  name: row.name,
  isBlocked: row.isBlocked,
  isTrusted: row.isTrusted,
});

export const manageCompanyRoutes = new Hono()
  .post('/:id/block', blockedBody, ...guard, async c => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json(noCompany, 404);
    const db = c.var.db;
    const on = c.req.valid('json').blocked;
    const company = await db.company.findUnique({where: {id}, select});
    if (!company) return c.json(noCompany, 404);
    if (on) {
      const settings = await getBoardSettings(db);
      if (settings.ownerCompanyId === id) {
        return c.json(problem('owner_company', 'This company runs the board. Choose another owner company in the board settings first.'), 409);
      }
    }
    if (company.isBlocked === on) return c.json(stateOf(company));
    const saved = await db.company.update({where: {id}, data: {isBlocked: on}, select});
    await audit(db, {...(await actorOf(c)), action: on ? 'company_blocked' : 'company_unblocked', target: ['company', id]});
    return c.json(stateOf(saved));
  })

  .post('/:id/trust', trustedBody, ...guard, async c => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json(noCompany, 404);
    const db = c.var.db;
    const on = c.req.valid('json').trusted;
    const company = await db.company.findUnique({where: {id}, select});
    if (!company) return c.json(noCompany, 404);
    if (company.isTrusted === on) return c.json(stateOf(company));
    const saved = await db.company.update({where: {id}, data: {isTrusted: on}, select});
    await audit(db, {...(await actorOf(c)), action: on ? 'company_trusted' : 'company_untrusted', target: ['company', id]});
    return c.json(stateOf(saved));
  });
