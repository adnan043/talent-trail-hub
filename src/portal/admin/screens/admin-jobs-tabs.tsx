import {Link} from '@tanstack/react-router';
import type {ReactNode} from 'react';

import {useMe} from '../../shared';
import {PageHeader} from '../../ui';

const TABS = [
  {to: '/manage/admin-jobs/post', label: 'Post a job', ability: 'manageJobs'},
  {to: '/manage/admin-jobs/applicants', label: 'Applicants', ability: 'readApplicants'},
] as const;

/**
 * The sidebar's "Admin jobs" screen: the board's OWN jobs, as tabs: Post a job · Applicants. The
 * applicants here are only those of the admin's jobs (never a company's: `staffJobWhere`). Each
 * tab is its own route, so a tab can be linked; a tab the viewer may not use is not shown.
 */
export function AdminJobsPage({className, actions, children}: {className: string; actions?: ReactNode; children: ReactNode}) {
  const abilities = useMe().data?.abilities;
  return (
    <div className={`app-page screen-own-jobs ${className}`}>
      <PageHeader title="Admin jobs" description="Jobs you post for the board, and the people who apply to them." actions={actions} />
      <nav className="tab-list settings-tabs" aria-label="Admin jobs sections">
        {TABS.filter(tab => abilities?.[tab.ability]).map(tab => (
          <Link key={tab.to} to={tab.to} className="tab" activeOptions={{exact: true, includeSearch: false}}>
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
