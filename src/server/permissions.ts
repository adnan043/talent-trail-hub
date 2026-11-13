import {abilitiesOf, type AbilitiesOf, codenamesOf, CORE_PERMISSIONS, definePermissions} from '../platform/auth/codenames';

/**
 * THE permission catalogue: every codename this site checks, declared ONCE.
 * Adding a permission is one entry here, plus its line in tests/permissions.test.ts
 * (docs/agent/roles-and-permissions.md):
 *
 *   - `PERMISSIONS.<KEY>` is its codename, for `requirePermission` / `can`;
 *   - `ability` adds a flag to `/me` `abilities` (and to the `Abilities` type)
 *     for the UI: portal nav items, buttons, `pageContext()` pages;
 *   - the row reaches the `permissions` table (the roles screen) on the next
 *     signed-in request after deploy, and `roles` get it that first time only
 *     (`src/platform/permission-sync.ts`). No migration.
 *   - tests/permissions.test.ts lists every shipped codename and ability, so
 *     `npm test` fails until you add the new one there too (on purpose: a
 *     renamed or lost permission never slips through).
 *
 * Never rename or reuse a shipped codename: roles hold it by name. Browser-safe
 * (no server imports): the portal reads the `Abilities` type from here.
 */
export const CATALOGUE = definePermissions({
  ...CORE_PERMISSIONS,
  /** Admin: every job on the board (create free admin jobs, edit, feature, extend, close, delete). */
  JOB_MANAGE: {
    codename: 'site:job:manage',
    title: 'Manage jobs',
    description: 'Every job on the board: post free jobs, edit admin jobs, feature, extend, close and delete.',
    group: 'Jobs',
    ability: 'manageJobs',
    roles: ['admin'],
  },
  /** Admin: the moderation queue (approve, reject). */
  JOB_MODERATE: {
    codename: 'site:job:moderate',
    title: 'Moderate jobs',
    description: 'Approve or reject jobs waiting for review.',
    group: 'Jobs',
    ability: 'moderateJobs',
    roles: ['admin'],
  },
  /** Admin: every application on the board, resumes included (audited). */
  APPLICANT_READ_ALL: {
    codename: 'site:applicant:read',
    title: 'See all applicants',
    description: "Every job's applicants and resumes (each resume download is logged).",
    group: 'Applicants',
    ability: 'readApplicants',
    roles: ['admin'],
  },
  /** Admin: look up and delete a candidate's data by email (F36). */
  PRIVACY_MANAGE: {
    codename: 'site:privacy:manage',
    title: 'Delete candidate data',
    description: 'Look up an email and delete its applications, resumes and alerts.',
    group: 'Applicants',
    ability: 'managePrivacy',
    roles: ['admin'],
  },
  /** Admin: board settings (branding, board mode, moderation mode), listing tiers, categories. */
  BOARD_SETTINGS: {
    codename: 'site:board:settings',
    title: 'Change board settings',
    description: 'Branding, board mode, moderation mode, listing tiers and prices.',
    group: 'Board',
    ability: 'manageBoard',
    roles: ['admin'],
  },
  /** Admin: revenue, orders and the email log. */
  BOARD_REPORTS: {
    codename: 'site:board:reports',
    title: 'See revenue and logs',
    description: 'Revenue, orders, the board overview and the email log.',
    group: 'Board',
    ability: 'readBoardReports',
    roles: ['admin'],
  },
});

/** Codenames by key: `PERMISSIONS.JOB_MANAGE` is `'site:job:manage'`. */
export const PERMISSIONS = codenamesOf(CATALOGUE);

export type Codename = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** What the UI may SHOW the visitor (`/me`); every route checks again. */
export type Abilities = AbilitiesOf<typeof CATALOGUE>;

/** The abilities a set of granted codenames gives (`/me`). */
export const abilitiesFor = (permissions: ReadonlySet<string>): Abilities => abilitiesOf(CATALOGUE, permissions);

/** A guest's abilities: every flag false. */
export const NO_ABILITIES: Abilities = abilitiesFor(new Set());
