import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useSearch} from '@tanstack/react-router';
import {useEffect, useRef} from 'react';

import {useMe} from '../shared';
import {Button, Card, ErrorNote, Icon, LoadingBlock} from '../ui';
import {startApplicant, storeProfile} from './profile-queries';

/**
 * `/dashboard/welcome`: where a new account says what it is for. `?as=applicant` (from the sign-up
 * page) sets up the job seeker profile at once; `?as=company` goes to the post-a-job wizard.
 * `?next=` (a path on this site) is where an applicant goes afterwards, such as the job they were
 * applying to. An account that already is one or the other goes straight on.
 */

/** Only a path on this site (never `//host` or a scheme). */
export const safeNext = (value: unknown): string | null =>
  typeof value === 'string' && /^\/(?!\/)[\w\-./?=&%#]*$/.test(value) && !value.includes('..') ? value : null;

export function welcomeSearch(search: Record<string, unknown>): {as?: 'applicant' | 'company'; next?: string} {
  const as = search.as === 'applicant' || search.as === 'company' ? search.as : undefined;
  const next = safeNext(search.next) ?? undefined;
  return {...(as ? {as} : {}), ...(next ? {next} : {})};
}

export function Welcome() {
  const me = useMe();
  const search = useSearch({strict: false}) as {as?: 'applicant' | 'company'; next?: string};
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const kind = me.data?.account.kind;
  const next = search.next;

  /** Leaves the dashboard for a public page (a job), or moves inside it. */
  const go = (to: string) => {
    if (to.startsWith('/dashboard')) void navigate({to: to.slice('/dashboard'.length) || '/'});
    else window.location.assign(to);
  };

  const start = useMutation({
    mutationFn: startApplicant,
    onSuccess: answer => {
      storeProfile(queryClient, answer);
      go(next ?? '/dashboard/profile');
    },
  });

  const auto = useRef(false);
  useEffect(() => {
    if (!kind || auto.current) return;
    if (kind === 'applicant') {
      auto.current = true;
      go(next ?? '/dashboard/profile');
    } else if (kind === 'employer') {
      auto.current = true;
      void navigate({to: '/'});
    } else if (search.as === 'applicant') {
      auto.current = true;
      start.mutate();
    } else if (search.as === 'company') {
      auto.current = true;
      void navigate({to: '/post-a-job'});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, search.as]);

  if (!kind || (kind === 'none' && search.as && !start.error)) return <div className="app-page"><LoadingBlock rows={3} /></div>;

  return (
    <div className="app-page screen-welcome">
      <div className="profile-head">
        <div>
          <h2>What brings you here?</h2>
          <p className="muted">Pick one. An account is either a job seeker or a company; use another email for the other.</p>
        </div>
      </div>
      {start.error && <ErrorNote error={start.error} title="That did not work" />}
      <div className="welcome-choices">
        <Card className="welcome-choice">
          <span className="welcome-icon" aria-hidden="true">
            <Icon name="user" size={32} />
          </span>
          <h3>I am looking for a job</h3>
          <p className="muted">Build your profile with a photo and CV once, apply with one click, and follow every application’s status.</p>
          <Button pending={start.isPending} pendingLabel="Setting up…" onClick={() => start.mutate()}>
            Set up my job seeker profile
          </Button>
        </Card>
        <Card className="welcome-choice">
          <span className="welcome-icon" aria-hidden="true">
            <Icon name="briefcase" size={32} />
          </span>
          <h3>I am hiring</h3>
          <p className="muted">Create your company profile, post jobs and review the people who apply.</p>
          <Button variant="secondary" onClick={() => void navigate({to: '/post-a-job'})}>
            Post a job
          </Button>
        </Card>
      </div>
    </div>
  );
}
