import {
  APPLY_METHODS,
  type ApplyMethod,
  EMPLOYMENT_TYPES,
  type EmploymentType,
  LIMITS,
  SALARY_PERIODS,
  type SalaryPeriod,
  WORKPLACE_TYPES,
  type WorkplaceType,
} from './board';
import {markdownTextLength} from './markdown';

/**
 * The job fields, ONE set of rules for the form (src/portal/board/JobForm.tsx) and the server
 * (src/server/board/employer-jobs.ts, and the admin's jobs): the browser sends the form's values
 * as they are (all strings), the server checks them with `checkJobValues` again and turns them
 * into columns with `jobColumns`. Browser-safe.
 */

/** The form's values: every field a string (lists comma-separated), as typed. */
export interface JobValues {
  [key: string]: string;
  title: string;
  categoryId: string;
  employmentType: string;
  workplaceType: string;
  locationCity: string;
  locationRegion: string;
  /** ISO 3166-1 alpha-2 ("DE"); required unless remote. */
  locationCountry: string;
  /** Remote only: "US, CA, MX" (none = anywhere). */
  applicantCountries: string;
  /** Whole units of the board's currency ("85000"), or empty. */
  salaryMin: string;
  salaryMax: string;
  salaryPeriod: string;
  descriptionMd: string;
  /** "react, typescript" (≤ 5). */
  tags: string;
  applyMethod: string;
  applyTarget: string;
}

export type JobField = keyof JobValues & string;
export const JOB_FIELDS: JobField[] = [
  'title',
  'categoryId',
  'employmentType',
  'workplaceType',
  'locationCity',
  'locationRegion',
  'locationCountry',
  'applicantCountries',
  'salaryMin',
  'salaryMax',
  'salaryPeriod',
  'descriptionMd',
  'tags',
  'applyMethod',
  'applyTarget',
];

export const EMPTY_JOB_VALUES: JobValues = {
  title: '',
  categoryId: '',
  employmentType: 'FULL_TIME',
  workplaceType: 'remote',
  locationCity: '',
  locationRegion: '',
  locationCountry: '',
  applicantCountries: '',
  salaryMin: '',
  salaryMax: '',
  salaryPeriod: 'YEAR',
  descriptionMd: '',
  tags: '',
  applyMethod: 'onsite',
  applyTarget: '',
};

/** Raw text sizes accepted before any rule runs (the server refuses longer bodies outright). */
const RAW_MAX: Partial<Record<JobField, number>> = {descriptionMd: LIMITS.descriptionMax, applicantCountries: 300, tags: 200, applyTarget: 500};

/** Reads untrusted JSON into JobValues (strings only, bounded); unknown keys are dropped. */
export function readJobValues(raw: unknown): JobValues {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = {...EMPTY_JOB_VALUES};
  for (const field of JOB_FIELDS) {
    const value = source[field];
    if (typeof value === 'string') out[field] = value.slice(0, (RAW_MAX[field] ?? 200) + 1);
    else if (typeof value === 'number' && Number.isFinite(value)) out[field] = String(value);
  }
  return out;
}

const COUNTRY = /^[A-Za-z]{2}$/;
const WHOLE = /^\d{1,9}$/;
/** https only: the apply button links https alone. */
const URL_RE = /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/i;
/** A plain address: one @, a dot in the domain, no ?, &, spaces, quotes or angle brackets (no mailto tricks). */
const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}$/;

export const splitList = (value: string) =>
  value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

const oneOf = <T extends string>(set: readonly T[], value: string): value is T => (set as readonly string[]).includes(value);

