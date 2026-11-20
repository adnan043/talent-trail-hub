import {keepPreviousData, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate, useParams} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';

import {LIMITS} from '../../../lib/board';
import {EMPTY_JOB_VALUES, type JobValues} from '../../../lib/job-input';
import {EMPLOYER_JOB_NOTE} from '../../../lib/types-manage';
import {api, ApiError, read} from '../../api';
import {JobForm} from '../../board/JobForm';
import {buttonClass, Combobox, EmptyState, ErrorNote, Field, LoadingBlock, Notice, PageHeader, rules, useForm, useToast} from '../../ui';
import {adminJobQuery, companiesQuery, invalidateAdminJobs, jobFormOptionsQuery} from '../queries';
import {AdminJobsPage} from './admin-jobs-tabs';

const fieldsOf = (err: unknown) => (err instanceof ApiError ? err.fields : undefined);
const statusOf = (err: unknown) => (err && !(err instanceof ApiError && Object.keys(err.fields).length) ? <ErrorNote error={err as Error} /> : null);

/** The picker's options: a new company, the found ones, and the chosen one when the search left it out. */
function companyOptions(found: {id: number; name: string}[], selected: string, chosen: {current: {id: number; name: string} | null}) {
  const pick = found.find(c => String(c.id) === selected);
  if (pick) chosen.current = pick;
  if (!selected) chosen.current = null;
  const kept = chosen.current && !pick && String(chosen.current.id) === selected ? [chosen.current] : [];
  return [{value: '', label: 'A new company (name it below)'}, ...[...kept, ...found].map(c => ({value: String(c.id), label: c.name}))];
}

/** `/manage/admin-jobs/post` (site:job:manage, Admin jobs · Post a job tab): a free admin job, live at once (F21). */
export function NewAdminJob() {
  const options = useQuery(jobFormOptionsQuery);
  // The picker lists 50 companies at a time: a search narrows it on the server (by name).
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const companies = useQuery({...companiesQuery(q), placeholderData: keepPreviousData});
  // The chosen company stays in the list when a later search doesn't find it.
  const chosen = useRef<{id: number; name: string} | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const locked = companies.data?.locked ?? null;
  // The company and listing fields: their own small form, checked when the JobForm submits.
  const latest = useRef({companyId: '', newCompanyName: '', durationDays: '30'});
  const meta = useForm(latest.current, {
    companyId: [v => (locked || v || latest.current.newCompanyName.trim() ? null : 'Choose a company, or name a new one below.')],
    newCompanyName: [rules.maxLength(LIMITS.companyName)],
    durationDays: [rules.required('Enter a number of days.'), rules.wholeNumber(), v => (Number(v) >= 1 && Number(v) <= LIMITS.tierDaysMax ? null : `Pick 1 to ${LIMITS.tierDaysMax} days.`)],
  });
  latest.current = meta.values;

  const create = useMutation({
    mutationFn: (values: JobValues) => {
      const v = meta.values;
      return read<{id: number; slug: string}>(
        api.manage.jobs.$post({json: {values, companyId: locked ? locked.id : v.companyId ? Number(v.companyId) : null, newCompanyName: v.companyId ? '' : v.newCompanyName.trim(), durationDays: Number(v.durationDays)}})
      );
    },
    onSuccess: job => {
      toast.success('The job is live.');
      // Live at once: the jobs list, the dashboard's numbers, and the company picker (a new company).
      void queryClient.invalidateQueries({queryKey: ['manage', 'jobs', 'list']});
      void queryClient.invalidateQueries({queryKey: ['manage', 'overview']});
      void queryClient.invalidateQueries({queryKey: ['manage', 'companies']});
      void navigate({to: '/manage/jobs/$id', params: {id: String(job.id)}});
    },
    onError: err => {
      const fields = fieldsOf(err) ?? {};
      meta.setServerErrors({companyId: fields.companyId, newCompanyName: fields.newCompanyName, durationDays: fields.durationDays});
    },
  });
  const submit = (values: JobValues) => meta.submit(() => create.mutate(values))();

  if (options.isPending || companies.isPending) return <AdminJobsPage className="screen-admin-job"><LoadingBlock rows={6} /></AdminJobsPage>;
  if (options.error || companies.error) return <AdminJobsPage className="screen-admin-job"><ErrorNote error={(options.error ?? companies.error)!} /></AdminJobsPage>;

  return (
    <AdminJobsPage className="screen-admin-job">
      <JobForm
        initial={EMPTY_JOB_VALUES}
        categories={options.data.categories.filter(c => c.active)}
        currency={options.data.currency}
        onSubmit={submit}
        pending={create.isPending}
        pendingLabel="Posting…"
        submitLabel="Post the job"
        sectioned
        note="Free, and live straight away: no review for admin jobs. You can edit it later."
        lead={{
          title: 'Company and listing',
          description: 'Pick a company already on the board, or name a new one, and how long it stays live.',
          content: (
            <>
          {locked ? (
            <Notice tone="info">Single-company board: this job is posted for {locked.name}.</Notice>
          ) : (
            <>
              <Field label="Company" id="f-companyId" error={meta.error('companyId')} hint="Companies without an employer account (an employer posts for their own).">
                <Combobox
                  {...meta.field('companyId')}
                  options={companyOptions(companies.data.companies, meta.values.companyId, chosen)}
                  onQueryChange={setSearch}
                  placeholder="Search companies"
                  emptyLabel="No company by that name."
                />
              </Field>
              {!meta.values.companyId && (
                <Field label="New company name" id="f-newCompanyName" error={meta.error('newCompanyName')} optional>
                  <input {...meta.field('newCompanyName')} placeholder="Acme Inc." />
                </Field>
              )}
            </>
          )}
          <Field label="Days live" id="f-durationDays" error={meta.error('durationDays')} hint={`1 to ${LIMITS.tierDaysMax}.`}>
            <input {...meta.field('durationDays')} inputMode="numeric" placeholder="30" />
          </Field>
            </>
          ),
        }}
        serverErrors={fieldsOf(create.error)}
        secondary={<Link className={buttonClass({variant: 'secondary'})} to="/manage/jobs" disabled={create.isPending}>Cancel</Link>}
        status={statusOf(create.error)}
      />
    </AdminJobsPage>
  );
}

