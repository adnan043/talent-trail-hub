import {keepPreviousData, useInfiniteQuery, useMutation, useQuery} from '@tanstack/react-query';
import {useNavigate, useParams, useSearch} from '@tanstack/react-router';
import {type ReactNode, useState} from 'react';

import {APPLICATION_STATUSES} from '../../lib/board';
import {APPLICATION_STATUS_LABELS, type ApplicantRow} from '../../lib/types-apply';
import {ago} from '../shared';
import {
  Button,
  Card,
  type Column,
  DataTable,
  EmptyState,
  LoadMore,
  Menu,
  type MenuItem,
  PageHeader,
  Person,
  SegmentedControl,
  Select,
  StatusBadge,
  useToast,
} from '../ui';
import {ApplicantDrawer, STATUS_TONES, useApplicantStatus, useResumeDownload} from './ApplicantDrawer';
import {allApplicantsQuery, applicantJobsQuery, applicantsSearch, downloadCsv, jobApplicantsQuery, type StatusFilter} from './queries';

/**
 * The applicants screens, shared by the employer area (one job's applicants, own company only)
 * and the admin (`/dashboard/manage/applicants`, every company). Workstream B builds them;
 * C and D only register the routes (docs/MIGRATION.md). The server enforces who sees what.
 */

const STATUS_FILTERS: {value: StatusFilter; label: string}[] = [
  {value: '', label: 'All'},
  ...APPLICATION_STATUSES.map(value => ({value, label: APPLICATION_STATUS_LABELS[value]})),
];

function useCsv() {
  const toast = useToast();
  return useMutation({
    mutationFn: ({path, name}: {path: string; name: string}) => downloadCsv(path, name),
    onError: error => toast.danger(error.message),
  });
}

/** The table, the drawer and the row actions, for either list. */
function ApplicantsTable({
  rows,
  query,
  withJob,
  filtered,
  emptyAction,
}: {
  rows: ApplicantRow[] | undefined;
  query: {isPending: boolean; error: Error | null; hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown; isPlaceholderData?: boolean};
  withJob?: boolean;
  filtered: boolean;
  /** The empty state's one action: "Show all" when filtered, else what brings applicants. */
  emptyAction?: ReactNode;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const status = useApplicantStatus();
  const download = useResumeDownload();
  const busyKey = (status.isPending && status.variables?.id) || (download.isPending && download.variables) || null;
  // The drawer shows the CACHED row, so an optimistic status change shows there at once.
  const open = rows?.find(row => row.id === openId) ?? null;

  const menu = (row: ApplicantRow): MenuItem[] => [
    ...APPLICATION_STATUSES.filter(s => s !== row.status).map(s => ({
      label: `Mark ${APPLICATION_STATUS_LABELS[s].toLowerCase()}`,
      onSelect: () => status.mutate({id: row.id, status: s, previous: row.status}),
    })),
    'separator' as const,
    {
      label: 'Download resume',
      icon: 'file' as const,
      disabled: !row.resumeFileName || row.resumeExpired,
      onSelect: () => download.mutate(row.id),
    },
  ];

  const columns: Column<ApplicantRow>[] = [
    {
      key: 'who',
      header: 'Applicant',
      cell: row => <Person name={row.name} detail={row.email} />,
    },
    ...(withJob
      ? [{key: 'job', header: 'Job', hideOnMobile: true, cell: (row: ApplicantRow) => (row.job ? `${row.job.title} · ${row.job.company}` : '—')}]
      : []),
    {
      key: 'status',
      header: 'Status',
      width: 'shrink',
      cell: row => <StatusBadge tone={STATUS_TONES[row.status]}>{APPLICATION_STATUS_LABELS[row.status]}</StatusBadge>,
    },
    {
      key: 'resume',
      header: 'Resume',
      hideOnMobile: true,
      cell: row => (row.resumeExpired ? <span className="muted">Deleted (privacy policy)</span> : (row.resumeFileName ?? <span className="muted">None</span>)),
    },
    {key: 'applied', header: 'Applied', width: 'shrink', cell: row => ago(row.appliedAt)},
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: row => (
        <div className="row-actions">
          <Button variant="secondary" size="sm" disabled={busyKey === row.id} onClick={() => setOpenId(row.id)}>
            View
          </Button>
          <Menu label={`Actions for ${row.name}`} items={menu(row)} disabled={busyKey === row.id} />
        </div>
      ),
    },
  ];

  return (
    <>
      <Card flush>
        <DataTable
          caption="Applicants"
          columns={columns}
          rows={rows}
          rowKey={row => row.id}
          loading={query.isPending}
          error={query.error}
          busyKey={busyKey}
          empty={
            <EmptyState icon="users" title={filtered ? 'No applicants match these filters' : 'No applicants yet'} action={emptyAction}>
              {filtered ? 'Show every applicant, or pick another filter.' : 'Applications show here as candidates apply.'}
            </EmptyState>
          }
        />
      </Card>
      <LoadMore query={query} />
      <ApplicantDrawer applicant={open} onClose={() => setOpenId(null)} />
    </>
  );
}

