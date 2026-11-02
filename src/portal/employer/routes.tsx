import type {QueryClient} from '@tanstack/react-query';
import {createRoute, lazyRouteComponent} from '@tanstack/react-router';

import {type NavItem, rootRoute} from '../routes';
import {applicantsSearch, jobApplicantsQuery} from '../applicants/queries';
import {employerCompanyQuery, employerOptionsQuery, myJobQuery, myJobsQuery, myOrdersQuery, receiptQuery} from './queries';

/**
 * The employer area's dashboard screens (workstream C, docs/MIGRATION.md): literal paths under
 * the portal's basepath (`/dashboard`), a title, a loader warming the screen's queries, the
 * screen lazy. Hidden (`employer: true`) and 404 on the server in single-company mode.
 */

const warm = (...reads: Promise<unknown>[]) => Promise.all(reads.map(r => r.catch(() => undefined))).then(() => undefined);
type Ctx = {context: {queryClient: QueryClient}};
const idOf = (params: {id: string}) => Number(params.id);

const jobsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/employer/jobs',
  staticData: {title: 'My jobs'},
  // `?checkout=pcs_…`: back from a payment (the screen confirms it).
  validateSearch: (search: Record<string, unknown>): {checkout?: string} =>
    typeof search.checkout === 'string' ? {checkout: search.checkout} : {},
  loader: ({context: {queryClient}}: Ctx) => warm(queryClient.ensureInfiniteQueryData(myJobsQuery)),
  component: lazyRouteComponent(() => import('./screens/jobs'), 'EmployerJobs'),
});

const editJobRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/employer/jobs/$id/edit',
  staticData: {title: 'Edit job'},
  loader: ({context: {queryClient}, params}) =>
    warm(queryClient.ensureQueryData(myJobQuery(idOf(params))), queryClient.ensureQueryData(employerOptionsQuery)),
  component: lazyRouteComponent(() => import('./screens/edit-job'), 'EditEmployerJob'),
});

const applicantsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/employer/jobs/$id/applicants',
  staticData: {title: 'Applicants'},
  // `?status=` filters the list, so a filtered view can be linked and survives a reload.
  validateSearch: applicantsSearch,
  loaderDeps: ({search}) => ({status: search.status ?? ('' as const)}),
  loader: ({context: {queryClient}, params, deps}) => warm(queryClient.ensureInfiniteQueryData(jobApplicantsQuery(params.id, deps.status))),
  component: lazyRouteComponent(() => import('../applicants/ApplicantsScreen'), 'JobApplicants'),
});

const companyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/employer/company',
  staticData: {title: 'Company profile'},
  loader: ({context: {queryClient}}: Ctx) => warm(queryClient.ensureQueryData(employerCompanyQuery)),
  component: lazyRouteComponent(() => import('./screens/company'), 'EmployerCompanyScreen'),
});

const billingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/employer/billing',
  staticData: {title: 'Billing'},
  loader: ({context: {queryClient}}: Ctx) => warm(queryClient.ensureInfiniteQueryData(myOrdersQuery)),
  component: lazyRouteComponent(() => import('./screens/billing'), 'EmployerBilling'),
});

const receiptRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/employer/billing/$id/receipt',
  staticData: {title: 'Receipt'},
  loader: ({context: {queryClient}, params}) => warm(queryClient.ensureQueryData(receiptQuery(idOf(params)))),
  component: lazyRouteComponent(() => import('./screens/receipt'), 'EmployerReceipt'),
});

const postJobRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/post-a-job',
  staticData: {title: 'Post a job'},
  // `?step=1…4`: the wizard's step, so Back / Forward and a reload keep it.
  validateSearch: (search: Record<string, unknown>): {step?: 1 | 2 | 3 | 4} => {
    const step = Number(search.step);
    return step === 1 || step === 2 || step === 3 || step === 4 ? {step} : {};
  },
  loader: ({context: {queryClient}}: Ctx) => warm(queryClient.ensureQueryData(employerOptionsQuery)),
  component: lazyRouteComponent(() => import('./screens/post-job'), 'PostJob'),
});

export const employerRoutes = [jobsRoute, editJobRoute, applicantsRoute, companyRoute, billingRoute, receiptRoute, postJobRoute] as const;

export const EMPLOYER_NAV: {label: string; items: NavItem[]}[] = [
  {
    label: 'Hiring',
    items: [
      {to: '/employer/jobs', label: 'My jobs', icon: 'briefcase', employer: true},
      {to: '/post-a-job', label: 'Post a job', icon: 'plus', employer: true},
      {to: '/employer/company', label: 'Company profile', icon: 'globe', employer: true},
      {to: '/employer/billing', label: 'Billing', icon: 'file', employer: true, hideForAbility: 'readBoardReports'},
    ],
  },
];
