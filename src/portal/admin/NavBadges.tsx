import {useInfiniteQuery} from '@tanstack/react-query';

import {pageCount} from '../shared';
import {moderationQuery} from './queries';

/**
 * The Moderation nav item's waiting count, from the queue's first page ("50+"); nothing when empty.
 * The queue route has no smaller page size, so this shares the queue's own cache entry (one read for
 * the badge, the overview panel and the Moderation screen) and `select`s just the count: the badge
 * re-renders only when the number changes, not on every refetch of the rows.
 */
export function ModerationNavBadge() {
  const {data: count} = useInfiniteQuery({
    ...moderationQuery,
    select: data => {
      const first = data.pages[0];
      return first?.items.length ? pageCount(first.items, first.nextAfter !== null) : null;
    },
  });
  if (!count) return null;
  return (
    <span className="app-nav-badge" aria-label={`${count} waiting`}>
      {count}
    </span>
  );
}