/** The filters live in the URL (shareable, kept on reload and back); `replace` keeps history short. */
function useUrlFilters() {
  const search = applicantsSearch(useSearch({strict: false}) as Record<string, unknown>);
  const navigate = useNavigate();
  const filter = {status: (search.status ?? '') as StatusFilter, job: search.job ?? ''};
  const setFilter = (next: {status: StatusFilter; job: string}) =>
    void navigate({
      to: '.',
      search: {...(next.status ? {status: next.status} : {}), ...(next.job ? {job: next.job} : {})},
      replace: true,
    } as never);
  return [filter, setFilter] as const;
}

/** Copies the job's public page address, to share it where candidates are. */
function CopyJobLink({slug}: {slug: string}) {
  const toast = useToast();
  const copy = useMutation({
    mutationFn: () => navigator.clipboard.writeText(new URL(`/jobs/${encodeURIComponent(slug)}/`, window.location.origin).href),
    onSuccess: () => toast.success('Job link copied.'),
    onError: () => toast.danger('The link could not be copied. Open the job page and copy its address.'),
  });
  return (
    <Button icon="copy" pending={copy.isPending} pendingLabel="Copying…" onClick={() => copy.mutate()}>
      Copy job link
    </Button>
  );
}

/** `/dashboard/employer/jobs/$id/applicants` (C registers it): one job's applicants. */
export function JobApplicants() {
  const {id = ''} = useParams({strict: false}) as {id?: string};
  const [{status}, setFilters] = useUrlFilters();
  const setStatus = (next: StatusFilter) => setFilters({status: next, job: ''});
  // A status change keeps the last rows on screen while it loads; another job never shows this one's.
  const list = useInfiniteQuery({...jobApplicantsQuery(id, status), placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === id ? previous : undefined)});
  const csv = useCsv();
  const job = list.data?.pages[0]?.job;
  const rows = list.data?.pages.flatMap(page => page.items);
  return (
    <div className="app-page screen-applicants">
      <PageHeader
        title={job ? `Applicants for ${job.title}` : 'Applicants'}
        description="Status saves at once. Resume links work for 10 minutes. The CSV has no files or links."
        actions={
          <Button
            icon="file"
            disabled={!rows?.length}
            pending={csv.isPending}
            pendingLabel="Preparing CSV…"
            onClick={() =>
              csv.mutate({
                path: `/site-api/applications/jobs/${encodeURIComponent(id)}/applicants/export?status=${status}`,
                name: `applicants-${job?.slug ?? id}.csv`,
              })
            }>
            Download CSV
          </Button>
        }
      />
      <div className="toolbar">
        <SegmentedControl label="Filter by status" options={STATUS_FILTERS} value={status} onChange={setStatus} />
      </div>
      <ApplicantsTable
        rows={rows}
        query={list}
        filtered={status !== ''}
        emptyAction={
          status !== '' ? (
            <Button variant="secondary" onClick={() => setStatus('')}>
              Show all
            </Button>
          ) : job ? (
            <CopyJobLink slug={job.slug} />
          ) : undefined
        }
      />
    </div>
  );
}

/** `/dashboard/manage/applicants` (D registers it): every job's applicants, admin only. */
export function AllApplicants() {
  const [filter, setFilters] = useUrlFilters();
  const setFilter = (change: (f: typeof filter) => typeof filter) => setFilters(change(filter));
  // The last list stays on screen while a new filter loads (no flash of the empty skeleton).
  const list = useInfiniteQuery({...allApplicantsQuery(filter), placeholderData: keepPreviousData});
  const jobs = useQuery(applicantJobsQuery);
  const csv = useCsv();
  const rows = list.data?.pages.flatMap(page => page.items);
  const filtered = filter.status !== '' || filter.job !== '';
  const jobOptions = [
    {value: '', label: 'All jobs'},
    ...(jobs.data?.jobs.map(j => ({value: String(j.id), label: `${j.title} · ${j.company} (${j.applicationCount})`})) ?? []),
  ];
  return (
    <div className="app-page screen-applicants">
      <PageHeader
        title="Applicants"
        description="Every job’s applicants, newest first. Each resume you download is logged."
        actions={
          <Button
            icon="file"
            disabled={!rows?.length}
            pending={csv.isPending}
            pendingLabel="Preparing CSV…"
            onClick={() => csv.mutate({path: `/site-api/applications/all/export?status=${filter.status}&job=${filter.job}`, name: 'applicants.csv'})}>
            Download CSV
          </Button>
        }
      />
      <div className="toolbar">
        <SegmentedControl label="Filter by status" options={STATUS_FILTERS} value={filter.status} onChange={status => setFilter(f => ({...f, status}))} />
        <Select aria-label="Filter by job" options={jobOptions} value={filter.job} onChange={event => setFilter(f => ({...f, job: event.target.value}))} />
      </div>
      <ApplicantsTable
        rows={rows}
        query={list}
        withJob
        filtered={filtered}
        emptyAction={
          filtered ? (
            <Button variant="secondary" onClick={() => setFilters({status: '', job: ''})}>
              Show all
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
