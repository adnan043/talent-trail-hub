import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';

import {useMe} from '../shared';
import {buttonClass, Card, EmptyState, ErrorNote, LoadingBlock, Stat} from '../ui';
import {bounded, money} from './format';
import {moderationQuery, overviewQuery} from './queries';

/** The admin's part of the dashboard overview: board numbers (F19), what needs review, top jobs. */
export function AdminOverviewPanel() {
  const me = useMe();
  const can = me.data?.abilities;
  const overview = useQuery({...overviewQuery, enabled: Boolean(can?.readBoardReports)});
  const queue = useInfiniteQuery({...moderationQuery, enabled: Boolean(can?.moderateJobs)});
  const o = overview.data;
  const waiting = queue.data?.pages[0]?.items ?? [];

  return (
    <>
      {can?.readBoardReports && (
        <div className="stat-grid">
          <Stat label="Revenue, 30 days" icon="zap" value={o ? `${money(o.revenue30d.value, o.currency)}${o.revenue30d.more ? '+' : ''}` : null} hint={o ? `${money(o.revenueAll.value, o.currency)}${o.revenueAll.more ? '+' : ''} all time` : undefined} />
          <Stat label="Paid orders" icon="inbox" value={bounded(o?.paidOrders)} />
          <Stat label="Waiting for review" icon="clock" value={bounded(o?.pendingApprovals)} to="/manage/moderation" />
          <Stat label="Live jobs" icon="briefcase" value={bounded(o?.activeJobs)} to="/manage/jobs" />
          <Stat label="Applications, 30 days" icon="users" value={bounded(o?.applications30d)} />
        </div>
      )}
      {overview.error && <ErrorNote error={overview.error} />}
      <div className="grid-2">
        {can?.moderateJobs && (
          <Card
            title="Needs review"
            description="Jobs waiting for approval, oldest first."
            flush
            footer={
              <Link className={buttonClass({variant: 'link'})} to="/manage/moderation">
                View all
              </Link>
            }>
            {queue.isPending ? (
              <LoadingBlock rows={3} />
            ) : queue.error ? (
              <ErrorNote error={queue.error} />
            ) : waiting.length ? (
              <ul className="list">
                {waiting.slice(0, 5).map(item => (
                  <li key={item.id} className="list-row">
                    <div className="list-row-text">
                      <p className="list-row-title">
                        <Link to="/manage/moderation/$id" params={{id: String(item.id)}}>
                          {item.title}
                        </Link>
                      </p>
                      <p className="list-row-sub">{item.company.name}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="check-circle" title="All caught up">
                New jobs show here when employers submit them.
              </EmptyState>
            )}
          </Card>
        )}
        {can?.readBoardReports && (
          <Card title="Top jobs" description="Live jobs with the most views." flush>
            {overview.isPending ? (
              <LoadingBlock rows={3} />
            ) : overview.error ? (
              <ErrorNote error={overview.error} />
            ) : o?.topJobs.length ? (
              <ul className="list">
                {o.topJobs.map(job => (
                  <li key={job.id} className="list-row">
                    <div className="list-row-text">
                      <p className="list-row-title">
                        <a href={`/jobs/${job.slug}/`}>{job.title}</a>
                      </p>
                      <p className="list-row-sub">{job.company}</p>
                    </div>
                    <span className="list-row-end muted">
                      {job.views} views · {job.applicants} applicants
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="briefcase" title="No live jobs yet">
                Views show here once jobs are live.
              </EmptyState>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
