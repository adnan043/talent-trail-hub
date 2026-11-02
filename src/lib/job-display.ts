/**
 * Text for job cards and job pages: place, workplace, salary, dates, countries. Browser-safe.
 */
import {EMPLOYMENT_LABELS, type EmploymentType, SALARY_PERIOD_LABELS, type SalaryPeriod, WORKPLACE_LABELS, type WorkplaceType} from './board';
import type {SalaryRange} from './types-public';

let regionNames: Intl.DisplayNames | null | undefined;

/** "US" → "United States". Unknown codes come back unchanged. */
export function countryName(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], {type: 'region'});
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Retired or non-country region codes that Intl still names. */
const NOT_COUNTRIES = new Set(['BU', 'CS', 'DD', 'EU', 'EZ', 'FX', 'NT', 'QO', 'SU', 'TP', 'UK', 'UN', 'YU', 'ZR', 'ZZ']);
let countries: [code: string, name: string][] | undefined;

function allCountries(): [string, string][] {
  if (countries) return countries;
  countries = [];
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(65 + i, 65 + j);
      const name = countryName(code);
      if (name !== code && !NOT_COUNTRIES.has(code)) countries.push([code, name.toLowerCase()]);
    }
  }
  return countries;
}

/** Every country as {value: code, label: name}, sorted by name, for a dropdown. */
export function countryOptions(): {value: string; label: string}[] {
  return allCountries()
    .map(([code]) => ({value: code, label: countryName(code)}))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const ALIASES: Record<string, string> = {usa: 'US', us: 'US', america: 'US', uk: 'GB', britain: 'GB', england: 'GB', uae: 'AE'};

/** Codes whose English name contains `text` (3+ characters), plus exact codes and aliases. */
export function countryCodesMatching(text: string): string[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return [];
  const codes = new Set<string>();
  if (ALIASES[needle]) codes.add(ALIASES[needle]);
  if (/^[a-z]{2}$/.test(needle) && allCountries().some(([code]) => code === needle.toUpperCase())) codes.add(needle.toUpperCase());
  if (needle.length >= 3) for (const [code, name] of allCountries()) if (name.includes(needle)) codes.add(code);
  return [...codes].slice(0, 20);
}

interface JobPlace {
  workplaceType: WorkplaceType;
  locationCity: string | null;
  locationRegion: string | null;
  locationCountry: string | null;
  applicantCountries?: readonly string[];
}

/** `short` (cards): the most specific place ("Portland"); `full`: "Portland, OR, United States". */
export function formatPlace(job: JobPlace, style: 'short' | 'full' = 'short'): string | null {
  const country = job.locationCountry ? countryName(job.locationCountry) : null;
  if (style === 'short') return job.locationCity ?? job.locationRegion ?? country;
  const parts = [job.locationCity, job.locationRegion, country].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export const workplaceLabel = (type: WorkplaceType) => WORKPLACE_LABELS[type] ?? type;
export const employmentLabel = (type: EmploymentType) => EMPLOYMENT_LABELS[type] ?? type;

/** "Remote · United States, Canada", "Hybrid · Berlin", "On-site". */
export function workplaceAndPlace(job: JobPlace, style: 'short' | 'full' = 'short'): string {
  const label = workplaceLabel(job.workplaceType);
  const list = job.applicantCountries ?? [];
  const where =
    job.workplaceType === 'remote'
      ? list.length === 0
        ? style === 'full'
          ? 'Anywhere'
          : null
        : list.length <= 2 || style === 'full'
          ? list.map(countryName).join(', ')
          : `${list.length} countries`
      : formatPlace(job, style);
  return where ? `${label} · ${where}` : label;
}

export const SALARY_NOT_DISCLOSED = 'Salary not disclosed';
const SHORT_PERIOD: Record<SalaryPeriod, string> = {HOUR: '/hr', DAY: '/day', WEEK: '/wk', MONTH: '/mo', YEAR: ''};

function amount(cents: number, currency: string, compact: boolean): string {
  const value = cents / 100;
  const whole = cents % 100 === 0;
  try {
    if (compact && value >= 10_000) {
      return new Intl.NumberFormat('en-US', {style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1}).format(value);
    }
    return new Intl.NumberFormat('en-US', {style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2}).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('en-US')}`;
  }
}

/** "$150K – $185K" (compact) or "$150,000 – $185,000 per year" (full); "From …" / "Up to …". */
export function formatSalary(salary: SalaryRange | null | undefined, style: 'compact' | 'full' = 'compact'): string | null {
  if (!salary) return null;
  const {minCents: min, maxCents: max, currency, period} = salary;
  const compact = style === 'compact';
  const f = (cents: number) => amount(cents, currency, compact);
  let range: string;
  if (min != null && max != null) range = min === max ? f(min) : `${f(Math.min(min, max))} – ${f(Math.max(min, max))}`;
  else if (min != null) range = `From ${f(min)}`;
  else if (max != null) range = `Up to ${f(max)}`;
  else return null;
  return range + (compact ? SHORT_PERIOD[period] : ` per ${SALARY_PERIOD_LABELS[period]}`);
}

const DAY_MS = 86_400_000;
const relative = new Intl.RelativeTimeFormat('en', {numeric: 'auto'});

/** "today", "yesterday", "3 days ago", "last week", "2 months ago". */
export function postedAgo(date: string | null, now: Date = new Date()): string {
  if (!date) return '';
  const days = Math.max(0, Math.floor((now.getTime() - new Date(date).getTime()) / DAY_MS));
  if (days < 7) return relative.format(-days, 'day');
  if (days < 30) return relative.format(-Math.floor(days / 7), 'week');
  if (days < 365) return relative.format(-Math.floor(days / 30), 'month');
  return relative.format(-Math.floor(days / 365), 'year');
}

const dateFormat = new Intl.DateTimeFormat('en-US', {dateStyle: 'medium', timeZone: 'UTC'});
/** "Oct 19, 2026" (UTC, so server and browser agree). */
export const shortDate = (date: string | null) => (date ? dateFormat.format(new Date(date)) : '');
