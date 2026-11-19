import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useLayoutEffect, useRef, useState} from 'react';

import type {ActivityRange, ManageActivity} from '../../lib/types-manage';
import {useMe} from '../shared';
import {buttonClass, Card, DataTable, EmptyState, ErrorNote, Icon, initials, LoadingBlock, Menu, PageHeader, SegmentedControl, Stat, type Column} from '../ui';
import {bounded, money} from './format';
import {activityQuery, moderationQuery, overviewQuery} from './queries';

/**
 * The board admin's dashboard (`/`), Vela design: six tiles, applications per day as a bar
 * chart (or the full activity table), the jobs candidates look at most, and the review queue.
 * Every number is a capped, indexed read (docs/agent/performance.md).
 */
const RANGES: {value: ActivityRange; label: string}[] = [
  {value: '7d', label: 'Last 7 days'},
  {value: '30d', label: 'Last 30 days'},
  {value: '90d', label: 'Last 90 days'},
  {value: '12m', label: 'Last 12 months'},
];
const RANGE_WORDS: Record<ActivityRange, string> = {'7d': 'in 7 days', '30d': 'in 30 days', '90d': 'in 90 days', '12m': 'in 12 months'};
const PAGE = 10;

type Row = ManageActivity['rows'][number];

const plus = (more: boolean) => (more ? '+' : '');
const n = (value: number) => value.toLocaleString('en-US');
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;

export function AdminDashboard() {
  const me = useMe();
  const [range, setRange] = useState<ActivityRange>('30d');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const overview = useQuery(overviewQuery);
  const activity = useQuery({...activityQuery(range), placeholderData: previous => previous});
  const o = overview.data;
  const a = activity.data;
  const currency = a?.currency ?? o?.currency ?? 'USD';
  const can = me.data?.abilities;

  const sum = (pick: (row: Row) => number) => (a ? a.rows.reduce((total, row) => total + pick(row), 0) : 0);
  const at = a?.more ? ' (at least)' : '';
  const monthly = a?.granularity === 'month';
  const label = (period: string, short = false) =>
    new Intl.DateTimeFormat(
      'en-US',
      monthly ? {month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC'} : short ? {month: 'short', day: 'numeric', timeZone: 'UTC'} : {weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'}
    ).format(new Date(period));

  return (
    <div className="app-page screen-dashboard">
      <PageHeader
        title="Dashboard"
        description="Revenue, approvals and what candidates look at."
        actions={
          <>
            <Menu
              field
              align="end"
              label="Time range"
              trigger={RANGES.find(item => item.value === range)?.label}
              items={RANGES.map(item => ({label: item.label, checked: item.value === range, onSelect: () => setRange(item.value)}))}
            />
            {can?.manageJobs && (
              <Link className={buttonClass()} to="/manage/jobs/new">
                <Icon name="plus" size={16} />
                Post an admin job
              </Link>
            )}
          </>
        }
      />

      {overview.error && <ErrorNote error={overview.error} />}
      <div className="vd-stats">
        <Stat
          label="Net revenue"
          icon="trending-up"
          value={o ? `${money(o.revenueAll.value, o.currency)}${plus(o.revenueAll.more)}` : null}
          hint={o ? (o.revenue30d.value ? <><b>{money(o.revenue30d.value, o.currency)}{plus(o.revenue30d.more)}</b> in the last 30 days</> : 'No paid orders in 30 days') : undefined}
        />
        <Stat label="Paid orders" icon="receipt" value={bounded(o?.paidOrders)} hint={a ? <><b>{n(sum(r => r.refunds))}</b> refunds {RANGE_WORDS[range]}</> : undefined} />
        <Stat
          label="Pending approvals"
          icon="inbox"
          value={bounded(o?.pendingApprovals)}
          to="/manage/moderation"
          hint={
            <span className="vd-link-strong">
              Review now
              <Icon name="arrow-right" size={14} />
            </span>
          }
        />
        <Stat label="Active jobs" icon="briefcase" value={bounded(o?.activeJobs)} to="/manage/jobs" hint={a ? <><b>{n(sum(r => r.jobsPublished))}</b> published {RANGE_WORDS[range]}</> : undefined} />
        <Stat label="Applications" icon="users" value={bounded(o?.applications30d)} to={can?.readApplicants ? '/manage/applicants' : undefined} hint="In the last 30 days" />
        <Stat label="Companies" icon="building" value={bounded(o?.companies)} hint="On the board" />
      </div>

      <Card
        title={monthly ? 'Applications per month' : 'Applications per day'}
        description={
          a ? (
            <>
              <span className="vd-num">{n(sum(r => r.applications))}</span> applications · <span className="vd-num">{n(sum(r => r.jobsPublished))}</span> jobs published ·{' '}
              <span className="vd-num">{money(sum(r => r.revenueCents), currency)}</span> revenue {RANGE_WORDS[range]}
              {at}
            </>
          ) : undefined
        }
        actions={
          <SegmentedControl
            label="View"
            value={view}
            onChange={setView}
            options={[
              {value: 'chart', label: 'Chart'},
              {value: 'table', label: 'Table'},
            ]}
          />
        }
        flush={view === 'table'}>
        {activity.error && !a ? (
          <ErrorNote error={activity.error} />
        ) : !a ? (
          <LoadingBlock rows={3} />
        ) : view === 'chart' ? (
          <ActivityChart rows={[...a.rows].reverse()} label={label} />
        ) : (
          <ActivityTable rows={a.rows} label={label} currency={currency} />
        )}
      </Card>

      <div className={can?.moderateJobs ? 'vd-two' : undefined}>
        <Card
          title="Top jobs by views"
          description="What candidates look at most."
          flush
          className="vd-table"
          actions={
            can?.manageJobs ? (
              <Link className={buttonClass({variant: 'secondary', size: 'sm'})} to="/manage/jobs">
                All jobs
              </Link>
            ) : undefined
          }>
          <DataTable
            caption="Top jobs by views"
            columns={[
              {
                key: 'job',
                header: 'Job',
                cell: job => (
                  <span className="vd-row">
                    <span className="vd-co" aria-hidden="true">
                      {initials(job.company) || '·'}
                    </span>
                    <span className="vd-cell">
                      <a className="vd-t" href={`/jobs/${job.slug}/`}>
                        {job.title}
                      </a>
                      <span className="vd-s">{job.company}</span>
                    </span>
                  </span>
                ),
              },
              {key: 'views', header: 'Views', align: 'end', width: 'shrink', cell: job => n(job.views)},
              {key: 'applicants', header: 'Applicants', align: 'end', width: 'shrink', cell: job => n(job.applicants)},
            ]}
            rows={o?.topJobs}
            rowKey={job => job.id}
            loading={overview.isPending}
            error={overview.error}
            empty={
              <EmptyState icon="briefcase" title="No live jobs yet">
                Views show here once jobs are live.
              </EmptyState>
            }
          />
        </Card>
        {can?.moderateJobs && <WaitingCard />}
      </div>
    </div>
  );
}

