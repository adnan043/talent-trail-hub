import {useQuery} from '@tanstack/react-query';
import {useState} from 'react';

import type {ActivityRange, ManageActivity} from '../../lib/types-manage';
import {Card, DataTable, EmptyState, ErrorNote, Menu, PageHeader, Stat, type Column} from '../ui';
import {bounded, money} from './format';
import {activityQuery, overviewQuery} from './queries';

/**
 * The board admin's dashboard (`/`): revenue and queue tiles, an activity table by
 * day (or month) with a range picker, and the jobs candidates look at most.
 * Every number is a capped, indexed read (docs/agent/performance.md).
 */
const RANGES: {value: ActivityRange; label: string}[] = [
  {value: '7d', label: 'Last 7 days'},
  {value: '30d', label: 'Last 30 days'},
  {value: '90d', label: 'Last 90 days'},
  {value: '12m', label: 'Last 12 months'},
];

type Row = ManageActivity['rows'][number];

const plus = (more: boolean) => (more ? '+' : '');

export function AdminDashboard() {
  const [range, setRange] = useState<ActivityRange>('30d');
  const overview = useQuery(overviewQuery);
  const activity = useQuery({...activityQuery(range), placeholderData: previous => previous});
  const o = overview.data;
  const a = activity.data;
  const currency = a?.currency ?? o?.currency ?? 'USD';

  const sum = (pick: (row: Row) => number) => (a ? a.rows.reduce((total, row) => total + pick(row), 0) : 0);
  const summary = a
    ? [
        `${money(sum(r => r.revenueCents), currency)} revenue`,
        `${sum(r => r.paidOrders)} paid orders`,
        `${sum(r => r.refunds)} refunds`,
        `${sum(r => r.jobsPublished)} jobs published`,
        `${sum(r => r.applications)} applications`,
      ].join(' · ') + (a.more ? ' (at least)' : '')
    : undefined;

  const label = (period: string) =>
    new Intl.DateTimeFormat('en-US', a?.granularity === 'month' ? {month: 'long', year: 'numeric', timeZone: 'UTC'} : {weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'}).format(new Date(period));

  const columns: Column<Row>[] = [
    {key: 'period', header: 'Period', cell: row => label(row.period)},
    {key: 'revenue', header: 'Revenue', align: 'end', cell: row => money(row.revenueCents, currency)},
    {key: 'orders', header: 'Paid orders', align: 'end', cell: row => row.paidOrders},
    {key: 'refunds', header: 'Refunds', align: 'end', cell: row => row.refunds},
    {key: 'jobs', header: 'Jobs published', align: 'end', cell: row => row.jobsPublished},
    {key: 'applications', header: 'Applications', align: 'end', cell: row => row.applications},
  ];

  return (
    <div className="app-page screen-dashboard">
      <PageHeader eyebrow="Admin" title="Dashboard" description="Revenue, approvals and what candidates look at." />

      {overview.error && <ErrorNote error={overview.error} />}
      <div className="stat-grid stat-grid-3">
        <Stat label="Net revenue" icon="trending-up" tone="success" value={o ? `${money(o.revenueAll.value, o.currency)}${plus(o.revenueAll.more)}` : null} />
        <Stat label="Paid orders" icon="file" tone="info" value={bounded(o?.paidOrders)} />
        <Stat label="Pending approvals" icon="inbox" tone="danger" value={bounded(o?.pendingApprovals)} to="/manage/moderation" />
        <Stat label="Active jobs" icon="briefcase" tone="danger" value={bounded(o?.activeJobs)} to="/manage/jobs" />
        <Stat label="Applications" icon="users" tone="warning" value={bounded(o?.applications30d)} />
        <Stat label="Companies" icon="layers" tone="info" value={bounded(o?.companies)} />
      </div>

      <section className="dashboard-section" aria-labelledby="dashboard-activity">
        <div className="dashboard-section-head">
          <div>
            <h3 id="dashboard-activity">Activity</h3>
            {summary && <p className="muted">{summary}</p>}
          </div>
          <div className="dashboard-range">
            <Menu
              field
              align="start"
              label="Time range"
              trigger={RANGES.find(item => item.value === range)?.label}
              items={RANGES.map(item => ({label: item.label, checked: item.value === range, onSelect: () => setRange(item.value)}))}
            />
          </div>
        </div>
        <Card flush>
          <DataTable
            caption="Activity by period"
            columns={columns}
            rows={a?.rows}
            rowKey={row => row.period}
            loading={activity.isPending}
            error={activity.error}
          />
        </Card>
      </section>

      <section className="dashboard-section" aria-labelledby="dashboard-top">
        <div className="dashboard-section-head">
          <h3 id="dashboard-top">Top jobs by views</h3>
        </div>
        <Card flush>
          <DataTable
            caption="Top jobs by views"
            columns={[
              {key: 'job', header: 'Job', cell: job => <a className="row-title" href={`/jobs/${job.slug}/`}>{job.title}</a>},
              {key: 'company', header: 'Company', cell: job => job.company},
              {key: 'views', header: 'Views', align: 'end', cell: job => job.views.toLocaleString('en-US')},
              {key: 'applicants', header: 'Applicants', align: 'end', cell: job => job.applicants.toLocaleString('en-US')},
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
      </section>
    </div>
  );
}
