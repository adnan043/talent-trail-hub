import {Hono} from 'hono';

import {manageEmailRoutes} from '../board/manage-emails';
import {manageJobRoutes} from '../board/manage-jobs';
import {manageModerationRoutes} from '../board/manage-moderation';
import {manageOverviewRoutes} from '../board/manage-overview';
import {managePrivacyRoutes} from '../board/manage-privacy';
import {manageSettingsRoutes} from '../board/manage-settings';
import {manageTierRoutes} from '../board/manage-tiers';

/**
 * The board's admin (workstream D, docs/MIGRATION.md). Every route is gated by a codename
 * (src/server/permissions.ts), never a role slug:
 *
 *   GET  /overview                     site:board:reports   F19 numbers
 *   *    /moderation[/:id[/approve|/reject]]  site:job:moderate  F20
 *   *    /jobs[...]                    site:job:manage      F21 list, create, edit, feature, extend, close, delete, run expiry
 *   *    /tiers[...]                   site:board:settings  F25 listing tiers, free posting
 *   *    /privacy/...                  site:privacy:manage  F36 lookup, delete, run purge
 *   GET  /emails                       site:board:reports   the email log
 *   *    /settings/{branding,board,moderation}  site:board:settings  F30, F39, F31
 */
export const manageRoutes = new Hono()
  .route('/overview', manageOverviewRoutes)
  .route('/moderation', manageModerationRoutes)
  .route('/jobs', manageJobRoutes)
  .route('/tiers', manageTierRoutes)
  .route('/privacy', managePrivacyRoutes)
  .route('/emails', manageEmailRoutes)
  .route('/settings', manageSettingsRoutes);
