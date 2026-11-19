import {describe, expect, it} from 'vitest';

import {isEmployerPath} from '../src/lib/account';

/**
 * Sign-up picks a company account when the way back is an employer screen (Pricing's "Post a …
 * listing", "Post a job", the dashboard's sign-in gate there): a job seeker account can never post.
 */
describe('isEmployerPath', () => {
  it('is true for posting a job and the employer screens', () => {
    for (const next of ['/dashboard/post-a-job', '/dashboard/post-a-job?step=2', '/dashboard/employer/jobs', '/dashboard/employer/company', '/dashboard/employer'])
      expect(isEmployerPath(next), next).toBe(true);
  });

  it('is false for everything else', () => {
    for (const next of ['/dashboard', '/dashboard/', '/dashboard/profile', '/dashboard/my-applications', '/jobs/a-job/#apply', '/dashboard/post-a-jobs', '/dashboard/employers', '/post-a-job/', ''])
      expect(isEmployerPath(next), next).toBe(false);
  });
});
