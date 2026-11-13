import {keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {type FormEvent, useState} from 'react';

import {JOB_SOURCES, JOB_STATUSES} from '../../../lib/board';
import type {AdminJobFilters, AdminJobRow, TaskRun} from '../../../lib/types-manage';
import {MANAGE_LIMITS} from '../../../lib/types-manage';
import {api, ApiError, read} from '../../api';
import {
  Badge,
  Button,
  buttonClass,
  Card,
  type Column,
  DataTable,
  EmptyState,
  ErrorNote,
  Field,
  LoadMore,
  Menu,
  type MenuItem,
  Modal,
  PageHeader,
  rules,
  SearchInput,
  Select,
  StatusBadge,
  useConfirm,
  useForm,
  useToast,
} from '../../ui';
import {day, JOB_STATUS_TONES, jobStatusLabel, SOURCE_LABELS} from '../format';
import {adminJobsQuery, invalidateAdminJobs, jobFormOptionsQuery, NO_JOB_FILTERS} from '../queries';

const days = (max: number) => [rules.required('Enter a number of days.'), rules.wholeNumber(), (v: string) => (Number(v) >= 1 && Number(v) <= max ? null : `Pick 1 to ${max} days.`)];

/** `/manage/jobs` (site:job:manage): every job, filtered; feature, extend, close, delete; run expiry (F21). */
export function Jobs() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const urlSearch = useSearch({from: '/manage/jobs'});
  const filters: AdminJobFilters = {...NO_JOB_FILTERS, ...urlSearch};
  const setFilters = (next: AdminJobFilters) =>
    void navigate({to: '/manage/jobs', search: Object.fromEntries(Object.entries(next).filter(([, v]) => v !== '')), replace: true});
  const [q, setQ] = useState(filters.q);
  const categories = useQuery(jobFormOptionsQuery).data?.categories ?? [];
  const [asking, setAsking] = useState<{job: AdminJobRow; kind: 'feature' | 'extend'} | null>(null);
  // The last list stays on screen while a new filter loads (no flash of the empty skeleton).
  const jobs = useInfiniteQuery({...adminJobsQuery(filters), placeholderData: keepPreviousData});
  const rows = jobs.data?.pages.flatMap(page => page.jobs);
  // Featuring changes only the job; anything else changes its status too (queue, dashboard numbers).
  const refresh = (status: boolean) => invalidateAdminJobs(queryClient, {status});

  const act = useMutation({
    mutationFn: async ({job, action}: {job: AdminJobRow; action: 'unfeature' | 'close' | 'delete'}) => {
      const param = {id: String(job.id)};
      if (action === 'unfeature') return read(api.manage.jobs[':id'].feature.$post({param, json: {featured: false, days: null}}));
      if (action === 'close') return read(api.manage.jobs[':id'].close.$post({param}));
      return read(api.manage.jobs[':id'].$delete({param}));
    },
    onSuccess: (_, {action}) => {
      void refresh(action !== 'unfeature');
      // A deleted job takes its applications with it.
      if (action === 'delete') void queryClient.invalidateQueries({queryKey: ['applicants']});
    },
  });
  const expiry = useMutation({
    mutationFn: () => read<TaskRun>(api.manage.jobs['run-expiry'].$post()),
    onSuccess: result => {
      toast.success(result.message);
      void refresh(true);
    },
    onError: err => toast.danger(err.message),
  });
  const busyId = act.isPending ? (act.variables?.job.id ?? null) : null;

  const ask = async (job: AdminJobRow, action: 'unfeature' | 'close' | 'delete') => {
    const words = {
      unfeature: {title: `Stop featuring “${job.title}”?`, body: 'It stays live, without the featured pin.', confirmLabel: 'Stop featuring', tone: 'primary' as const, done: 'No longer featured.'},
      close: {title: `Close “${job.title}”?`, body: 'It leaves the board at once. You can extend it later to list it again.', confirmLabel: 'Close job', tone: 'danger' as const, done: 'Job closed.'},
      delete: {title: `Delete “${job.title}”?`, body: 'The job, its applications and their resumes are deleted for good. Orders keep their record.', confirmLabel: 'Delete job', tone: 'danger' as const, done: 'Job deleted.'},
    }[action];
    if (await confirm({...words, pendingLabel: 'Working…', action: () => act.mutateAsync({job, action})})) toast.success(words.done);
  };

  const columns: Column<AdminJobRow>[] = [
    {
      key: 'job',
      header: 'Job',
      cell: job => (
        <span>
          <a className="cell-title" href={`/jobs/${job.slug}/`}>
            {job.title}
          </a>
          <span className="cell-sub">
            {job.company} · {job.category}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'shrink',
      cell: job => (
        <span className="badges">
          <StatusBadge tone={JOB_STATUS_TONES[job.status]}>{jobStatusLabel(job.status)}</StatusBadge>
          {job.featured && <Badge tone="brand">Featured</Badge>}
          {job.needsReview && <Badge tone="warning">Changes in review</Badge>}
        </span>
      ),
    },
    {key: 'source', header: 'Source', width: 'shrink', hideOnMobile: true, cell: job => SOURCE_LABELS[job.source]},
    {key: 'ends', header: 'Ends', width: 'shrink', hideOnMobile: true, cell: job => day(job.expiresAt)},
    {key: 'numbers', header: 'Views / applicants', width: 'shrink', hideOnMobile: true, cell: job => `${job.views} / ${job.applicants}`},
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: job => {
        const items: MenuItem[] = [];
        if (job.actions.edit) items.push({label: 'Edit', icon: 'pencil', onSelect: () => void navigate({to: '/manage/jobs/$id', params: {id: String(job.id)}})});
        if (job.actions.feature && !job.needsReview)
          items.push(job.featured ? {label: 'Stop featuring', icon: 'x', onSelect: () => void ask(job, 'unfeature')} : {label: 'Feature', icon: 'zap', onSelect: () => setAsking({job, kind: 'feature'})});
        if (job.actions.extend && !job.needsReview) items.push({label: job.status === 'published' ? 'Extend' : 'List again', icon: 'clock', onSelect: () => setAsking({job, kind: 'extend'})});
        if (job.actions.close) items.push({label: 'Close', icon: 'ban', danger: true, onSelect: () => void ask(job, 'close')});
        items.push('separator', {label: 'Delete', icon: 'trash', danger: true, onSelect: () => void ask(job, 'delete')});
        return <Menu label={`Actions for ${job.title}`} items={items} disabled={busyId !== null} />;
      },
    },
  ];

  const set = <K extends keyof AdminJobFilters>(key: K, value: AdminJobFilters[K]) => setFilters({...filters, [key]: value});
  const search = (event: FormEvent) => {
    event.preventDefault();
    set('q', q.trim());
  };
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_JOB_FILTERS);

  return (
    <div className="app-page screen-admin-jobs">
      <PageHeader
        title="All jobs"
        description="Every job on the board. Employer jobs can be featured, extended or closed, not edited."
        actions={
          <>
            <Button variant="secondary" icon="refresh" pending={expiry.isPending} pendingLabel="Running…" onClick={() => expiry.mutate()}>
              Run expiry now
            </Button>
            <Link className={buttonClass()} to="/manage/jobs/new">
              Post an admin job
            </Link>
          </>
        }
      />
      <div className="toolbar">
        <form role="search" onSubmit={search} noValidate>
          <SearchInput label="Search job titles" placeholder="Title, then Enter" value={q} maxLength={100} onChange={e => setQ(e.target.value)} />
        </form>
        <div className="toolbar-group">
          <Select aria-label="Status" value={filters.status} onChange={e => set('status', e.target.value as AdminJobFilters['status'])} options={[{value: '', label: 'Any status'}, ...JOB_STATUSES.map(s => ({value: s, label: jobStatusLabel(s)}))]} />
          <Select aria-label="Category" value={filters.category} onChange={e => set('category', e.target.value)} options={[{value: '', label: 'Any category'}, ...categories.map(c => ({value: String(c.id), label: c.name}))]} />
          <Select aria-label="Source" value={filters.source} onChange={e => set('source', e.target.value as AdminJobFilters['source'])} options={[{value: '', label: 'Any source'}, ...JOB_SOURCES.map(s => ({value: s, label: SOURCE_LABELS[s]}))]} />
          <Select aria-label="Featured" value={filters.featured} onChange={e => set('featured', e.target.value as AdminJobFilters['featured'])} options={[{value: '', label: 'Featured or not'}, {value: 'yes', label: 'Featured'}, {value: 'no', label: 'Not featured'}]} />
        </div>
      </div>
      <Card flush>
        <DataTable
          caption="Jobs"
          columns={columns}
          rows={rows}
          rowKey={job => job.id}
          loading={jobs.isPending}
          error={jobs.error}
          busyKey={busyId}
          empty={
            filtered ? (
              <EmptyState icon="search" title="No jobs match" action={<Button variant="secondary" onClick={() => { setQ(''); setFilters(NO_JOB_FILTERS); }}>Show all jobs</Button>}>
                Try other filters.
              </EmptyState>
            ) : (
              <EmptyState icon="briefcase" title="No jobs yet" action={<Link className={buttonClass()} to="/manage/jobs/new">Post an admin job</Link>}>
                Jobs show here as employers post them.
              </EmptyState>
            )
          }
        />
      </Card>
      {jobs.error && rows?.length ? <ErrorNote error={jobs.error} /> : null}
      <LoadMore query={jobs} />
      {asking && <DaysDialog key={asking.job.id} {...asking} onClose={() => setAsking(null)} onDone={message => { setAsking(null); toast.success(message); void refresh(asking.kind === 'extend'); }} />}
    </div>
  );
}

