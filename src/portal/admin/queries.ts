import {infiniteQueryOptions, queryOptions} from '@tanstack/react-query';

import type {
  ActivityRange,
  AdminBoardMode,
  AdminBranding,
  AdminCompanies,
  AdminJobDetail,
  AdminJobFilters,
  AdminJobFormOptions,
  AdminJobsPage,
  AdminModerationMode,
  AdminTiers,
  EmailLogPage,
  EmailLogStatus,
  ManageActivity,
  ManageOverview,
  ModerationDetail,
  ModerationQueue,
} from '../../lib/types-manage';
import {api, read} from '../api';

/**
 * The admin area's reads (`/site-api/manage/*`), shared by the screens and their route loaders.
 * Keys start with `['manage', <area>]`: a save invalidates its area's prefix.
 */
const m = api.manage;

export const overviewQuery = queryOptions({
  queryKey: ['manage', 'overview'],
  queryFn: () => read<ManageOverview>(m.overview.$get()),
});

export const activityQuery = (range: ActivityRange) =>
  queryOptions({
    queryKey: ['manage', 'overview', 'activity', range],
    queryFn: () => read<ManageActivity>(m.overview.activity.$get({query: {range}})),
    staleTime: 60_000,
  });

export const moderationQuery = infiniteQueryOptions({
  queryKey: ['manage', 'moderation', 'queue'],
  initialPageParam: undefined as string | undefined,
  queryFn: ({pageParam}) => read<ModerationQueue>(m.moderation.$get({query: {after: pageParam ?? ''}})),
  getNextPageParam: last => last.nextAfter ?? undefined,
});

export const reviewQuery = (id: string) =>
  queryOptions({
    queryKey: ['manage', 'moderation', 'job', id],
    queryFn: () => read<ModerationDetail>(m.moderation[':id'].$get({param: {id}})),
  });

export const NO_JOB_FILTERS: AdminJobFilters = {status: '', category: '', featured: '', source: '', q: ''};

export const adminJobsQuery = (filters: AdminJobFilters) =>
  infiniteQueryOptions({
    queryKey: ['manage', 'jobs', 'list', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam}) => read<AdminJobsPage>(m.jobs.$get({query: {...filters, before: pageParam ?? ''}})),
    getNextPageParam: last => (last.nextBefore ? String(last.nextBefore) : undefined),
  });

export const adminJobQuery = (id: string) =>
  queryOptions({
    queryKey: ['manage', 'jobs', 'one', id],
    queryFn: () => read<AdminJobDetail>(m.jobs[':id'].$get({param: {id}})),
  });

export const companiesQuery = (q: string) =>
  queryOptions({
    queryKey: ['manage', 'companies', q],
    queryFn: () => read<AdminCompanies>(m.jobs.companies.$get({query: {q}})),
    staleTime: 60_000,
  });

export const tiersQuery = queryOptions({
  queryKey: ['manage', 'tiers'],
  queryFn: () => read<AdminTiers>(m.tiers.$get()),
});

export const emailLogQuery = (filter: {status: '' | EmailLogStatus; to: string}) =>
  infiniteQueryOptions({
    queryKey: ['manage', 'emails', filter],
    initialPageParam: undefined as string | undefined,
    // An address filter is POSTed: an email address never goes in a URL.
    queryFn: ({pageParam}) =>
      read<EmailLogPage>(
        filter.to
          ? m.emails.search.$post({json: {...filter, before: pageParam ?? ''}})
          : m.emails.$get({query: {status: filter.status, before: pageParam ?? ''}})
      ),
    getNextPageParam: last => last.nextBefore ?? undefined,
  });

export const brandingQuery = queryOptions({
  queryKey: ['manage', 'settings', 'branding'],
  queryFn: () => read<AdminBranding>(m.settings.branding.$get()),
});

export const boardModeQuery = queryOptions({
  queryKey: ['manage', 'settings', 'board'],
  queryFn: () => read<AdminBoardMode>(m.settings.board.$get()),
});

export const moderationModeQuery = queryOptions({
  queryKey: ['manage', 'settings', 'moderation'],
  queryFn: () => read<AdminModerationMode>(m.settings.moderation.$get()),
});

export const jobFormOptionsQuery = queryOptions({
  queryKey: ['manage', 'jobs', 'form-options'],
  queryFn: () => read<AdminJobFormOptions>(m.jobs['form-options'].$get()),
  staleTime: 5 * 60_000,
});
