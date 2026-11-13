/**
 * The site's own words: navigation and the job board's page copy.
 *
 * The board's NAME, LOGO, colour, hero and footer links are NOT here: they are the board
 * settings (`board_settings`, edited in the dashboard), so a change shows without a Publish.
 * Use `{name}` in any string below for the board's name.
 */

/** Search and social basics. The NAME comes from the board settings (above). */
export const SITE = {
  /** One sentence: the meta description of pages that have none of their own. Use `{name}`. */
  description: 'Find your next job at {name}: hand-picked roles from companies that are hiring now. Search, save and apply in minutes.',
  /** `en`, `fr`, … : the page language (screen readers, search engines). */
  lang: 'en',
  /**
   * The address search engines should treat as THE address (canonical URLs,
   * sitemap, social cards): set it to the custom domain once the owner has one
   * (`https://www.example.com`, no trailing slash). Empty = the address
   * The platform gives the site (`SITE_URL`, src/lib/seo.ts).
   */
  url: '',
};

export interface NavItem {
  label: string;
  href: string;
  /**
   * `false` for a page rendered on every visit (SSR): it is
   * private (`no-store`), so fetching it ahead would be wasted. Every other
   * item is prerendered and prefetched as soon as the nav is on screen.
   */
  prefetch?: false;
  /** Hidden on a single-company board (F39): `data-marketplace-only`, hidden by the brand stylesheet. */
  marketplaceOnly?: true;
  /** The footer's wording, when it differs from the header's. */
  footerLabel?: string;
}

/** Top navigation (header, mobile menu; the footer's "Job seekers" column with `footerLabel`). Every href is a page of THIS site: plain links. */
export const NAV: NavItem[] = [
  {label: 'Find jobs', footerLabel: 'Browse jobs', href: '/jobs/', prefetch: false},
  {label: 'Companies', href: '/companies/', prefetch: false, marketplaceOnly: true},
  {label: 'Saved jobs', href: '/saved/'},
  {label: 'Pricing', href: '/pricing/', prefetch: false, marketplaceOnly: true},
];

/** The signed-in visitor's employer area (header account menu, mobile menu; marketplace only). */
export const EMPLOYER_LINKS = [
  {label: 'Your jobs', href: '/dashboard/employer/jobs', icon: 'jobs'},
  {label: 'Company profile', href: '/dashboard/employer/company', icon: 'company'},
  {label: 'Billing', href: '/dashboard/employer/billing', icon: 'billing'},
] as const;

/** The header's call to action for employers (marketplace only). */
export const POST_A_JOB = {label: 'Post a job', href: '/post-a-job/'};

export const HOME = {
  searchLabel: 'Search jobs',
  searchPlaceholder: 'Job title, company or skill',
  popular: 'Popular:',
  featuredTitle: 'Featured jobs',
  latestTitle: 'Latest jobs',
  allJobs: 'All jobs',
  categoriesTitle: 'Browse by category',
  companiesTitle: 'Hiring now',
  allCompanies: 'All companies',
  empty: {title: 'No jobs yet', body: 'Be the first to reach candidates here.', action: 'Post the first job'},
  emptySingle: {title: 'No open roles right now', body: '{company} has no open positions at the moment. Check back soon.'},
  cta: {
    title: 'Hiring? Reach candidates on {name}',
    body: 'Post a job in minutes. Your listing goes live after a quick review.',
    action: 'Post a job',
    pricing: 'See pricing',
  },
};

export const POST_A_JOB_PAGE = {
  title: 'Post a job',
  description: 'Post a job on {name}: write your listing, choose how long it runs and reach candidates who are looking now. Live after a quick review.',
  lede: 'Reach candidates who are looking now. Write your listing, pick a plan and publish.',
  steps: [
    {title: 'Create your employer account', body: 'Sign up with your email. It is free and takes a minute.'},
    {title: 'Write your listing', body: 'Title, description, location and how candidates apply. Your draft saves as you type.'},
    {title: 'Pick a plan and publish', body: 'Choose how long it runs. After a quick review your job is live.'},
  ],
  guestAction: 'Create an account to post',
  userAction: 'Start your listing',
  signIn: 'Already have an account? Sign in',
};

export const ABOUT = {
  title: 'About {name}',
  lede: 'A job board for people looking for their next role, and the companies hiring them.',
  /** The meta description (120–160 characters). Use `{name}`. */
  description: 'About {name}: a job board where candidates search, save and apply for free, and employers post roles and manage applicants in one place.',
  sections: [
    {heading: 'For candidates', body: 'Search and filter open roles, save the ones you like and apply in minutes. No account needed.'},
    {heading: 'For employers', body: 'Post a job, choose how long it runs and manage applicants from your dashboard.'},
  ],
};

/** Fill `{name}` with the site's name. */
export function withName(text: string, name: string): string {
  return text.replaceAll('{name}', name);
}
