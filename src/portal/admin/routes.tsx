import {createRoute, lazyRouteComponent} from '@tanstack/react-router';

import {JOB_SOURCES, JOB_STATUSES} from '../../lib/board';
import type {AdminJobFilters} from '../../lib/types-manage';

import {allApplicantsQuery, applicantJobsQuery, applicantsSearch} from '../applicants/queries';
import type {NavItem} from '../routes';
import {ModerationNavBadge} from './NavBadges';
import {rootRoute} from '../routes';
import {
  adminJobQuery,
  adminJobsQuery,
  boardModeQuery,
  brandingQuery,
  companiesQuery,
  emailLogQuery,
  jobFormOptionsQuery,
  moderationModeQuery,
  moderationQuery,
  NO_JOB_FILTERS,
  reviewQuery,
  tiersQuery,
} from './queries';

/**
 * The admin area's dashboard screens (workstream D, docs/MIGRATION.md): a `createRoute` each
 * (literal path, title, a loader warming its queries, a lazy screen), listed in `adminRoutes`,
 * with sidebar items in `ADMIN_NAV` gated by `ability` (the routes' codenames are the enforcement).
 */
const warm = (...reads: Promise<unknown>[]) => Promise.all(reads.map(r => r.catch(() => undefined))).then(() => undefined);

const route = <P extends string>(path: P, title: string, load: (qc: import('@tanstack/react-query').QueryClient, params: Record<string, string>) => Promise<unknown>[], file: () => Promise<Record<string, unknown>>, name: string) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    staticData: {title},
    loader: ({context: {queryClient}, params}) => warm(...load(queryClient, params as Record<string, string>)),
    component: lazyRouteComponent(file as never, name as never),
  });

const moderationRoute = route('/manage/moderation', 'Moderation', qc => [qc.ensureInfiniteQueryData(moderationQuery)], () => import('./screens/moderation'), 'Moderation');
const reviewRoute = route('/manage/moderation/$id', 'Review job', (qc, p) => [qc.ensureQueryData(reviewQuery(p.id!))], () => import('./screens/review'), 'Review');
// The filters live in the URL (`?status=published&featured=yes`), so a filtered list can be linked.
const pickOf = <T extends string>(set: readonly T[], v: unknown): T | '' => (typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : '');
/** Every filter optional in a link (`<Link to="/manage/jobs">`); empty ones stay out of the URL. */
export const validateJobSearch = (search: Record<string, unknown>): Partial<AdminJobFilters> => {
  const all: AdminJobFilters = {
  status: pickOf(JOB_STATUSES, search.status),
  category: typeof search.category === 'string' && /^\d{1,9}$/.test(search.category) ? search.category : typeof search.category === 'number' ? String(search.category) : '',
  featured: pickOf(['yes', 'no'] as const, search.featured),
  source: pickOf(JOB_SOURCES, search.source),
  q: typeof search.q === 'string' ? search.q.slice(0, 100) : '',
  };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== '')) as Partial<AdminJobFilters>;
};
const jobsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/manage/jobs',
  staticData: {title: 'All jobs'},
  validateSearch: validateJobSearch,
  loaderDeps: ({search}) => ({...NO_JOB_FILTERS, ...search}),
  loader: ({context: {queryClient}, deps}) => warm(queryClient.ensureInfiniteQueryData(adminJobsQuery(deps)), queryClient.ensureQueryData(jobFormOptionsQuery)),
  component: lazyRouteComponent(() => import('./screens/jobs'), 'Jobs'),
});
const newJobRoute = route('/manage/jobs/new', 'New admin job', qc => [qc.ensureQueryData(jobFormOptionsQuery), qc.ensureQueryData(companiesQuery(''))], () => import('./screens/job-edit'), 'NewAdminJob');
const editJobRoute = route('/manage/jobs/$id', 'Edit job', (qc, p) => [qc.ensureQueryData(adminJobQuery(p.id!)), qc.ensureQueryData(jobFormOptionsQuery)], () => import('./screens/job-edit'), 'EditAdminJob');
// `?status=` and `?job=` filter the list (the new-applicant email links to `?job=<id>`).
const applicantsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/manage/applicants',
  staticData: {title: 'Applicants'},
  validateSearch: applicantsSearch,
  loaderDeps: ({search}) => ({status: search.status ?? ('' as const), job: search.job ?? ''}),
  loader: ({context: {queryClient}, deps}) =>
    warm(queryClient.ensureInfiniteQueryData(allApplicantsQuery(deps)), queryClient.ensureQueryData(applicantJobsQuery)),
  component: lazyRouteComponent(() => import('../applicants/ApplicantsScreen'), 'AllApplicants'),
});
const tiersRoute = route('/manage/tiers', 'Listing tiers', qc => [qc.ensureQueryData(tiersQuery)], () => import('./screens/tiers'), 'Tiers');
const privacyRoute = route('/manage/privacy', 'Candidate data', () => [], () => import('./screens/privacy'), 'Privacy');
const emailsRoute = route('/manage/emails', 'Email log', qc => [qc.ensureInfiniteQueryData(emailLogQuery({status: '', to: ''}))], () => import('./screens/emails'), 'Emails');
const brandingRoute = route('/manage/settings/branding', 'Branding', qc => [qc.ensureQueryData(brandingQuery)], () => import('./screens/settings-branding'), 'Branding');
const boardRoute = route('/manage/settings/board', 'Board mode', qc => [qc.ensureQueryData(boardModeQuery)], () => import('./screens/settings-board'), 'BoardMode');
const moderationModeRoute = route('/manage/settings/moderation', 'Moderation mode', qc => [qc.ensureQueryData(moderationModeQuery)], () => import('./screens/settings-board'), 'ModerationMode');

export const adminRoutes = [
  moderationRoute,
  reviewRoute,
  jobsRoute,
  newJobRoute,
  editJobRoute,
  applicantsRoute,
  tiersRoute,
  privacyRoute,
  emailsRoute,
  brandingRoute,
  boardRoute,
  moderationModeRoute,
] as const;

export const ADMIN_NAV: {label: string; items: NavItem[]}[] = [
  {
    label: 'Board',
    items: [
      {to: '/manage/moderation', label: 'Moderation', icon: 'inbox', ability: 'moderateJobs', badge: ModerationNavBadge},
      {to: '/manage/jobs', label: 'All jobs', icon: 'briefcase', ability: 'manageJobs'},
      {to: '/manage/applicants', label: 'Applicants', icon: 'users', ability: 'readApplicants'},
      {to: '/manage/tiers', label: 'Listing tiers', icon: 'layers', ability: 'manageBoard'},
      {to: '/manage/privacy', label: 'Candidate data', icon: 'lock', ability: 'managePrivacy'},
      {to: '/manage/emails', label: 'Email log', icon: 'mail', ability: 'readBoardReports'},
    ],
  },
  {
    label: 'Board settings',
    items: [
      {to: '/manage/settings/branding', label: 'Branding', icon: 'globe', ability: 'manageBoard'},
      {to: '/manage/settings/board', label: 'Board mode', icon: 'database', ability: 'manageBoard'},
      {to: '/manage/settings/moderation', label: 'Moderation mode', icon: 'shield', ability: 'manageBoard'},
    ],
  },
];
