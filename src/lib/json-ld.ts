/**
 * schema.org structured data for the board's pages (F34, SPEC "JobPosting JSON-LD"). Rendered
 * by `<Base jsonLd>` through `jsonLdText()`. Only facts the page shows; absolute URLs only when
 * the site's address is known (`absoluteUrl`, injectable for tests).
 */
import {countryName} from './job-display';
import {absoluteUrl, type JsonLd} from './seo';
import type {PublicCompany, PublicJobDetail} from './types-public';

type Absolute = (path: string) => string | null;

const units = (cents: number) => cents / 100;

function baseSalary(job: PublicJobDetail): JsonLd | null {
  const s = job.salary;
  if (!s || (s.minCents == null && s.maxCents == null)) return null;
  const value =
    s.minCents != null && s.maxCents != null && s.minCents !== s.maxCents
      ? {minValue: units(Math.min(s.minCents, s.maxCents)), maxValue: units(Math.max(s.minCents, s.maxCents))}
      : {value: units((s.minCents ?? s.maxCents)!)};
  return {'@type': 'MonetaryAmount', currency: s.currency, value: {'@type': 'QuantitativeValue', ...value, unitText: s.period}};
}

function place(job: PublicJobDetail): JsonLd | null {
  if (!job.locationCountry) return null;
  return {
    '@type': 'Place',
    address: {
      '@type': 'PostalAddress',
      ...(job.locationCity && {addressLocality: job.locationCity}),
      ...(job.locationRegion && {addressRegion: job.locationRegion}),
      addressCountry: job.locationCountry,
    },
  };
}

/**
 * The `JobPosting` of an OPEN job, or null for an expired or closed one (they carry none, F3).
 * Remote: `jobLocationType: TELECOMMUTE` + `applicantLocationRequirements` (the allowed countries,
 * or the job's country). `directApply` is true for the on-site form.
 */
export function jobPostingJsonLd(job: PublicJobDetail, board: {name: string}, absolute: Absolute = absoluteUrl): JsonLd | null {
  if (job.state !== 'active') return null;
  const remote = job.workplaceType === 'remote';
  const countries = job.applicantCountries.length ? job.applicantCountries : job.locationCountry ? [job.locationCountry] : [];
  const location = place(job);
  const salary = baseSalary(job);
  const url = absolute(`/jobs/${encodeURIComponent(job.slug)}/`);
  const logo = job.company.logoUrl ? absolute(job.company.logoUrl) : null;
  return {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: job.descriptionHtml,
    datePosted: job.publishedAt,
    ...(job.expiresAt && {validThrough: job.expiresAt}),
    employmentType: job.employmentType,
    hiringOrganization: {
      '@type': 'Organization',
      name: job.company.name,
      ...(job.company.website && {sameAs: job.company.website}),
      ...(logo && {logo}),
    },
    ...(location && {jobLocation: location}),
    ...(remote && {
      jobLocationType: 'TELECOMMUTE',
      ...(countries.length > 0 && {applicantLocationRequirements: countries.map(code => ({'@type': 'Country', name: countryName(code)}))}),
    }),
    ...(salary && {baseSalary: salary}),
    identifier: {'@type': 'PropertyValue', name: board.name, value: String(job.id)},
    directApply: job.applyMethod === 'onsite',
    ...(url && {url}),
  };
}

/** The owner company as an `Organization` on a single-company board's home page (F39). */
export function companyJsonLd(company: PublicCompany, absolute: Absolute = absoluteUrl): JsonLd {
  const sameAs = [...(company.website ? [company.website] : []), ...company.socials.map(s => s.url)];
  const url = absolute(`/companies/${encodeURIComponent(company.slug)}/`);
  const logo = company.logoUrl ? absolute(company.logoUrl) : null;
  return {
    '@context': 'https://schema.org/',
    '@type': 'Organization',
    name: company.name,
    ...(url && {url}),
    ...(logo && {logo}),
    ...(sameAs.length > 0 && {sameAs}),
  };
}
