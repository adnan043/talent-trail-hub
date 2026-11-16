import {useInfiniteQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';

import {MY_APPLICATION_STATUS_LABELS, type MyApplicationRow} from '../../lib/types-apply';
import {ago, useMe, when} from '../shared';
import {Button, buttonClass, Card, type Column, DataTable, DefinitionList, Drawer, EmptyState, LoadingBlock, LoadMore, Notice, PageHeader, StatusBadge} from '../ui';
import {STATUS_TONES} from './ApplicantDrawer';
import {myApplicationsQuery} from './queries';

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

export function MyApplications() {
  const me = useMe();
  const verified = me.data?.viewer?.emailVerified === true;
  const query = useInfiniteQuery({...myApplicationsQuery, enabled: verified});
  const [openId, setOpenId] = useState<number | null>(null);
  const rows = query.data?.pages.flatMap(page => page.items);
  const open = rows?.find(row => row.id === openId) ?? null;

  const columns: Column<MyApplicationRow>[] = [
    {
      key: 'job',
      header: 'Job',
      cell: row => (
        <>
          <span className="cell-title">{row.job.title}</span>
          <span className="cell-sub">{row.job.company}</span>
        </>
      ),
    },
    {key: 'status', header: 'Status', width: 'shrink', cell: row => <StatusOf row={row} />},
    {key: 'applied', header: 'Applied', width: 'shrink', hideOnMobile: true, cell: row => ago(row.appliedAt)},
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

  const header = (
    <PageHeader
      title="My applications"
      description="The jobs you applied for with your email address, and where each one stands."
      actions={
        <a className={buttonClass({})} href="/jobs/">
          Find jobs
        </a>
      }
    />
  );

  if (me.isPending) {
    return (
      <div className="app-page">
        {header}
        <LoadingBlock rows={4} />
      </div>
    );
  }

  return (
    <div className="app-page">
      {header}
      {!verified ? (
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
        <>
          <Card flush>
            <DataTable
              caption="My applications"
              columns={columns}
              rows={rows}
              rowKey={row => row.id}
              loading={query.isPending}
              error={query.error}
              empty={
                <EmptyState
                  icon="briefcase"
                  title="No applications yet"
                  action={
                    <a className={buttonClass({})} href="/jobs/">
                      Find jobs
                    </a>
                  }>
                  Applications you send with this email address show here.
                </EmptyState>
              }
            />
          </Card>
          <LoadMore query={query} />
        </>
      )}
      <MyApplicationDrawer application={open} onClose={() => setOpenId(null)} />
    </div>
  );
}
