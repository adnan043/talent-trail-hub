import {useInfiniteQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';

import {type ApplicationStatus} from '../../lib/board';
import {MY_APPLICATION_STATUS_LABELS, type MyApplicationRow} from '../../lib/types-apply';
import {useMe, when} from '../shared';
import {Button, buttonClass, Card, type Column, DataTable, DefinitionList, Drawer, ErrorNote, Icon, type IconName, LoadingBlock, LoadMore, Notice, StatusBadge} from '../ui';
import {STATUS_TONES} from './ApplicantDrawer';
import {myApplicationsFilteredQuery, NO_MY_FILTER} from './queries';

/**
 * `/dashboard/my-applications`: the candidate's own applications (sent with their confirmed
 * email), with each one's status. Look only: the employer decides the status.
 */

const safeLink = (value: string | null) => {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
};

function StatusOf({row}: {row: MyApplicationRow}) {
  return <StatusBadge tone={STATUS_TONES[row.status]}>{MY_APPLICATION_STATUS_LABELS[row.status]}</StatusBadge>;
}

/** What they sent, and where it stands. */
function MyApplicationDrawer({application, onClose}: {application: MyApplicationRow | null; onClose: () => void}) {
  const link = safeLink(application?.profileUrl ?? null);
  return (
    <Drawer
      open={application !== null}
      onClose={onClose}
      title={application?.job.title ?? ''}
      description={application?.job.company}
      footer={
        <>
          {application?.job.slug && (
            <a className={buttonClass({variant: 'secondary'})} href={`/jobs/${application.job.slug}/`}>
              View the job
            </a>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }>
      {application && (
        <div className="form-stack">
          <div className="drawer-status">
            <p className="cell-title">Status</p>
            <StatusOf row={application} />
          </div>
          <DefinitionList
            items={[
              {label: 'Applied', value: when(application.appliedAt)},
              {label: 'Name', value: application.name},
              {label: 'Phone', value: application.phone ?? '—'},
              {
                label: 'Profile',
                value: link ? (
                  <a href={link} target="_blank" rel="noopener noreferrer">
                    {link}
                  </a>
                ) : (
                  '—'
                ),
              },
              {label: 'Resume', value: application.resumeFileName ?? '—'},
            ]}
          />
          {application.coverNote ? (
            <div>
              <p className="cell-title">Cover note</p>
              <p>{application.coverNote}</p>
            </div>
          ) : (
            <Notice>No cover note.</Notice>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** The tiles beside "Total applied": the outcomes the employer decides. */
const OUTCOME_TILES: {status: ApplicationStatus; icon: IconName}[] = [
  {status: 'shortlisted', icon: 'check'},
  {status: 'approved', icon: 'check-circle'},
  {status: 'rejected', icon: 'x'},
];

function Tile({icon, label, value}: {icon: IconName; label: string; value: number | null}) {
  return (
    <div className="applied-tile">
      <span className="applied-tile-icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <span>
        <span className="applied-tile-label">{label}</span>
        <span className="applied-tile-value">{value ?? '–'}</span>
      </span>
    </div>
  );
}

/** Nothing yet: rings around an icon, and the way to the jobs. */
function NoResult() {
  return (
    <div className="applied-empty">
      <span className="applied-empty-rings" aria-hidden="true">
        <span className="applied-empty-icon">
          <Icon name="file" size={24} />
        </span>
      </span>
      <p className="applied-empty-title">No result found</p>
      <p className="muted">You have not applied to any jobs yet. Start applying to jobs now!</p>
      <a className={buttonClass()} href="/jobs/">
        Job list <Icon name="arrow-right" size={16} />
      </a>
    </div>
  );
}

export function MyApplications() {
  const me = useMe();
  const verified = me.data?.viewer?.emailVerified === true;
  const query = useInfiniteQuery({...myApplicationsFilteredQuery(NO_MY_FILTER), enabled: verified});
  // The tiles count ALL applications: the list is unfiltered, so its first page carries them (the
  // same query as the dashboard's, no second read).
  const counts = query.data?.pages[0]?.counts ?? null;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;
  const [openId, setOpenId] = useState<number | null>(null);
  const rows = query.data?.pages.flatMap(page => page.items);
  const open = rows?.find(row => row.id === openId) ?? null;

  const columns: Column<MyApplicationRow>[] = [
    {
      key: 'job',
      header: 'Job',
      cell: row => (
        <>
          <span className="cell-title">{row.job.slug ? <a href={`/jobs/${row.job.slug}/`}>{row.job.title}</a> : row.job.title}</span>
          <span className="cell-sub">{row.job.company}</span>
        </>
      ),
    },
    {key: 'applied', header: 'Applied', width: 'shrink', hideOnMobile: true, cell: row => when(row.appliedAt)},
    {key: 'status', header: 'Status', width: 'shrink', cell: row => <StatusOf row={row} />},
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: row => (
        <Button variant="secondary" size="sm" onClick={() => setOpenId(row.id)} aria-label={`View your application for ${row.job.title}`}>
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="app-page screen-applied">
      <section className="applied-panel">
        <header className="applied-head">
          <h2>Applied jobs</h2>
          <p className="muted">Track the jobs you applied for and where each application stands.</p>
        </header>

        {me.isPending ? (
          <LoadingBlock rows={4} />
        ) : !verified ? (
          <Notice
            tone="warning"
            title="Confirm your email address first"
            action={
              <Link className={buttonClass({variant: 'secondary'})} to="/account">
                Your account
              </Link>
            }>
            Your applications are matched to your email address, so we show them once you have confirmed it is yours.
          </Notice>
        ) : (
          <div className="applied-body">
            <div className="applied-tiles">
              <div className="applied-tile-card">
                <Tile icon="briefcase" label="Total applied" value={total} />
              </div>
              <div className="applied-tile-card applied-tile-group">
                {OUTCOME_TILES.map(t => (
                  <Tile key={t.status} icon={t.icon} label={MY_APPLICATION_STATUS_LABELS[t.status]} value={counts ? counts[t.status] : null} />
                ))}
              </div>
            </div>

            {query.isPending ? (
              <LoadingBlock rows={4} />
            ) : query.error ? (
              <ErrorNote error={query.error} title="Your applications could not load" />
            ) : !rows?.length ? (
              <NoResult />
            ) : (
              <>
                <Card flush>
                  <DataTable caption="Applied jobs" columns={columns} rows={rows} rowKey={row => row.id} />
                </Card>
                <LoadMore query={query} />
              </>
            )}
          </div>
        )}
      </section>
      <MyApplicationDrawer application={open} onClose={() => setOpenId(null)} />
    </div>
  );
}
