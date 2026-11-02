import {useInfiniteQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';

import {JOB_STATUS_LABELS} from '../../lib/board';
import {pageCount} from '../shared';
import {buttonClass, Card, EmptyState, ErrorNote, LoadingBlock, Stat, StatusBadge} from '../ui';
import {myJobsQuery} from './queries';
import {STATUS_TONES} from './status';

/**
 * The employer's part of the dashboard overview (workstream C): cheap numbers from the FIRST
 * page of "My jobs" (never a count query) and the latest jobs, with "Post a job".
 */
export function EmployerOverviewPanel() {
  const jobs = useInfiniteQuery(myJobsQuery);
  const first = jobs.data?.pages[0];
  const items = first?.items;
  const more = Boolean(first?.nextBefore);
  const live = items?.filter(j => j.status === 'published');
  const applicants = live?.reduce((sum, j) => sum + j.applicants, 0);
  // Nothing posted yet and nothing to show: a short invitation, not a panel of zeros.
  if (items && items.length === 0) {
    return (
      <Card title="Hiring">
        <EmptyState
          icon="briefcase"
          title="Post your first job"
          action={
            <Link className={buttonClass()} to="/post-a-job">
              Post a job
            </Link>
          }>
          Reach candidates on this board. Your jobs, applicants and receipts show here.
        </EmptyState>
      </Card>
    );
  }
  return (
    <>
      <div className="stat-grid">
        <Stat label="Live jobs" icon="briefcase" value={live ? pageCount(live, more) : null} to="/employer/jobs" />
        <Stat label="Applicants on live jobs" icon="users" value={applicants === undefined ? null : `${applicants}${more ? '+' : ''}`} to="/employer/jobs" />
        <Stat label="In review" icon="clock" value={items ? pageCount(items.filter(j => j.status === 'pending_review'), more) : null} to="/employer/jobs" />
      </div>
      <Card
        title="Your latest jobs"
        actions={
          <Link className={buttonClass({variant: 'secondary', size: 'sm'})} to="/post-a-job">
            Post a job
          </Link>
        }
        footer={<Link to="/employer/jobs">View all</Link>}>
        {jobs.isPending ? (
          <LoadingBlock rows={3} />
        ) : jobs.error ? (
          <ErrorNote error={jobs.error} />
        ) : (
          <ul className="list">
            {items!.slice(0, 5).map(job => (
              <li key={job.id} className="list-row">
                <span className="list-row-text">
                  <Link className="list-row-title" to="/employer/jobs/$id/applicants" params={{id: String(job.id)}}>
                    {job.title}
                  </Link>
                  <span className="list-row-sub">
                    {job.applicants} applicant{job.applicants === 1 ? '' : 's'}
                    {job.daysLeft !== null ? ` · ${job.daysLeft} days left` : ''}
                  </span>
                </span>
                <span className="list-row-end">
                  <StatusBadge tone={STATUS_TONES[job.status]}>{JOB_STATUS_LABELS[job.status]}</StatusBadge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
