import {Hono} from 'hono';

import {clearPublicListsAfterWrite} from '../board/public-cache';

import {manageCompanyRoutes} from '../board/manage-companies';

import {manageEmailRoutes} from '../board/manage-emails';
import {manageJobRoutes} from '../board/manage-jobs';
import {manageModerationRoutes} from '../board/manage-moderation';
import {forgetReportsAfterWrite, manageOverviewRoutes} from '../board/manage-overview';
import {managePrivacyRoutes} from '../board/manage-privacy';
import {manageSettingsRoutes} from '../board/manage-settings';
import {manageTierRoutes} from '../board/manage-tiers';

/**
 * The board's admin (workstream D, docs/MIGRATION.md). Every route is gated by a codename
 * (src/server/permissions.ts), never a role slug:
 *
 *   GET  /overview                     site:board:reports   F19 numbers
 *   *    /moderation[/:id[/approve|/reject]]  site:job:moderate  F20
 *   POST /companies/:id/{block,trust}  site:job:moderate  block / unblock, trust / untrust a company
 *   *    /jobs[...]                    site:job:manage      F21 list, create, edit, feature, extend, close, delete, run expiry
 *   *    /tiers[...]                   site:board:settings  F25 listing tiers, free posting
 *   *    /privacy/...                  site:privacy:manage  F36 lookup, delete, run purge
 *   GET  /emails                       site:board:reports   the email log
 *   *    /settings/{branding,board,moderation}  site:board:settings  F30, F39, F31
 */
export const manageRoutes = new Hono()
  .use(clearPublicListsAfterWrite)
  // Any admin write can change the dashboard's numbers: its cached reports go too.
  .use(forgetReportsAfterWrite)
  .route('/overview', manageOverviewRoutes)
  .route('/moderation', manageModerationRoutes)
  .route('/companies', manageCompanyRoutes)
  .route('/jobs', manageJobRoutes)
  .route('/tiers', manageTierRoutes)
  .route('/privacy', managePrivacyRoutes)
  .route('/emails', manageEmailRoutes)
  .route('/settings', manageSettingsRoutes);
