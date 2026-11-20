import {describe, expect, it} from 'vitest';

import {searchScreens} from '../src/portal/search-screens';

/** The dashboard's ⌘K search (CommandSearch.tsx) still finds a screen that became a tab. */
describe('searchScreens', () => {
  it('lists each sidebar item, then its tabs under the item’s name', () => {
    const screens = searchScreens([
      {label: 'Site', items: [
        {to: '/users', label: 'Users', icon: 'users'},
        {to: '/manage/settings', label: 'Settings', icon: 'settings', tabs: [{to: '/manage/settings/branding', label: 'Branding'}, {to: '/manage/settings/board', label: 'Board mode'}]},
      ]},
    ]);
    expect(screens).toEqual([
      {to: '/users', label: 'Users', icon: 'users', group: 'Site'},
      {to: '/manage/settings', label: 'Settings', icon: 'settings', group: 'Site'},
      {to: '/manage/settings/branding', label: 'Branding', icon: 'settings', group: 'Settings', tab: true},
      {to: '/manage/settings/board', label: 'Board mode', icon: 'settings', group: 'Settings', tab: true},
    ]);
  });
});

/** ⌘K finds the Admin jobs tabs ("Applicants", "Post a job"), each only for a viewer who may use it. */
describe('searchScreens: Admin jobs tabs', () => {
  it('lists Applicants and Post a job under Admin jobs, gated by each tab’s ability', async () => {
    await import('../src/portal/routes'); // the app's own import order (admin routes import its root)
    const {ADMIN_NAV} = await import('../src/portal/admin/routes');
    const board = ADMIN_NAV.map(group => ({...group, items: group.items.filter(item => item.to === '/manage/admin-jobs')}));
    const labels = (abilities: Record<string, boolean>) =>
      searchScreens(board, abilities as never)
        .filter(s => s.tab)
        .map(s => `${s.group} › ${s.label} → ${s.to}`);
    expect(labels({manageJobs: true, readApplicants: true})).toEqual([
      'Admin jobs › Post a job → /manage/admin-jobs/post',
      'Admin jobs › Applicants → /manage/admin-jobs/applicants',
    ]);
    expect(labels({readApplicants: true})).toEqual(['Admin jobs › Applicants → /manage/admin-jobs/applicants']);
    expect(labels({manageJobs: true})).toEqual(['Admin jobs › Post a job → /manage/admin-jobs/post']);
  });

  it('shows the Admin jobs item to a role that only reads applicants', async () => {
    await import('../src/portal/routes'); // the app's own import order (admin routes import its root)
    const {ADMIN_NAV} = await import('../src/portal/admin/routes');
    const item = ADMIN_NAV.flatMap(group => group.items).find(i => i.to === '/manage/admin-jobs');
    expect(item?.ability).toBeUndefined();
    expect(item?.anyAbility).toEqual(['manageJobs', 'readApplicants']);
  });
});
