import {config} from '../platform/config';
import {type AuthSettings, DEFAULT_AUTH_SETTINGS} from '../platform/auth';

/**
 * How sign-in works on THIS site (yours to edit; the auth core in
 * `src/platform/auth/` reads it). Every option is explained in
 * `src/platform/auth/settings.ts` and docs/agent/auth.md.
 *
 * Who may become owner: The platform hands the live site the account owner's
 * email at each Publish (`SITE_OWNER_EMAILS`); add more addresses in
 * `ownerEmails`. On the live site, with no owner email at all, nobody becomes
 * owner (the first person to sign up never does).
 */
export const authSettings: AuthSettings = {
  ...DEFAULT_AUTH_SETTINGS,
  // registration: 'open',
  // Without a Site Key (local dev, the Preview) no email can be sent: sign up without the
  // confirmation link. A getter, so it is read per request; the live site has the key.
  get requireEmailVerification() {
    return config.siteKey !== null;
  },
  // ownerEmails: ['owner@example.com'],
  afterSignInPath: '/dashboard',
};