/** A "nice" top for the y axis: 4 equal steps of 1, 2, 2.5 or 5 × 10ⁿ. */
function axisTop(max: number) {
  if (max <= 4) return 4;
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(f => f * pow).find(s => s >= raw)!;
  return step * 4;
}

function ActivityChart({rows, label}: {rows: Row[]; label: (period: string, short?: boolean) => string}) {
  const [hover, setHover] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const top = axisTop(Math.max(0, ...rows.map(r => r.applications)));
  const count = Math.max(1, rows.length);
  const slot = 100 / count;
  const bar = Math.min(slot - 0.4, Math.max(slot * 0.62, 0.5));
  const peak = rows.reduce<Row | null>((best, r) => (!best || r.applications > best.applications ? r : best), null);
  const ticks = [0, 1, 2, 3, 4].map(i => (top / 4) * i);
  const xLabels = rows.length <= 5 ? rows : [0, 1, 2, 3, 4].map(i => rows[Math.round((i / 4) * (rows.length - 1))]!);

  // The tip sits over the hovered bar: placed through the CSSOM (the CSP blocks style="").
  useLayoutEffect(() => {
    if (hover === null || !tip.current || !plot.current) return;
    const row = rows[hover]!;
    const width = plot.current.clientWidth;
    const x = ((hover + 0.5) / count) * width;
    const h = (row.applications / top) * plot.current.clientHeight;
    tip.current.style.left = `${Math.min(width - 70, Math.max(70, x))}px`;
    tip.current.style.top = `${plot.current.clientHeight - Math.max(h, 2)}px`;
  }, [hover, rows, count, top]);

  const summary = peak
    ? `Bar chart of applications from ${label(rows[0]!.period, true)} to ${label(rows[rows.length - 1]!.period, true)}. Peak of ${peak.applications} on ${label(peak.period, true)}.`
    : 'No activity in this period.';

  return (
    <div>
      <div className="vd-chart">
        <div className="vd-yax" aria-hidden="true">
          {ticks.map(t => (
            <span key={t}>{n(t)}</span>
          ))}
        </div>
        <div className="vd-plot" ref={plot} onMouseLeave={() => setHover(null)}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={summary}>
            {[25, 50, 75, 100].map(p => (
              <line key={p} className="vd-grid" x1="0" x2="100" y1={100 - p} y2={100 - p} />
            ))}
            {rows.map((row, i) => {
              const h = Math.max((row.applications / top) * 100, 0.6);
              return (
                <g
                  key={row.period}
                  className="vd-col"
                  tabIndex={0}
                  aria-label={`${label(row.period)}: ${plural(row.applications, 'application')}, ${plural(row.jobsPublished, 'job')} published`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}>
                  <rect className="vd-bar-bg" x={i * slot + 0.1} y="0" width={slot - 0.2} height="100" rx="0.6" />
                  <rect className="vd-bar" x={i * slot + (slot - bar) / 2} y={100 - h} width={bar} height={h} rx="0.5" />
                </g>
              );
            })}
          </svg>
          {hover !== null && rows[hover] && (
            <div className="vd-tip" ref={tip} aria-hidden="true">
              <small>{label(rows[hover].period)}</small>
              <b>{plural(rows[hover].applications, 'application')}</b>
              <small>{plural(rows[hover].jobsPublished, 'job')} published</small>
            </div>
          )}
        </div>
      </div>
      <div className="vd-xax" aria-hidden="true">
        {xLabels.map(r => (
          <span key={r.period}>{label(r.period, true)}</span>
        ))}
      </div>
    </div>
  );
}

