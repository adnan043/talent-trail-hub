/**
 * The job seeker's profile (`/site-api/applicant-profile`, `src/server/routes/applicant-profile.ts`).
 * Browser-safe: the dashboard's profile screen, the job page's apply section and the server share
 * these shapes, limits and the completion rule, so the percentage reads the same everywhere.
 */

/**
 * What a signed-in account is. `applicant`: has a job seeker profile. `employer`: owns a company.
 * `none`: neither yet (it picks on the welcome step). An account is never both.
 */
export type AccountKind = 'applicant' | 'employer' | 'none';

export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {male: 'Male', female: 'Female', other: 'Other'};

/** Field limits: the server's validator and the form's rules both read them. */
export const PROFILE_LIMITS = {
  phone: 40,
  address: 300,
  headline: 120,
  careerSummary: 2000,
  expectedSalary: 60,
  degree: 150,
  institute: 150,
  skills: 500,
  profileUrl: 300,
  experienceYearsMax: 60,
  passingYearMin: 1950,
  passingYearMax: 2100,
} as const;

export const PHONE_RE = /^[+\d][\d\s().-]{4,39}$/;

/** The editable details (everything but the files). Empty = null. */
export interface ProfileDetails {
  phone: string | null;
  /** `YYYY-MM-DD`. */
  dateOfBirth: string | null;
  gender: Gender | null;
  presentAddress: string | null;
  permanentAddress: string | null;
  headline: string | null;
  careerSummary: string | null;
  experienceYears: number | null;
  expectedSalary: string | null;
  degree: string | null;
  institute: string | null;
  passingYear: number | null;
  skills: string | null;
  profileUrl: string | null;
}

/** `GET /site-api/applicant-profile` → `profile`. */
export interface ApplicantProfileView extends ProfileDetails {
  /** The account's own name and email (changed under "Your account"). */
  name: string;
  email: string;
  hasPhoto: boolean;
  /** Bumps when the photo changes, so `<img src=…?v=>` is never a stale cached image. */
  photoVersion: string | null;
  resumeFileName: string | null;
  resumeUpdatedAt: string | null;
  updatedAt: string;
}

export interface ApplicantProfileAnswer {
  kind: AccountKind;
  profile: ApplicantProfileView | null;
}

/**
 * Applying needs these, plus the account's confirmed email (every signed-up account has one; it is
 * checked on apply). The job page and the server say which are missing.
 */
export const REQUIRED_TO_APPLY = ['photo', 'resume'] as const;
export type ApplyRequirement = (typeof REQUIRED_TO_APPLY)[number];
export const REQUIREMENT_LABELS: Record<ApplyRequirement, string> = {photo: 'a photo', resume: 'your CV'};

/** What is still missing, as words: "a photo and your CV" (never "a photo, your CV"). */
export function missingLabel(missing: readonly ApplyRequirement[]): string {
  const words = missing.map(m => REQUIREMENT_LABELS[m]);
  return words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

export function missingToApply(p: Pick<ApplicantProfileView, 'hasPhoto' | 'resumeFileName'>): ApplyRequirement[] {
  const missing: ApplyRequirement[] = [];
  if (!p.hasPhoto) missing.push('photo');
  if (!p.resumeFileName) missing.push('resume');
  return missing;
}

/** Each counts the same towards "profile complete". */
const COMPLETION_PARTS: ((p: ApplicantProfileView) => boolean)[] = [
  p => p.hasPhoto,
  p => Boolean(p.resumeFileName),
  p => Boolean(p.phone),
  p => Boolean(p.dateOfBirth),
  p => Boolean(p.gender),
  p => Boolean(p.presentAddress),
  p => Boolean(p.headline),
  p => Boolean(p.careerSummary),
  p => p.experienceYears !== null,
  p => Boolean(p.degree && p.institute),
  p => Boolean(p.skills),
  p => Boolean(p.profileUrl),
];

/** 0–100, rounded. */
export const profileCompletion = (p: ApplicantProfileView): number =>
  Math.round((COMPLETION_PARTS.filter(part => part(p)).length / COMPLETION_PARTS.length) * 100);

/** Photo: PNG / JPEG / WebP (checked again on the server by the stored file's first bytes). */
export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp';

/** `POST /applicant-profile/photo` and `/resume` → 201: send the bytes, then `complete` with both. */
export interface ProfileUploadGrant {
  fileId: string;
  token: string;
  upload: {method: 'PUT'; url: string; headers: Record<string, string>; expiresAt: string};
}

/** `GET /applications/jobs/:slug/can-apply`. */
export type CanApplyReason = 'sign_in' | 'own_job' | 'staff' | 'employer_account' | 'choose_kind' | 'incomplete' | 'applied' | 'closed';
export interface CanApplyAnswer {
  canApply: boolean;
  reason: CanApplyReason | null;
  /** `incomplete`: what to add first. */
  missing?: ApplyRequirement[];
  /** Signed in as an applicant: what the employer will see. */
  profile?: {name: string; email: string; phone: string | null; headline: string | null; resumeFileName: string | null};
}

/** `GET /site-api/applications/:id/profile` → `profile`: what the employer sees beside the application. */
export interface ApplicantProfileForEmployer {
  dateOfBirth: string | null;
  gender: string | null;
  presentAddress: string | null;
  headline: string | null;
  careerSummary: string | null;
  experienceYears: number | null;
  expectedSalary: string | null;
  degree: string | null;
  institute: string | null;
  passingYear: number | null;
  skills: string | null;
  hasPhoto: boolean;
}
