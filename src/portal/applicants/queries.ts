import {infiniteQueryOptions, type QueryClient, queryOptions} from '@tanstack/react-query';

import {APPLICATION_STATUSES, type ApplicationStatus} from '../../lib/board';
import type {AllApplicantsPage, ApplicantJobOption, ApplicantRow, JobApplicantsPage, ResumeLink} from '../../lib/types-apply';
import {siteFetch} from '../../platform/browser';
import {api, ApiError, read} from '../api';

/** The applicants reads (B), shared by the employer's and the admin's screens. Keys start `['applicants']`. */
export type StatusFilter = ApplicationStatus | '';

/**
 * The applicants filters in the URL (`?status=shortlisted&job=12`): the routes' `validateSearch`
 * (C, D register them) and the screens read them through this, so a bad value is just "all".
 */
export function applicantsSearch(search: Record<string, unknown>): {status?: ApplicationStatus; job?: string} {
  const status = (APPLICATION_STATUSES as readonly unknown[]).includes(search.status) ? (search.status as ApplicationStatus) : undefined;
  const job = String(search.job ?? '');
  return {...(status ? {status} : {}), ...(/^\d{1,10}$/.test(job) ? {job} : {})};
}

/** `/dashboard/employer/jobs/$id/applicants`: one job's applicants, newest first. */
export const jobApplicantsQuery = (jobId: string, status: StatusFilter) =>
  infiniteQueryOptions({
    queryKey: ['applicants', 'job', jobId, status],
    initialPageParam: '',
    queryFn: ({pageParam}) =>
      read<JobApplicantsPage>(
        api.applications.jobs[':id'].applicants.$get({param: {id: jobId}, query: {status, before: pageParam, job: ''}})
      ),
    getNextPageParam: last => (last.nextBefore ? String(last.nextBefore) : undefined),
  });

/** `/dashboard/manage/applicants`: every applicant on the board (site:applicant:read). */
export const allApplicantsQuery = (filter: {status: StatusFilter; job: string}) =>
  infiniteQueryOptions({
    queryKey: ['applicants', 'all', filter],
    initialPageParam: '',
    queryFn: ({pageParam}) =>
      read<AllApplicantsPage>(api.applications.all.$get({query: {status: filter.status, job: filter.job, before: pageParam}})),
    getNextPageParam: last => (last.nextBefore ? String(last.nextBefore) : undefined),
  });

/** Jobs with applicants, for the admin's job filter. */
export const applicantJobsQuery = queryOptions({
  queryKey: ['applicants', 'jobs'],
  queryFn: () => read<{jobs: ApplicantJobOption[]}>(api.applications.all.jobs.$get()),
  staleTime: 60_000,
});

export function updateApplicant(id: number, patch: {status?: ApplicationStatus; notes?: string}) {
  return read<{applicant: ApplicantRow}>(api.applications[':id'].$patch({param: {id: String(id)}, json: {status: patch.status, notes: patch.notes}}));
}

export function resumeLink(id: number) {
  return read<ResumeLink>(api.applications[':id']['resume-link'].$post({param: {id: String(id)}}));
}

/** Replaces one applicant in every cached applicants page (optimistic updates, results). */
export function patchCachedApplicant(queryClient: QueryClient, id: number, change: (row: ApplicantRow) => ApplicantRow) {
  queryClient.setQueriesData<{pages: {items: ApplicantRow[]}[]; pageParams: unknown[]}>({queryKey: ['applicants']}, data =>
    data?.pages
      ? {...data, pages: data.pages.map(page => ({...page, items: page.items.map(row => (row.id === id ? change(row) : row))}))}
      : data
  );
}

/** Downloads a CSV export through `siteFetch` (the session travels with it in the Preview too). */
export async function downloadCsv(path: string, fileName: string) {
  const res = await siteFetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {message?: string} | null;
    throw new ApiError(body?.message ?? `Download failed (${res.status})`, res.status);
  }
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
