import {useInfiniteQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';

import type {ModerationItem} from '../../../lib/types-manage';
import {ago, when} from '../../shared';
import {Badge, buttonClass, Card, type Column, DataTable, EmptyState, Icon, LoadMore, PageHeader, SegmentedControl, StatusBadge, TileCell} from '../../ui';
import {money, SOURCE_LABELS} from '../format';
import {moderationQuery} from '../queries';

/** `/manage/moderation` (site:job:moderate): jobs waiting for review, oldest first (F20). */
export function Moderation() {
  const queue = useInfiniteQuery(moderationQuery);
  const all = queue.data?.pages.flatMap(page => page.items);
  const [kind, setKind] = useState<'all' | 'new' | 'edit'>('all');
  const isEdit = (item: ModerationItem) => Boolean(item.liveUntil || item.periodEnded);
  // Filtered in the browser over the loaded queue (oldest first; "Load more" brings the rest).
  const rows = all?.filter(item => kind === 'all' || (kind === 'edit') === isEdit(item));
  const edits = all?.filter(isEdit).length ?? 0;
  const oldest = all?.length ? Math.max(...all.map(item => Math.floor((Date.now() - new Date(item.submittedAt).getTime()) / 86_400_000))) : null;
  const more = queue.hasNextPage ? '+' : '';

  const columns: Column<ModerationItem>[] = [
    {
      key: 'job',
      header: 'Job',
      cell: item => (
        <TileCell
          tile={item.company.name}
          title={
            <Link className="cell-title" to="/manage/moderation/$id" params={{id: String(item.id)}}>
              {item.title}
            </Link>
          }
          detail={
            <>
              {item.company.name}
              {item.company.isTrusted && (
                <span className="mini-chip">
                  <Icon name="check" size={14} />
                  Trusted
                </span>
              )}
            </>
          }
        />
      ),
    },
    {
      key: 'kind',
      header: 'Kind',
      width: 'shrink',
      cell: item => (
        <span className="badges">
          {item.liveUntil ? (
            <StatusBadge tone="warning">Edit of a live job</StatusBadge>
          ) : item.periodEnded ? (
            <StatusBadge tone="warning">Edit, period ended</StatusBadge>
          ) : (
            <StatusBadge tone="info">New listing</StatusBadge>
          )}
          {item.flagged && <Badge tone="danger">Flagged</Badge>}
        </span>
      ),
    },
    {
      key: 'paid',
      header: 'Payment',
      width: 'shrink',
      hideOnMobile: true,
      cell: item => (
        <span className="cell-stack">
          <span className="cell-title">{item.payment ? money(item.payment.amountCents, item.payment.currency) : SOURCE_LABELS[item.source]}</span>
          {item.payment && <span className="cell-sub">{SOURCE_LABELS[item.source]}</span>}
        </span>
      ),
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
        description="Review each job as it will appear, then approve it or say why not. Oldest first is fairest."
        actions={
          <>
            <Link className={buttonClass({variant: 'secondary'})} to="/manage/settings/moderation">
              Moderation mode
            </Link>
            {all?.[0] && (
              <Link className={buttonClass()} to="/manage/moderation/$id" params={{id: String(all[0].id)}}>
                <Icon name="eye" size={16} />
                Start reviewing
              </Link>
            )}
          </>
        }
      />
      <div className="toolbar">
        <SegmentedControl
          label="Show"
          value={kind}
          onChange={setKind}
          options={[
            {value: 'all', label: <>All <em className="segment-count">{all ? `${all.length}${more}` : '–'}</em></>},
            {value: 'new', label: <>New <em className="segment-count">{all ? all.length - edits : '–'}</em></>},
            {value: 'edit', label: <>Edits <em className="segment-count">{edits}</em></>},
          ]}
        />
        {oldest !== null && (
          <span className="toolbar-note">
            <Icon name="clock" size={14} />
            Oldest waiting {oldest === 0 ? 'under a day' : oldest === 1 ? '1 day' : `${oldest} days`}
          </span>
        )}
      </div>
      <Card
        flush
        footer={
          <span className="card-foot-note">
            <span>
              Showing {rows?.length ?? 0} of {all?.length ?? 0}
              {more}
            </span>
            <span>Approved jobs go live straight away and the employer gets an email.</span>
          </span>
        }>
        <DataTable
          caption="Jobs waiting for review"
          columns={columns}
          rows={rows}
          rowKey={item => item.id}
          loading={queue.isPending}
          error={queue.error}
          empty={
            kind !== 'all' && all?.length ? (
              <EmptyState icon="inbox" title="Nothing here">
                No jobs of this kind are waiting.
              </EmptyState>
            ) : (
            <EmptyState icon="check-circle" title="All caught up">
              Jobs show here when employers submit or edit them. An edited live job leaves the board until you decide.
            </EmptyState>
            )
          }
        />
      </Card>
      <LoadMore query={queue} />
    </div>
  );
}
