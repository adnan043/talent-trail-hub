import {htmlToText, sanitizeRichText} from './rich-text';

/**
 * The board's SIMPLE Markdown (job descriptions, company "about"), browser-safe: the wizard's
 * preview and the server render the same HTML from the same text.
 *
 *   ## Heading / ### Heading   → <h3>      #### Heading → <h4>
 *   - item / * item            → <ul>      1. item      → <ol>
 *   **bold**, __bold__         → <strong>  *em*, _em_   → <em>
 *   [label](https://…)         → <a>       (https, http, mailto only)
 *   a blank line               → a new paragraph
 *
 * Everything is escaped first, then the few constructs above become tags, then the result goes
 * through `sanitizeRichText` (src/lib/rich-text.ts), the board's allow-list: the sanitizer is the
 * security boundary, this renderer only shapes the text.
 */

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text: string): string {
  // Links first, parked behind placeholders, so the emphasis passes never touch an href
  // (`https://a.example/x_y_z` keeps its underscores).
  const links: string[] = [];
  const parked = escape(text)
    .replace(/\u0000/g, '')
    .replace(/\[([^\]\n]{1,300})\]\(((?:https?:\/\/|mailto:)[^\s)]{1,500})\)/g, (_, label: string, href: string) => {
      links.push(href);
      return `\u0000${links.length - 1}\u0001${label}\u0000/\u0001`;
    });
  return parked
    .replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([^_]*?\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0001/g, (_, i: string) => `<a href="${links[Number(i)]}">`)
    .replace(/\u0000\/\u0001/g, '</a>');
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*\d{1,3}[.)]\s+(.*)$/;
// Linear on purpose: `\s*#*\s*$` after a lazy group backtracks cubically on a long run of spaces
// (a CPU-burning job description). The closing `#`s are cut by `headingText`, without a regex.
const HEADING = /^(#{1,6})\s+(.*)$/;

/** A heading's text without its optional closing `#`s and the spaces around them. */
function headingText(text: string): string {
  let end = text.trimEnd().length;
  while (end > 0 && text[end - 1] === '#') end--;
  return text.slice(0, end).trimEnd();
}

/** Markdown → HTML (NOT sanitized yet: use `renderMarkdown`). */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: {tag: 'ul' | 'ol'; items: string[]} | null = null;
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map(item => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line.trim());
    const bullet = BULLET.exec(line);
    const number = bullet ? null : NUMBER.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const tag = heading[1]!.length >= 4 ? 'h4' : 'h3';
      out.push(`<${tag}>${inline(headingText(heading[2]!))}</${tag}>`);
    } else if (bullet || number) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (list && (list as {tag: string}).tag !== tag) flushList();
      list ??= {tag, items: []};
      list.items.push((bullet ?? number)![1]!);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // An indented line continues the last list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return out.join('\n');
}

/** Markdown → the sanitized HTML that is stored and shown (job page, company page, preview). */
export function renderMarkdown(markdown: string): string {
  return sanitizeRichText(markdownToHtml(markdown));
}

/** The visible length of rendered Markdown: the "at least 200 characters" rule, client and server. */
export function markdownTextLength(markdown: string): number {
  return htmlToText(renderMarkdown(markdown)).length;
}

// ------------------------------------------------------------ HTML → Markdown --

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: ' '};
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (_, name: string) => ENTITIES[name]!);

function inlineMd(html: string): string {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => `[${text}](${href})`)
      .replace(/<\/?strong>/gi, '**')
      .replace(/<\/?em>/gi, '_')
      .replace(/<[^>]+>/g, '')
  ).trim();
}

function listMd(body: string, ordered: boolean): string {
  const items = [...body.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map(m => inlineMd(m[1]!.replace(/<\/?(ul|ol)>/gi, ' ')));
  return items.map((item, i) => `${ordered ? `${i + 1}.` : '-'} ${item}`).join('\n');
}

/**
 * Stored (sanitized) HTML → the same simple Markdown, for editing a text that has no Markdown
 * copy (a company's "about", an imported job). Saving renders and sanitizes it again.
 */
export function htmlToMarkdown(html: string): string {
  const blocks: string[] = [];
  const re = /<(h3|h4|p|ul|ol)>([\s\S]*?)<\/\1>/gi;
  let last = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const loose = inlineMd(html.slice(last, m.index));
    if (loose) blocks.push(loose);
    const tag = m[1]!.toLowerCase();
    const body = m[2]!;
    if (tag === 'h3') blocks.push(`### ${inlineMd(body)}`);
    else if (tag === 'h4') blocks.push(`#### ${inlineMd(body)}`);
    else if (tag === 'p') blocks.push(inlineMd(body));
    else blocks.push(listMd(body, tag === 'ol'));
    last = re.lastIndex;
  }
  const rest = inlineMd(html.slice(last));
  if (rest) blocks.push(rest);
  return blocks.filter(Boolean).join('\n\n');
}
