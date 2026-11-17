/**
 * API shapes of the apply flow and the applicants screens (workstream B). Browser-safe.
 * Routes: `src/server/routes/applications.ts` (mounted at `/site-api/applications`).
 */
import type {ApplicationStatus, ApplyMethod, JobStatus} from './board';
import {RESUME_RETENTION_DAYS} from './board';

/** What the job page hands `<ApplySection job={…} />`. */
export interface ApplyJob {
  id: number;
  slug: string;
  title: string;
  applyMethod: ApplyMethod;
  /** The https URL or email address for `url` / `email`; null for `onsite`. */
  applyTarget: string | null;
  companyName: string;
  /** false: closed or expired; the form is not shown. */
  open: boolean;
}

/** One applicant, as the employer or the admin sees them. */
export interface ApplicantRow {
  id: number;
  jobId: number;
  name: string;
  email: string;
  phone: string | null;
  profileUrl: string | null;
  coverNote: string | null;
  status: ApplicationStatus;
  /** Private: never emailed. */
  notes: string;
  /** The resume's file name, null when there is none or it expired. */
  resumeFileName: string | null;
  /** Past the retention period: the resume is never handed out. */
  resumeExpired: boolean;
  appliedAt: string;
  /** Admin lists only: which job. */
  job?: {id: number; title: string; slug: string; company: string};
}

export interface ApplicantsJob {
  id: number;
  title: string;
  slug: string;
  status: JobStatus;
  applicationCount: number;
}

/** `GET /applications/jobs/:id/applicants` (one page). */
export interface JobApplicantsPage {
  job: ApplicantsJob;
  items: ApplicantRow[];
  nextBefore: number | null;
}

/** `GET /applications/all` (admin, one page). */
export interface AllApplicantsPage {
  items: ApplicantRow[];
  nextBefore: number | null;
}

/** `GET /applications/all/jobs`: jobs with applicants, for the admin's job filter. */
export interface ApplicantJobOption {
  id: number;
  title: string;
  company: string;
  applicationCount: number;
}

/** `POST /applications/:id/resume-link` → a 10-minute download link. */
export interface ResumeLink {
  url: string;
  expiresAt: string;
}

/** Shown (rows, drawer, CSV) once a resume is past the retention period. */
export const RESUME_EXPIRED_TEXT = `Resume deleted after ${RESUME_RETENTION_DAYS} days (privacy policy)`;

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  new: 'New',
  reviewed: 'Reviewed',
  shortlisted: 'Shortlisted',
  approved: 'Approved',
  rejected: 'Rejected',
};

/**
 * Resume types the form accepts: the board's RESUME_TYPES that the platform's storage also takes
 * (`ALLOWED_FILE_TYPES` has no `application/msword`, so legacy .doc files cannot be stored).
 */
export const RESUME_UPLOAD_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export const RESUME_ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * One of the signed-in candidate's OWN applications (matched on their confirmed email), as
 * `GET /site-api/my-applications` returns it. Never the employer's private notes.
 */
export interface MyApplicationRow {
  id: number;
  status: ApplicationStatus;
  appliedAt: string;
  name: string;
  phone: string | null;
  profileUrl: string | null;
  coverNote: string | null;
  /** The resume's file name, null when there is none or it was deleted after the retention period. */
  resumeFileName: string | null;
  job: {title: string; company: string; /** Set only while the job page is live. */ slug: string | null};
}

/** `GET /site-api/my-applications` (one page, newest first). */
export interface MyApplicationsPage {
  items: MyApplicationRow[];
  nextBefore: number | null;
  /** Per status over ALL the person's applications (unfiltered); first page only, else null. */
  counts: Record<ApplicationStatus, number> | null;
}

/** How the candidate sees each status (the employer's words are in APPLICATION_STATUS_LABELS). */
export const MY_APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  new: 'Submitted',
  reviewed: 'In review',
  shortlisted: 'Shortlisted',
  approved: 'Approved',
  rejected: 'Not selected',
};
