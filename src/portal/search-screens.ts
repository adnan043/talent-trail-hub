import type {SearchScreen} from './CommandSearch';
import type {NavItem} from './routes';

/**
 * What the ⌘K search lists: every sidebar item the viewer sees, then the tabs inside it (Settings →
 * Branding, Board mode, Moderation mode) under the item's name, so a screen that moved into tabs is
 * still found by its own name.
 */
export function searchScreens(groups: readonly {label: string; items: readonly NavItem[]}[]): SearchScreen[] {
  return groups.flatMap(group =>
    group.items.flatMap(item => [
      {to: item.to, label: item.label, icon: item.icon, group: group.label},
      ...(item.tabs ?? []).map(tab => ({to: tab.to, label: tab.label, icon: item.icon, group: item.label, tab: true})),
    ])
  );
}
