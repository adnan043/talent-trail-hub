import {EMPTY_JOB_VALUES, type JobValues, readJobValues} from '../../lib/job-input';
import {LIMITS} from '../../lib/board';
import type {NewCompanyValues} from '../../lib/types-employer';
import {rules} from '../ui';

/**
 * The post-a-job wizard's draft, kept in THIS browser only (localStorage, F10): the job, the new
 * company, the tier, the step, and the unpaid job's id after a closed checkout (so posting again
 * reuses it). Never trusted by the server: it checks everything again.
 */

export interface PostDraft {
  step: 1 | 2 | 3 | 4;
  job: JobValues;
  company: NewCompanyValues;
  tierId: number | null;
  jobId: number | null;
}

const KEY = 'board:post-a-job';
export const EMPTY_COMPANY: NewCompanyValues = {companyName: '', website: '', location: '', about: ''};
export const emptyDraft = (): PostDraft => ({step: 1, job: {...EMPTY_JOB_VALUES}, company: {...EMPTY_COMPANY}, tierId: null, jobId: null});

export function loadDraft(): PostDraft {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PostDraft> | null;
    if (!raw || typeof raw !== 'object') return emptyDraft();
    const company = (raw.company ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof company[key] === 'string' ? (company[key] as string) : '');
    return {
      step: raw.step === 2 || raw.step === 3 || raw.step === 4 ? raw.step : 1,
      job: readJobValues(raw.job),
      company: {companyName: text('companyName'), website: text('website'), location: text('location'), about: text('about')},
      tierId: typeof raw.tierId === 'number' ? raw.tierId : null,
      jobId: typeof raw.jobId === 'number' ? raw.jobId : null,
    };
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(draft: PostDraft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Storage blocked or full: the draft lasts until the tab closes.
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

const HTTPS = /^https:\/\/[^\s/]+\.[^\s]+$/i;

/** The same rules as the server's `readNewCompany` / `readCompanyProfile` (src/server/board/employer.ts). */
export const COMPANY_RULES = {
  companyName: [rules.required('Add the company name (at least 2 characters).'), rules.minLength(2, 'Add the company name (at least 2 characters).'), rules.maxLength(LIMITS.companyName, `Keep the name to ${LIMITS.companyName} characters.`)],
  website: [rules.pattern(HTTPS, 'Enter the full link, starting with https://'), rules.maxLength(300, 'Keep the link to 300 characters.')],
  location: [rules.maxLength(80, 'Keep the location to 80 characters.')],
  about: [rules.maxLength(LIMITS.companyAbout, `Keep it to ${LIMITS.companyAbout} characters.`)],
};
export const SOCIAL_RULE = [rules.pattern(HTTPS, 'Enter the full link, starting with https://'), rules.maxLength(300, 'Enter the full link, starting with https://')];
