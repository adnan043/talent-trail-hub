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