/** Every field's problem, in words that say how to fix it. Empty = valid. */
export function checkJobValues(v: JobValues): Partial<Record<JobField, string>> {
  const errors: Partial<Record<JobField, string>> = {};
  const title = v.title.trim();
  if (!title) errors.title = 'Add a job title.';
  else if (title.length < 3) errors.title = 'Use at least 3 characters for the title.';
  else if (title.length > LIMITS.title) errors.title = `Keep the title to ${LIMITS.title} characters.`;

  if (!/^\d{1,9}$/.test(v.categoryId)) errors.categoryId = 'Choose a category.';
  if (!oneOf(EMPLOYMENT_TYPES, v.employmentType)) errors.employmentType = 'Choose the type of employment.';
  if (!oneOf(WORKPLACE_TYPES, v.workplaceType)) errors.workplaceType = 'Choose where the work happens.';

  if (v.locationCity.trim().length > 80) errors.locationCity = 'Keep the city to 80 characters.';
  if (v.locationRegion.trim().length > 80) errors.locationRegion = 'Keep the region to 80 characters.';
  const country = v.locationCountry.trim();
  if (v.workplaceType !== 'remote' && !country) errors.locationCountry = 'Enter the country of the workplace.';
  else if (country && !COUNTRY.test(country)) errors.locationCountry = 'Use a 2-letter country code, like DE or US.';

  if (v.workplaceType === 'remote') {
    const codes = splitList(v.applicantCountries);
    if (codes.some(code => !COUNTRY.test(code))) errors.applicantCountries = 'Use 2-letter country codes separated by commas, like US, CA.';
    else if (codes.length > 30) errors.applicantCountries = 'List at most 30 countries.';
  }

  const min = v.salaryMin.trim();
  const max = v.salaryMax.trim();
  if (min && !WHOLE.test(min)) errors.salaryMin = 'Use a whole number without commas or symbols, like 60000.';
  if (max && !WHOLE.test(max)) errors.salaryMax = 'Use a whole number without commas or symbols, like 80000.';
  else if (min && max && WHOLE.test(min) && Number(max) < Number(min)) errors.salaryMax = 'The maximum must be at least the minimum.';
  if (!oneOf(SALARY_PERIODS, v.salaryPeriod)) errors.salaryPeriod = 'Choose how often the salary is paid.';

  if (v.descriptionMd.length > LIMITS.descriptionMax) {
    errors.descriptionMd = `Keep the description to ${LIMITS.descriptionMax.toLocaleString('en-US')} characters.`;
  } else {
    const length = markdownTextLength(v.descriptionMd);
    if (length < LIMITS.descriptionMin) errors.descriptionMd = `Write at least ${LIMITS.descriptionMin} characters (${length} so far).`;
  }

  const tags = splitList(v.tags);
  const lowered = tags.map(tag => tag.toLowerCase());
  if (tags.length > LIMITS.tags) errors.tags = `Use at most ${LIMITS.tags} tags.`;
  else if (tags.some(tag => tag.length > LIMITS.tagLength)) errors.tags = `Keep each tag to ${LIMITS.tagLength} characters.`;
  else if (new Set(lowered).size !== lowered.length) errors.tags = 'Use each tag only once.';

  if (!oneOf(APPLY_METHODS, v.applyMethod)) errors.applyMethod = 'Choose how people apply.';
  const target = v.applyTarget.trim();
  if (target.length > 500) errors.applyTarget = 'Keep it to 500 characters.';
  else if (v.applyMethod === 'url' && !URL_RE.test(target)) errors.applyTarget = 'Enter the full link, starting with https://';
  else if (v.applyMethod === 'email' && !EMAIL_RE.test(target)) errors.applyTarget = 'Enter a valid email address, like jobs@example.com.';
  return errors;
}

/** The columns a VALID JobValues becomes (the server adds the HTML, the category check and the slug). */
export interface JobColumns {
  title: string;
  categoryId: number;
  employmentType: EmploymentType;
  workplaceType: WorkplaceType;
  locationCity: string | null;
  locationRegion: string | null;
  locationCountry: string | null;
  applicantCountries: string[] | null;
  /** Minor units of the board's currency. */
  salaryMinCents: number | null;
  salaryMaxCents: number | null;
  salaryPeriod: SalaryPeriod | null;
  descriptionMd: string;
  tags: string[];
  applyMethod: ApplyMethod;
  applyTarget: string | null;
}

export function jobColumns(v: JobValues): JobColumns {
  const remote = v.workplaceType === 'remote';
  const cents = (value: string) => (value.trim() ? Number(value.trim()) * 100 : null);
  const salaryMinCents = cents(v.salaryMin);
  const salaryMaxCents = cents(v.salaryMax);
  const countries = remote ? [...new Set(splitList(v.applicantCountries).map(code => code.toUpperCase()))] : [];
  return {
    title: v.title.trim(),
    categoryId: Number(v.categoryId),
    employmentType: v.employmentType as EmploymentType,
    workplaceType: v.workplaceType as WorkplaceType,
    locationCity: v.locationCity.trim() || null,
    locationRegion: v.locationRegion.trim() || null,
    locationCountry: v.locationCountry.trim().toUpperCase() || null,
    applicantCountries: countries.length ? countries : null,
    salaryMinCents,
    salaryMaxCents,
    salaryPeriod: salaryMinCents !== null || salaryMaxCents !== null ? (v.salaryPeriod as SalaryPeriod) : null,
    descriptionMd: v.descriptionMd.trim(),
    tags: splitList(v.tags).map(tag => tag.toLowerCase()),
    applyMethod: v.applyMethod as ApplyMethod,
    applyTarget: v.applyMethod === 'onsite' ? null : v.applyTarget.trim(),
  };
}

/** A stored job back into the form's values (edit, duplicate). */
export function jobValuesOf(job: {
  title: string;
  categoryId: number;
  employmentType: string;
  workplaceType: string;
  locationCity: string | null;
  locationRegion: string | null;
  locationCountry: string | null;
  applicantCountries: unknown;
  salaryMinCents: number | null;
  salaryMaxCents: number | null;
  salaryPeriod: string | null;
  descriptionMd: string;
  tags: string[];
  applyMethod: string;
  applyTarget: string | null;
}): JobValues {
  const whole = (cents: number | null) => (cents === null ? '' : String(Math.round(cents / 100)));
  const countries = Array.isArray(job.applicantCountries) ? job.applicantCountries.filter((c): c is string => typeof c === 'string') : [];
  return {
    title: job.title,
    categoryId: String(job.categoryId),
    employmentType: job.employmentType,
    workplaceType: job.workplaceType,
    locationCity: job.locationCity ?? '',
    locationRegion: job.locationRegion ?? '',
    locationCountry: job.locationCountry ?? '',
    applicantCountries: countries.join(', '),
    salaryMin: whole(job.salaryMinCents),
    salaryMax: whole(job.salaryMaxCents),
    salaryPeriod: job.salaryPeriod ?? 'YEAR',
    descriptionMd: job.descriptionMd,
    tags: job.tags.join(', '),
    applyMethod: job.applyMethod,
    applyTarget: job.applyTarget ?? '',
  };
}
