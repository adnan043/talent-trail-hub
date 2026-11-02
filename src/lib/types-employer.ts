import type {JobStatus, OrderStatus} from './board';
import type {JobValues} from './job-input';

/**
 * The employer area's API shapes (`/site-api/employer/*`, src/server/routes/employer.ts),
 * shared by the server and the portal (src/portal/employer/). Browser-safe.
 */

export interface CompanySocials {
  linkedin: string;
  x: string;
  github: string;
  instagram: string;
}
export const SOCIAL_KEYS = ['linkedin', 'x', 'github', 'instagram'] as const;
export const SOCIAL_LABELS: Record<(typeof SOCIAL_KEYS)[number], string> = {linkedin: 'LinkedIn', x: 'X', github: 'GitHub', instagram: 'Instagram'};

/** The employer's own company, as the editor shows it. `about` is Markdown (from the stored HTML). */
export interface EmployerCompany {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  website: string;
  location: string;
  about: string;
  aboutHtml: string;
  socials: CompanySocials;
  isBlocked: boolean;
}

/** The company step of the wizard (first post only): becomes the company. */
export interface NewCompanyValues {
  [key: string]: string;
  companyName: string;
  website: string;
  location: string;
  about: string;
}

/** A listing tier the employer can pick. The price shown is the catalogue's copy (display only). */
export interface TierOption {
  id: number;
  name: string;
  priceCents: number;
  currency: string;
  durationDays: number;
  includesFeatured: boolean;
}

/** `GET /employer/options`: what the wizard and the job form need. */
export interface EmployerOptions {
  categories: {id: number; name: string}[];
  tiers: TierOption[];
  /** Every tier is free (F25 free posting): no checkout. */
  freePosting: boolean;
  /** The board's currency: salaries are entered in it. */
  currency: string;
  company: EmployerCompany | null;
}

export interface EmployerJobActions {
  edit: boolean;
  close: boolean;
  renew: boolean;
  duplicate: boolean;
}

/** One row of "My jobs". `status` is the effective one (a published job past its expiry is `expired`). */
export interface EmployerJobRow {
  id: number;
  title: string;
  slug: string;
  status: JobStatus;
  daysLeft: number | null;
  expiresAt: string | null;
  views: number;
  applyClicks: number;
  applicants: number;
  featured: boolean;
  rejectionReason: string | null;
  tierId: number | null;
  actions: EmployerJobActions;
}
export type EmployerJobsPage = {items: EmployerJobRow[]; nextBefore: number | null};

/** `GET /employer/jobs/:id`: a job as the form edits it. */
export interface EmployerJobDetail {
  id: number;
  slug: string;
  status: JobStatus;
  tierId: number | null;
  actions: EmployerJobActions;
  values: JobValues;
}

/** A checkout the portal opens (`openCheckout`, src/lib/checkout-session.ts). */
export interface StartedCheckout {
  id: string;
  mode?: 'test' | 'live';
  embedded: import('./checkout-session').PaymentStep;
}

/**
 * The answer to post-a-job and renew:
 *   done      free (or nothing to pay): the job is live or in review now
 *   checkout  pay in the embedded checkout; the payment hook finishes the job
 *   choose    several ways to pay: ask, then send the same request again with `gateway`
 */
export type ListingAnswer =
  | {status: 'done'; jobId: number; orderId: number; jobStatus: JobStatus}
  | {status: 'checkout'; jobId: number; orderId: number; checkout: StartedCheckout}
  | {status: 'choose'; jobId: number; gateways: {slug: string; name: string}[]};

/** One row of billing (F18): newest first. */
export interface EmployerOrderRow {
  id: number;
  number: string;
  createdAt: string;
  paidAt: string | null;
  kind: 'new' | 'renew';
  status: OrderStatus;
  jobId: number | null;
  jobTitle: string | null;
  tierName: string;
  durationDays: number;
  includesFeatured: boolean;
  amountCents: number;
  currency: string;
  /** The payment provider's receipt when one is stored; otherwise the printable receipt screen. */
  receiptUrl: string | null;
}
export type EmployerOrdersPage = {items: EmployerOrderRow[]; nextBefore: number | null};

/** `GET /employer/orders/:id`: a printable receipt (paid or refunded orders only). */
export interface EmployerReceipt {
  order: EmployerOrderRow;
  refundedAt: string | null;
  boardName: string;
  company: {name: string; location: string | null};
  buyer: {name: string | null; email: string | null};
}
