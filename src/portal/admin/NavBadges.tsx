import {useInfiniteQuery} from '@tanstack/react-query';

import {pageCount} from '../shared';
import {moderationQuery} from './queries';

/** The Moderation nav item's waiting count, from the queue's first page ("50+"); nothing when empty. */
export function ModerationNavBadge() {
  const queue = useInfiniteQuery(moderationQuery);
  const first = queue.data?.pages[0];
  if (!first?.items.length) return null;
  const count = pageCount(first.items, first.nextAfter !== null);
  return (
    <span className="app-nav-badge" aria-label={`${count} waiting`}>
      {count}
    </span>
  );
}
