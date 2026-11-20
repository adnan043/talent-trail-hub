import type {Abilities} from '../lib/types';
import type {SearchScreen} from './CommandSearch';
import type {NavItem} from './routes';

/**
 * What the ⌘K search lists: every sidebar item the viewer sees, then the tabs inside it (Settings →
 * Branding, Board mode, Moderation mode; Admin jobs → Post a job, Applicants) under the item's name,
 * so a screen that moved into tabs is still found by its own name. A tab with an `ability` is listed
 * only for a viewer who has it (the tab bar hides it too).
 */
export function searchScreens(groups: readonly {label: string; items: readonly NavItem[]}[], abilities?: Partial<Abilities> | null): SearchScreen[] {
  return groups.flatMap(group =>
    group.items.flatMap(item => [
      {to: item.to, label: item.label, icon: item.icon, group: group.label},
      ...(item.tabs ?? [])
        .filter(tab => !tab.ability || abilities?.[tab.ability])
        .map(tab => ({to: tab.to, label: tab.label, icon: item.icon, group: item.label, tab: true})),
    ])
  );
}
