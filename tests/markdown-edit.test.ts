import {describe, expect, it} from 'vitest';

import {applyMarkdown} from '../src/lib/markdown-edit';
import {renderMarkdown} from '../src/lib/markdown';

/** `|` marks the caret, `[` `]` a selection. */
function run(action: Parameters<typeof applyMarkdown>[0], text: string): string {
  const caret = text.indexOf('|');
  let start: number, end: number, value: string;
  if (caret >= 0) {
    value = text.replace('|', '');
    start = end = caret;
  } else {
    start = text.indexOf('[');
    end = text.indexOf(']') - 1;
    value = text.replace('[', '').replace(']', '');
  }
  const out = applyMarkdown(action, {value, start, end});
  return out.start === out.end
    ? out.value.slice(0, out.start) + '|' + out.value.slice(out.start)
    : out.value.slice(0, out.start) + '[' + out.value.slice(out.start, out.end) + ']' + out.value.slice(out.end);
}

describe('applyMarkdown', () => {
  it('wraps the selection in bold and unwraps it again', () => {
    expect(run('bold', 'a [word] b')).toBe('a **[word]** b');
    expect(run('bold', 'a **[word]** b')).toBe('a [word] b');
    expect(run('bold', 'a [word ]b')).toBe('a **[word]** b');
    expect(run('bold', 'a |b')).toBe('a **[bold text]**b');
    expect(run('italic', '[x]')).toBe('_[x]_');
  });

  it('prefixes every selected line, swaps another marker, and toggles off', () => {
    expect(run('bullets', '[one\ntwo]')).toBe('[- one\n- two]');
    expect(run('bullets', '[- one\n- two]')).toBe('[one\ntwo]');
    expect(run('numbers', '[- one\n\n- two]')).toBe('[1. one\n\n2. two]');
    expect(run('heading', 'intro\nBene|fits')).toBe('intro\n## Bene|fits');
    expect(run('heading', '## Bene|fits')).toBe('Bene|fits');
  });

  it('makes a link with the URL or the label selected', () => {
    expect(run('link', 'see [docs] now')).toBe('see [docs]([https://]) now');
    expect(run('link', 'see | now')).toBe('see [[link text]](https://) now');
  });

  it('writes Markdown the page renders', () => {
    const value = applyMarkdown('bullets', {value: 'one\ntwo', start: 0, end: 7}).value;
    expect(renderMarkdown(value)).toBe('<ul><li>one</li><li>two</li></ul>');
    expect(renderMarkdown(applyMarkdown('heading', {value: 'Benefits', start: 0, end: 0}).value)).toBe('<h3>Benefits</h3>');
  });
});
