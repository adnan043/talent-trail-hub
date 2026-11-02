import {useInfiniteQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';

import type {ModerationItem} from '../../../lib/types-manage';
import {ago, when} from '../../shared';
import {Badge, buttonClass, Card, type Column, DataTable, EmptyState, LoadMore, PageHeader} from '../../ui';
import {money, SOURCE_LABELS} from '../format';
import {moderationQuery} from '../queries';

/** `/manage/moderation` (site:job:moderate): jobs waiting for review, oldest first (F20). */
export function Moderation() {
  const queue = useInfiniteQuery(moderationQuery);
  const rows = queue.data?.pages.flatMap(page => page.items);

  const columns: Column<ModerationItem>[] = [
    {
      key: 'job',
      header: 'Job',
      cell: item => (
        <span>
          <Link className="cell-title" to="/manage/moderation/$id" params={{id: String(item.id)}}>
            {item.title}
          </Link>
          <span className="cell-sub">
            {item.company.name}
            {item.company.isTrusted ? ' · trusted' : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'kind',
      header: 'Kind',
      width: 'shrink',
      cell: item => (
        <span className="badges">
          {item.liveUntil ? <Badge tone="info">Edit of a live job</Badge> : <Badge>New</Badge>}
          {item.flagged && <Badge tone="danger">Flagged</Badge>}
        </span>
      ),
    },
    {
      key: 'paid',
      header: 'Payment',
      width: 'shrink',
      hideOnMobile: true,
      cell: item => (item.payment ? money(item.payment.amountCents, item.payment.currency) : <span className="muted">{SOURCE_LABELS[item.source]}</span>),
    },
    {
      key: 'when',
      header: 'Submitted',
      width: 'shrink',
      cell: item => (
        <time className="muted" dateTime={item.submittedAt} title={when(item.submittedAt)}>
          {ago(item.submittedAt)}
        </time>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: item => (
        <Link className={buttonClass({variant: 'secondary', size: 'sm'})} to="/manage/moderation/$id" params={{id: String(item.id)}}>
          Review
        </Link>
      ),
    },
  ];

  return (
    <div className="app-page screen-moderation">
      <PageHeader
        title="Moderation"
        description="Review each job as it will appear, then approve it or say why not."
        actions={
          <Link className={buttonClass({variant: 'secondary'})} to="/manage/settings/moderation">
            Moderation mode
          </Link>
        }
      />
      <Card flush>
        <DataTable
          caption="Jobs waiting for review"
          columns={columns}
          rows={rows}
          rowKey={item => item.id}
          loading={queue.isPending}
          error={queue.error}
          empty={
            <EmptyState icon="check-circle" title="All caught up">
              Jobs show here when employers submit or edit them. An edited live job stays up while you decide.
            </EmptyState>
          }
        />
      </Card>
      <LoadMore query={queue} />
    </div>
  );
}
