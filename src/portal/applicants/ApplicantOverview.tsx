import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';

import type {ApplicationStatus} from '../../lib/board';
import {MY_APPLICATION_STATUS_LABELS} from '../../lib/types-apply';
import {missingToApply, profileCompletion, REQUIREMENT_LABELS} from '../../lib/types-profile';
import {ago} from '../shared';
import {buttonClass, Card, EmptyState, ErrorNote, Icon, type IconName, LoadingBlock, Notice, Stat, StatusBadge} from '../ui';
import {STATUS_TONES} from './ApplicantDrawer';
import {CompletionRing, ProfilePhoto} from './profile-parts';
import {applicantProfileQuery, ownPhotoUrl} from './profile-queries';
import {myApplicationsQuery} from './queries';

/**
 * The job seeker's dashboard (`/` for an applicant account): their profile at a glance, how their
 * applications stand, and the latest ones. The counts are the server's, over one person's own
 * applications (a small, indexed group).
 */
const TILES: {status: ApplicationStatus; icon: IconName; tone?: 'success' | 'info' | 'warning' | 'danger'}[] = [
  {status: 'shortlisted', icon: 'check', tone: 'info'},
  {status: 'approved', icon: 'check-circle', tone: 'success'},
  {status: 'rejected', icon: 'x', tone: 'danger'},
];

export function ApplicantOverview() {
  const answer = useQuery(applicantProfileQuery);
  const applications = useInfiniteQuery(myApplicationsQuery);
  const rows = applications.data?.pages[0]?.items;
  // Per status over all their applications (the server counts them on the first page).
  const counts = applications.data?.pages[0]?.counts ?? null;
  const profile = answer.data?.profile;
  const firstName = profile?.name.split(/\s+/)[0];

  if (answer.isPending) return <div className="app-page"><LoadingBlock rows={5} /></div>;
  if (answer.error) return <div className="app-page"><ErrorNote error={answer.error} title="Your dashboard could not load" /></div>;
  if (!profile) return null;
  const percent = profileCompletion(profile);
  const missing = missingToApply(profile);

  return (
    <div className="app-page screen-applicant-home">
      <section className="profile-hero">
        <ProfilePhoto src={ownPhotoUrl(profile.photoVersion)} name={profile.name} size="lg" />
        <div className="profile-hero-text">
          <h2>{firstName ? `Welcome back, ${firstName}` : 'Welcome back'}</h2>
          <p className="muted">{profile.headline ?? 'Add a career title so employers see what you do.'}</p>
          <div className="profile-hero-actions">
            <Link className={buttonClass()} to="/profile">
              Update profile
            </Link>
            <a className={buttonClass({variant: 'secondary'})} href="/jobs/">
              <Icon name="search" size={18} />
              Find jobs
            </a>
          </div>
        </div>
        <CompletionRing value={percent} />
      </section>

      {missing.length > 0 && (
        <Notice
          tone="warning"
          title="Finish your profile to apply"
          action={
            <Link className={buttonClass({variant: 'secondary', size: 'sm'})} to="/profile">
              Add them now
            </Link>
          }>
          Still missing: {missing.map(m => REQUIREMENT_LABELS[m]).join(', ')}.
        </Notice>
      )}

      <div className="stat-grid">
        <Stat label="Applications" value={counts ? String(Object.values(counts).reduce((a, b) => a + b, 0)) : null} icon="file" to="/my-applications" />
        {TILES.map(tile => (
          <Stat key={tile.status} label={MY_APPLICATION_STATUS_LABELS[tile.status]} value={counts ? String(counts[tile.status]) : null} icon={tile.icon} tone={tile.tone} />
        ))}
      </div>

      <Card
        title="Latest applications"
        flush
        actions={
          <Link className={buttonClass({variant: 'link', size: 'sm'})} to="/my-applications">
            See all
          </Link>
        }>
        {applications.isPending ? (
          <LoadingBlock rows={3} />
        ) : applications.error ? (
          <ErrorNote error={applications.error} />
        ) : !rows?.length ? (
          <EmptyState
            icon="briefcase"
            title="No applications yet"
            action={
              <a className={buttonClass()} href="/jobs/">
                Browse jobs
              </a>
            }>
            Find a job you like and apply with one click.
          </EmptyState>
        ) : (
          <ul className="applicant-latest">
            {rows.slice(0, 5).map(row => (
              <li key={row.id}>
                <div>
                  <p className="cell-title">{row.job.slug ? <a href={`/jobs/${row.job.slug}/`}>{row.job.title}</a> : row.job.title}</p>
                  <p className="muted small">
                    {row.job.company} · applied {ago(row.appliedAt)}
                  </p>
                </div>
                <StatusBadge tone={STATUS_TONES[row.status]}>{MY_APPLICATION_STATUS_LABELS[row.status]}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
