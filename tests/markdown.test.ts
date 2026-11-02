import {describe, expect, it} from 'vitest';

import {htmlToMarkdown, renderMarkdown} from '../src/lib/markdown';

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