function DaysDialog({job, kind, onClose, onDone}: {job: AdminJobRow; kind: 'feature' | 'extend'; onClose: () => void; onDone: (message: string) => void}) {
  const max = MANAGE_LIMITS.extendDaysMax;
  const form = useForm({days: String(MANAGE_LIMITS.featureDaysDefault)}, {days: days(max)});
  const save = useMutation({
    mutationFn: (n: number) =>
      kind === 'feature'
        ? read(api.manage.jobs[':id'].feature.$post({param: {id: String(job.id)}, json: {featured: true, days: n}}))
        : read(api.manage.jobs[':id'].extend.$post({param: {id: String(job.id)}, json: {days: n}})),
    onSuccess: () => onDone(kind === 'feature' ? `“${job.title}” is featured.` : `“${job.title}” is extended.`),
    onError: err => err instanceof ApiError && form.setServerErrors(err.fields),
  });
  const submit = form.submit(v => save.mutate(Number(v.days)));
  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!save.isPending}
      size="sm"
      title={kind === 'feature' ? `Feature “${job.title}”` : job.status === 'published' ? `Extend “${job.title}”` : `List “${job.title}” again`}
      description={kind === 'feature' ? 'Pinned at the top of the board for this many days.' : job.status === 'published' ? 'Added to its current end date.' : 'Live again from today for this many days.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button pending={save.isPending} pendingLabel="Saving…" onClick={submit}>{kind === 'feature' ? 'Feature' : 'Extend'}</Button>
        </>
      }>
      <form className="form-stack" noValidate onSubmit={submit}>
        <Field label="Days" id="f-days" error={form.error('days')} hint={`1 to ${max}.`}>
          <input {...form.field('days')} inputMode="numeric" placeholder="30" />
        </Field>
        {save.error && !(save.error instanceof ApiError && Object.keys(save.error.fields).length) && <ErrorNote error={save.error} />}
      </form>
    </Modal>
  );
}
