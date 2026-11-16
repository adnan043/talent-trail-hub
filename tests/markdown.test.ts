import {describe, expect, it} from 'vitest';

import {htmlToMarkdown, renderMarkdown} from '../src/lib/markdown';
import {htmlToText} from '../src/lib/rich-text';

/** The board's simple Markdown: shaped here, made safe by sanitizeRichText (security boundary). */
describe('renderMarkdown', () => {
  it('renders the supported constructs', () => {
    const html = renderMarkdown('## Role\n\nWe **build** _things_.\n\n- one\n- two\n\n1. a\n2. b');
    expect(html).toContain('<h3>Role</h3>');
    expect(html).toContain('<strong>build</strong>');
    expect(html).toContain('<em>things</em>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>a</li><li>b</li></ol>');
  });

  it('keeps link hrefs out of the emphasis passes', () => {
    const html = renderMarkdown('See [the docs](https://a.example/x_y_z__w*v*) now.');
    expect(html).toContain('href="https://a.example/x_y_z__w*v*"');
    expect(html).not.toContain('<em>');
    expect(html).toContain('>the docs</a>');
  });

  it('never lets HTML or unsafe links through', () => {
    const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1))');
    expect(html).not.toMatch(/<script|<img|href="javascript/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it('cuts closing hashes from headings', () => {
    expect(renderMarkdown('## Role ##')).toBe('<h3>Role</h3>');
    expect(renderMarkdown('#### Small')).toBe('<h4>Small</h4>');
  });

  it('stays fast on a long run of spaces in a heading (no ReDoS)', () => {
    const start = Date.now();
    renderMarkdown('# a' + ' '.repeat(10_000) + 'b');
    renderMarkdown('# a' + '\t'.repeat(10_000) + 'b' + '#'.repeat(5_000) + ' x');
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('htmlToText keeps one break between blocks and stays fast on long space runs', () => {
    expect(htmlToText('<p>One  \u00a0two</p>\n \n<p> three</p><ul><li>a</li><li>b</li></ul>')).toBe('One two\nthree\na\nb');
    const start = Date.now();
    htmlToText('a' + '\u00a0'.repeat(50_000) + 'b');
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('round-trips through htmlToMarkdown', () => {
    const md = '### Title\n\nA **bold** line\n\n- item';
    expect(renderMarkdown(htmlToMarkdown(renderMarkdown(md)))).toBe(renderMarkdown(md));
  });
});

describe('apply target rules (client = server)', () => {
  const check = async (applyMethod: string, applyTarget: string) => {
    const {checkJobValues, EMPTY_JOB_VALUES} = await import('../src/lib/job-input');
    return checkJobValues({...EMPTY_JOB_VALUES, applyMethod, applyTarget}).applyTarget;
  };
  it('accepts a plain address and an https link', async () => {
    expect(await check('email', 'jobs@acme.example.com')).toBeUndefined();
    expect(await check('url', 'https://acme.example/careers?id=1')).toBeUndefined();
  });
  it('refuses mailto tricks and plain http', async () => {
    for (const bad of ['x@y.com?bcc=a@b.com', 'x@y.com&body=hi', 'a b@y.com', '"x"@y.com', '<x@y.com>', 'x@@y.com', 'x@localhost']) {
      expect(await check('email', bad)).toBeDefined();
    }
    expect(await check('url', 'http://acme.example/careers')).toBeDefined();
    expect(await check('url', 'javascript:alert(1)')).toBeDefined();
  });
});

describe('salary limits (client = server)', () => {
  it('a salary past what the cents column holds is a field error, never a database error', async () => {
    const {checkJobValues, EMPTY_JOB_VALUES, SALARY_MAX} = await import('../src/lib/job-input');
    const check = (salaryMin: string, salaryMax: string) => checkJobValues({...EMPTY_JOB_VALUES, salaryMin, salaryMax});
    expect(check(String(SALARY_MAX), '').salaryMin).toBeUndefined();
    expect(check('21474837', '').salaryMin).toMatch(/at most/);
    expect(check('', '999999999').salaryMax).toMatch(/at most/);
    // Every accepted value fits a 32-bit integer in cents.
    expect(SALARY_MAX * 100).toBeLessThanOrEqual(2_147_483_647);
  });
});