function ActivityTable({rows, label, currency}: {rows: Row[]; label: (period: string) => string; currency: string}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * PAGE, at * PAGE + PAGE);
  const columns: Column<Row>[] = [
    {key: 'period', header: 'Day', cell: row => <span className="vd-num cell-title">{label(row.period)}</span>},
    {key: 'revenue', header: 'Revenue', align: 'end', cell: row => money(row.revenueCents, currency)},
    {key: 'orders', header: 'Paid orders', align: 'end', cell: row => row.paidOrders},
    {key: 'refunds', header: 'Refunds', align: 'end', cell: row => row.refunds},
    {key: 'jobs', header: 'Jobs published', align: 'end', cell: row => row.jobsPublished},
    {key: 'applications', header: 'Applications', align: 'end', cell: row => row.applications},
  ];
  return (
    <>
      <div className="vd-dense">
        <DataTable caption="Activity by period" columns={columns} rows={shown} rowKey={row => row.period} />
      </div>
      {rows.length > PAGE && (
        <div className="vd-tfoot">
          <span className="vd-num">
            Showing {at * PAGE + 1}–{at * PAGE + shown.length} of {rows.length}
          </span>
          <nav className="vd-pager" aria-label="Pages">
            <button type="button" className="vd-pg" disabled={at === 0} onClick={() => setPage(at - 1)}>
              <Icon name="arrow-left" size={14} />
              Previous
            </button>
            {Array.from({length: pages}, (_, i) => (
              <button key={i} type="button" className="vd-pg" aria-current={i === at ? 'page' : undefined} onClick={() => setPage(i)}>
                {i + 1}
              </button>
            ))}
            <button type="button" className="vd-pg" disabled={at === pages - 1} onClick={() => setPage(at + 1)}>
              Next
              <Icon name="arrow-right" size={14} />
            </button>
          </nav>
        </div>
      )}
    </>
  );
}

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
const daysWord = (d: number) => (d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`);

/** The first jobs of the review queue (shared cache with the nav badge and Moderation). */
function WaitingCard() {
  const queue = useInfiniteQuery(moderationQuery);
  const first = queue.data?.pages[0];
  const items = first?.items ?? [];
  const oldest = items.reduce((max, item) => Math.max(max, daysSince(item.submittedAt)), 0);
  const count = items.length ? `${items.length}${first?.nextAfter ? '+' : ''}` : null;
  return (
    <Card
      title="Waiting for review"
      description={items.length ? `Oldest waits ${daysWord(oldest)}.` : 'Nothing is waiting.'}
      actions={count ? <span className="vd-count">{count}</span> : undefined}
      footer={
        <Link className="vd-foot-link" to="/manage/moderation">
          Open moderation
          <Icon name="arrow-right" size={14} />
        </Link>
      }>
      {queue.error ? (
        <ErrorNote error={queue.error} />
      ) : queue.isPending ? (
        <LoadingBlock rows={3} />
      ) : items.length ? (
        <ul className="vd-list">
          {items.slice(0, 5).map(item => (
            <li key={item.id}>
              <span className="vd-co" aria-hidden="true">
                {initials(item.company.name) || '·'}
              </span>
              <span className="vd-cell">
                <Link className="vd-t" to="/manage/moderation/$id" params={{id: String(item.id)}}>
                  {item.title}
                </Link>
                <span className="vd-s">
                  {item.company.name} · {item.liveUntil || item.periodEnded ? 'Edit' : 'New'} · {daysWord(daysSince(item.submittedAt))}
                </span>
              </span>
              <Link className={buttonClass({variant: 'secondary', size: 'sm'})} to="/manage/moderation/$id" params={{id: String(item.id)}} aria-label={`Review ${item.title}`}>
                Review
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">New and edited jobs show here until you approve or reject them.</p>
      )}
    </Card>
  );
}
