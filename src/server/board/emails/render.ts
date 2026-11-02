import type {EmailTemplate} from './templates';

/**
 * Renders a board email template (./templates.ts) to a subject, a plain-text part and a simple
 * HTML part. The template's markup (`**bold**`, `[label](url)`, blank-line paragraphs) is
 * trusted; VALUES are not: they are inserted after the markup is parsed, HTML-escaped, so a job
 * title or a candidate's name can never add a tag, a link or a header line.
 */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

type Vars = Record<string, string>;

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;
const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** `{{name}}` → its value (control characters removed); unknown names become ''. */
function fill(text: string, vars: Vars, transform: (v: string) => string = v => v): string {
  return text.replace(PLACEHOLDER, (_, name: string) => transform((vars[name] ?? '').replace(CONTROL, '')));
}

/** Makes `…Url` values that are site paths absolute on `origin`. */
export function absoluteLinks(vars: Vars, origin: string): Vars {
  const out: Vars = {};
  for (const [name, value] of Object.entries(vars)) {
    out[name] = name.endsWith('Url') && value.startsWith('/') && !value.startsWith('//') ? origin + value : value;
  }
  return out;
}

/** An absolute http(s) URL, or null (a link is never `javascript:` or relative in an email). */
function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** One paragraph → [html, text], or null when nothing is left once its values are in. */
function paragraph(source: string, vars: Vars): [string, string] | null {
  const htmlLines: string[] = [];
  const textLines: string[] = [];
  const lines = source.split('\n');
  for (const line of lines) {
    let html = '';
    let text = '';
    let last = 0;
    let onlyLink = true;
    let linkMissing = false;
    for (const m of line.matchAll(INLINE)) {
      const before = line.slice(last, m.index);
      if (fill(before, vars).trim()) onlyLink = false;
      html += fill(before, vars, escapeHtml);
      text += fill(before, vars);
      if (m[1] !== undefined) {
        onlyLink = false;
        html += `<strong>${fill(m[1], vars, escapeHtml)}</strong>`;
        text += fill(m[1], vars);
      } else {
        const label = fill(m[2]!, vars);
        const href = safeUrl(fill(m[3]!, vars).trim());
        if (!href) linkMissing = true;
        html += href ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : escapeHtml(label);
        text += href ? `${label} (${href})` : label;
      }
      last = m.index! + m[0].length;
    }
    const rest = line.slice(last);
    if (fill(rest, vars).replace(/[.\s]/g, '')) onlyLink = false;
    html += fill(rest, vars, escapeHtml);
    text += fill(rest, vars);
    // A line that is only a link to nowhere (no receipt URL, say) is left out.
    if (onlyLink && linkMissing) continue;
    if (!text.trim()) continue;
    htmlLines.push(html.trim());
    textLines.push(text.trim());
  }
  if (!textLines.length) return null;
  return [`<p style="margin:0 0 16px;">${htmlLines.join('<br>')}</p>`, textLines.join('\n')];
}

export function renderEmail(template: EmailTemplate, vars: Vars): RenderedEmail {
  // A mail header: one line, whatever the values hold.
  const subject = fill(template.subject, vars).replace(/\s+/g, ' ').trim().slice(0, 200);
  const parts = template.body
    .split(/\n{2,}/)
    .map(p => paragraph(p, vars))
    .filter((p): p is [string, string] => p !== null);
  const boardName = escapeHtml(vars.boardName ?? '');
  const html = [
    '<!doctype html><html><body style="margin:0;background:#f5f5f5;">',
    '<div style="max-width:560px;margin:0 auto;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#171717;">',
    boardName ? `<p style="font-weight:600;font-size:17px;margin:0 0 16px;">${boardName}</p>` : '',
    '<div style="background:#ffffff;border-radius:8px;padding:24px;">',
    parts.map(p => p[0]).join(''),
    '</div></div></body></html>',
  ].join('');
  return {subject, text: parts.map(p => p[1]).join('\n\n'), html};
}
