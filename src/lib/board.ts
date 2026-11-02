/**
 * The job board's fixed sets, limits and labels. Browser-safe: pages, the portal and
 * `src/server/` all import them from here. Each set matches a CHECK in the migration
 * (prisma/migrations/*_job_board): adding a value is a code change AND a migration.
 */

export const JOB_STATUSES = ['draft', 'pending_payment', 'pending_review', 'published', 'rejected', 'expired', 'closed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** `paid`, `credit` and `free` are EMPLOYER jobs: the admin may not edit their content (403 `employer_job_locked`). */
export const JOB_SOURCES = ['paid', 'credit', 'free', 'admin', 'import'] as const;
export type JobSource = (typeof JOB_SOURCES)[number];
export const EMPLOYER_SOURCES: readonly JobSource[] = ['paid', 'credit', 'free'];

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'TEMPORARY', 'INTERN'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACTOR: 'Contract',
  TEMPORARY: 'Temporary',
  INTERN: 'Internship',
};

export const WORKPLACE_TYPES = ['onsite', 'hybrid', 'remote'] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];
export const WORKPLACE_LABELS: Record<WorkplaceType, string> = {onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote'};

export const APPLY_METHODS = ['onsite', 'url', 'email'] as const;
export type ApplyMethod = (typeof APPLY_METHODS)[number];

export const SALARY_PERIODS = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];
export const SALARY_PERIOD_LABELS: Record<SalaryPeriod, string> = {HOUR: 'hour', DAY: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year'};

export const APPLICATION_STATUSES = ['new', 'reviewed', 'shortlisted', 'rejected'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const MODERATION_MODES = ['all', 'auto'] as const;
export type ModerationMode = (typeof MODERATION_MODES)[number];

export const BOARD_MODES = ['marketplace', 'single_company'] as const;
export type BoardMode = (typeof BOARD_MODES)[number];

export const FONT_PRESETS = ['inter', 'serif', 'mono'] as const;
export type FontPreset = (typeof FONT_PRESETS)[number];

export const ORDER_STATUSES = ['pending', 'paid', 'refunded', 'failed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Limits shared by the validators (server) and the forms (browser): keep them identical. */
export const LIMITS = {
  title: 100,
  descriptionMin: 200,
  descriptionMax: 10000,
  tags: 5,
  tagLength: 30,
  companyName: 80,
  companyAbout: 2000,
  coverNote: 3000,
  applicantName: 100,
  rejectionReason: 500,
  employerNotes: 5000,
  tiersActiveMax: 3,
  tierDaysMax: 120,
  /** Resume: PDF / DOCX up to this size. */
  resumeMb: 5,
  /** Company logo: PNG / JPG / WebP up to this size (checked by first bytes, never SVG). */
  logoMb: 1,
  /** On-site applications per IP per hour. */
  appliesPerIpHour: 5,
  /** Featured jobs pinned on page 1 of /jobs/ and on the home page, rotated per UTC hour. */
  featuredPinCap: 5,
  pageSize: 20,
} as const;

/** Resumes are deleted this many days after the application (F36); also in the consent text. */
export const RESUME_RETENTION_DAYS = 180;

/** PDF and DOCX: the platform's storage does not take legacy .doc (`application/msword`). */
export const RESUME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const DEFAULT_CONSENT_TEXT =
  `I agree that the employer may process my application and resume to consider me for this job. ` +
  `My resume is deleted ${RESUME_RETENTION_DAYS} days after I apply.`;

/** How a job's status reads to people. */
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: 'Draft',
  pending_payment: 'Awaiting payment',
  pending_review: 'In review',
  published: 'Live',
  rejected: 'Rejected',
  expired: 'Expired',
  closed: 'Closed',
};