/** `/manage/jobs/$id` (site:job:manage): edit an admin or import job; employer jobs are read-only here. */
export function EditAdminJob() {
  const {id} = useParams({from: '/manage/jobs/$id'});
  const job = useQuery(adminJobQuery(id));
  const options = useQuery(jobFormOptionsQuery);
  const queryClient = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (values: JobValues) => read(api.manage.jobs[':id'].$put({param: {id}, json: {values}})),
    onSuccess: () => {
      toast.success('Job saved.');
      // The list and this job; the form options under the same prefix did not change.
      void invalidateAdminJobs(queryClient, {status: false});
    },
  });

  if (job.isPending || options.isPending) return <div className="app-page"><LoadingBlock rows={6} /></div>;
  if (job.error) {
    return (
      <div className="app-page">
        <EmptyState icon="alert" title="This job could not load" action={<Link className={buttonClass({variant: 'secondary'})} to="/manage/jobs">Back to all jobs</Link>}>
          {job.error.message}
        </EmptyState>
      </div>
    );
  }
  if (options.error) return <div className="app-page"><ErrorNote error={options.error} /></div>;
  const data = job.data;

  return (
    <div className="app-page screen-admin-job">
      <PageHeader
        title={data.title}
        description={`${data.company.name} · ${data.source} job`}
        actions={<a className={buttonClass({variant: 'secondary'})} href={`/jobs/${data.slug}/`}>View on the board</a>}
      />
      {data.actions.edit ? (
        <JobForm
          key={data.id}
          initial={{...EMPTY_JOB_VALUES, ...data.values} as JobValues}
          // Active categories, and the job's own one although it was hidden since (kept unchanged).
          categories={options.data.categories.filter(c => c.active || String(c.id) === String(data.values.categoryId))}
          currency={data.salaryCurrency ?? options.data.currency}
          onSubmit={values => save.mutate(values)}
          pending={save.isPending}
          serverErrors={fieldsOf(save.error)}
          submitLabel="Save changes"
          sectioned
          secondary={<Link className={buttonClass({variant: 'secondary'})} to="/manage/jobs" disabled={save.isPending}>Back</Link>}
          status={statusOf(save.error)}
        />
      ) : (
        <Notice tone="info" title="Read only" action={<Link className={buttonClass({variant: 'secondary'})} to="/manage/jobs">Back to all jobs</Link>}>
          {EMPLOYER_JOB_NOTE} You can still feature, extend, close or delete it from All jobs.
        </Notice>
      )}
    </div>
  );
}
