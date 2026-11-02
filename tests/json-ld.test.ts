import {describe, expect, it} from 'vitest';

import {jobPostingJsonLd} from '../src/lib/json-ld';
import {jsonLdText} from '../src/lib/seo';
import type {PublicJobDetail} from '../src/lib/types-public';
import {accentTokens, contrast} from '../src/server/board/brand';
import {cursorHour, cursorWhere, encodeCursor, pickPinned} from '../src/server/board/public-search';

// SPEC "Required tests": JobPosting JSON-LD for an on-site job, a remote job, no salary, expired.

const origin = 'https://jobs.example.com';
const absolute = (path: string) => (path.startsWith('https://') ? path : new URL(path, origin).href);
const board = {name: 'Talent Trail Hub'};

function job(overrides: Partial<PublicJobDetail> = {}): PublicJobDetail {
  return {
    id: 42,
    slug: 'senior-designer',
    title: 'Senior Designer',
    company: {name: 'Acme', slug: 'acme', logoUrl: 'https://cdn.example.com/acme.png', website: 'https://acme.example', location: 'Berlin', aboutHtml: null, socials: []},
    employmentType: 'FULL_TIME',
    workplaceType: 'onsite',
    locationCity: 'Berlin',
    locationRegion: 'Berlin',
    locationCountry: 'DE',
    applicantCountries: [],
    salary: {minCents: 6_000_000, maxCents: 8_000_000, currency: 'EUR', period: 'YEAR'},
    featured: false,
    publishedAt: '2026-10-01T09:00:00.000Z',
    state: 'active',
    tags: ['figma'],
    descriptionHtml: '<p>Design <strong>things</strong>.</p>',
    category: {slug: 'design', name: 'Design'},
    applyMethod: 'onsite',
    applyTarget: null,
    expiresAt: '2026-10-31T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

describe('jobPostingJsonLd', () => {
  it('describes an on-site job with salary, location and direct apply', () => {
    const ld = jobPostingJsonLd(job(), board, absolute)!;
    expect(ld).toMatchObject({
      '@type': 'JobPosting',
      title: 'Senior Designer',
      description: '<p>Design <strong>things</strong>.</p>',
      datePosted: '2026-10-01T09:00:00.000Z',
      validThrough: '2026-10-31T09:00:00.000Z',
      employmentType: 'FULL_TIME',
      hiringOrganization: {'@type': 'Organization', name: 'Acme', sameAs: 'https://acme.example', logo: 'https://cdn.example.com/acme.png'},
      jobLocation: {'@type': 'Place', address: {addressLocality: 'Berlin', addressRegion: 'Berlin', addressCountry: 'DE'}},
      baseSalary: {'@type': 'MonetaryAmount', currency: 'EUR', value: {minValue: 60000, maxValue: 80000, unitText: 'YEAR'}},
      identifier: {'@type': 'PropertyValue', name: 'Talent Trail Hub', value: '42'},
      directApply: true,
      url: 'https://jobs.example.com/jobs/senior-designer/',
    });
    expect(ld).not.toHaveProperty('jobLocationType');
  });

  it('marks a remote job TELECOMMUTE with the allowed countries', () => {
    const ld = jobPostingJsonLd(
      job({workplaceType: 'remote', locationCity: null, locationRegion: null, locationCountry: null, applicantCountries: ['US', 'CA'], applyMethod: 'url', applyTarget: 'https://acme.example/apply'}),
      board,
      absolute
    )!;
    expect(ld.jobLocationType).toBe('TELECOMMUTE');
    expect(ld.applicantLocationRequirements).toEqual([
      {'@type': 'Country', name: 'United States'},
      {'@type': 'Country', name: 'Canada'},
    ]);
    expect(ld).not.toHaveProperty('jobLocation');
    expect(ld.directApply).toBe(false);
  });

  it('remote without listed countries falls back to the job country', () => {
    const ld = jobPostingJsonLd(job({workplaceType: 'remote', applicantCountries: []}), board, absolute)!;
    expect(ld.applicantLocationRequirements).toEqual([{'@type': 'Country', name: 'Germany'}]);
  });

  it('leaves baseSalary out when no salary is given, and uses one value for an equal range', () => {
    expect(jobPostingJsonLd(job({salary: null}), board, absolute)).not.toHaveProperty('baseSalary');
    const single = jobPostingJsonLd(job({salary: {minCents: 2500, maxCents: null, currency: 'USD', period: 'HOUR'}}), board, absolute)!;
    expect(single.baseSalary).toEqual({'@type': 'MonetaryAmount', currency: 'USD', value: {'@type': 'QuantitativeValue', value: 25, unitText: 'HOUR'}});
  });

  it('gives expired and closed jobs no JSON-LD', () => {
    expect(jobPostingJsonLd(job({state: 'expired'}), board, absolute)).toBeNull();
    expect(jobPostingJsonLd(job({state: 'closed'}), board, absolute)).toBeNull();
  });

  it('leaves URLs out when the site address is unknown, and escapes < in the script text', () => {
    const ld = jobPostingJsonLd(job({title: '</script><b>x'}), board, () => null)!;
    expect(ld).not.toHaveProperty('url');
    expect(jsonLdText(ld)).not.toContain('<');
  });
});

describe('featured pin rotation', () => {
  const ids = Array.from({length: 12}, (_, i) => i + 1);
  const at = new Date('2026-10-30T10:15:00Z');

  it('pins at most 5, the same within an hour whatever the input order', () => {
    const pinned = pickPinned(ids, at);
    expect(pinned).toHaveLength(5);
    expect(pickPinned([...ids].reverse(), new Date('2026-10-30T10:59:59Z'))).toEqual(pinned);
  });

  it('rotates across hours', () => {
    const hours = Array.from({length: 6}, (_, h) => pickPinned(ids, new Date(at.getTime() + h * 3_600_000)).join());
    expect(new Set(hours).size).toBeGreaterThan(1);
  });
});

describe('keyset cursor', () => {
  it('round-trips and refuses a cursor of the other sort', () => {
    const cursor = encodeCursor('newest', {id: 7, publishedAt: new Date(1_700_000_000_000), salaryMaxCents: null}, 472222);
    expect(cursorHour(cursor)).toBe(472222);
    expect(cursorWhere('newest', cursor)).not.toBeNull();
    expect(cursorWhere('salary', cursor)).toBeNull();
    expect(cursorWhere('newest', 'n1_2;drop')).toBeNull();
  });
});

describe('brand colours', () => {
  it('keeps accent pairs at WCAG AA in both schemes, even for a pale brand colour', () => {
    for (const color of ['#4f46e5', '#ffe600', '#00ffcc', '#111111']) {
      const light = accentTokens(color, 'light');
      const dark = accentTokens(color, 'dark');
      expect(contrast(light['--accent'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(light['--accent-ink'], light['--accent'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark['--accent'], '#0d1110')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark['--accent-ink'], dark['--accent'])).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('theme boot script', () => {
  it('matches the CSP hash the layouts insert', async () => {
    const {createHash} = await import('node:crypto');
    const {THEME_BOOT, THEME_BOOT_HASH} = await import('../src/lib/theme-boot');
    expect(`sha256-${createHash('sha256').update(THEME_BOOT).digest('base64')}`).toBe(THEME_BOOT_HASH);
  });
});

describe('clip', () => {
  it('cuts at a word boundary with an ellipsis, and leaves short text alone', async () => {
    const {clip} = await import('../src/lib/rich-text');
    expect(clip('short  text', 160)).toBe('short text');
    const out = clip('word '.repeat(60), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith('word…')).toBe(true);
  });
});
