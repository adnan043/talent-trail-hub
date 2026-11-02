import {infiniteQueryOptions, queryOptions} from '@tanstack/react-query';

import type {
  EmployerCompany,
  EmployerJobDetail,
  EmployerJobsPage,
  EmployerOptions,
  EmployerOrdersPage,
  EmployerReceipt,
} from '../../lib/types-employer';
import {api, read} from '../api';

/**
 * The employer area's reads (src/server/routes/employer.ts), shared by the screens and their
 * route loaders. Every key starts with 'employer': a save invalidates `['employer', …]`.
 */

export const employerOptionsQuery = queryOptions({
  queryKey: ['employer', 'options'],
  queryFn: () => read<EmployerOptions>(api.employer.options.$get()),
  staleTime: 60_000,
});

export const employerCompanyQuery = queryOptions({
  queryKey: ['employer', 'company'],
  queryFn: () => read<{company: EmployerCompany | null; logoUploads: boolean}>(api.employer.company.$get()),
});

export const myJobsQuery = infiniteQueryOptions({
  queryKey: ['employer', 'jobs', 'list'],
  initialPageParam: undefined as string | undefined,
  queryFn: ({pageParam}) => read<EmployerJobsPage>(api.employer.jobs.$get({query: {before: pageParam ?? ''}})),
  getNextPageParam: last => (last.nextBefore ? String(last.nextBefore) : undefined),
});

export const myJobQuery = (id: number) =>
  queryOptions({
    queryKey: ['employer', 'jobs', id],
    queryFn: () => read<{job: EmployerJobDetail}>(api.employer.jobs[':id'].$get({param: {id: String(id)}})),
  });

export const myOrdersQuery = infiniteQueryOptions({
  queryKey: ['employer', 'orders', 'list'],
  initialPageParam: undefined as string | undefined,
  queryFn: ({pageParam}) => read<EmployerOrdersPage>(api.employer.orders.$get({query: {before: pageParam ?? ''}})),
  getNextPageParam: last => (last.nextBefore ? String(last.nextBefore) : undefined),
});

export const receiptQuery = (id: number) =>
  queryOptions({
    queryKey: ['employer', 'orders', id],
    queryFn: () => read<{receipt: EmployerReceipt}>(api.employer.orders[':id'].$get({param: {id: String(id)}})),
  });
