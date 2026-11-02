import xssModule from 'xss';

// xss is CommonJS with dynamically assigned exports: Node's ESM loader (Vite SSR in dev and
// scripts) can't see its named exports, so take them from module.exports (the default import).
const {cssFilter, FilterXSS, safeAttrValue} = xssModule as unknown as typeof import('xss');

// THE rich-text sanitizer for the board (job descriptions, company about): stricter than
// src/platform/sanitize.ts (no iframes, no images). Rich-text sanitizer for job descriptions and other user-written HTML. Pure JS (no DOM),
// so it runs in the Worker, in Node and in the browser (wizard preview renders the same
// output as the public page). Allow-list from CLAUDE.md.

export const ALLOWED_TAGS = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'h3', 'h4', 'br'] as const;

/** Common editor/paste tags rewritten to their allowed equivalent (no attributes kept). */
const TAG_ALIASES: Record<string, string> = {b: 'strong', i: 'em', h1: 'h3', h2: 'h3', h5: 'h4', h6: 'h4'};

/**
 * Elements removed together with their content (up to the matching close tag, or the end if
 * unclosed). Cosmetic pre-pass only: the xss filter below is the security boundary and
 * strips any tag this misses. (xss's own stripIgnoreTagBody leaves "[removed]" markers on
 * nested/unclosed tags.) Everything else not allowed keeps its text.
 */
const DROP_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'textarea', 'select', 'svg', 'math', 'head', 'title'];
const DROP_RE = new RegExp(`<(${DROP_WITH_CONTENT.join('|')})\\b[\\s\\S]*?(?:<\\/\\1\\s*>|$)`, 'gi');

const LINK_REL = 'nofollow noopener noreferrer ugc';

const filter = new FilterXSS({
  whiteList: Object.fromEntries(ALLOWED_TAGS.map((tag) => [tag, tag === 'a' ? ['href'] : []])),
  stripIgnoreTag: true,
  allowCommentTag: false,
  css: false,
  onTag(tag, _html, info) {
    const alias = TAG_ALIASES[tag];
    if (alias) return info.isClosing ? `</${alias}>` : `<${alias}>`;
    return undefined;
  },
  onTagAttr(tag, name, value) {
    if (tag !== 'a' || name !== 'href') return undefined;
    // safeAttrValue decodes entities, trims and escapes; we then allow only absolute web/mail links.
    const href = safeAttrValue(tag, name, value, cssFilter);
    if (!/^(https?:\/\/|mailto:)/.test(href)) return '';
    return `href="${href}" rel="${LINK_REL}" target="_blank"`;
  },
});

/** Returns HTML containing only the allowed tags; links get rel/target, unsafe hrefs are dropped. */
export function sanitizeRichText(html: string): string {
  return filter.process(html.replace(DROP_RE, '')).trim();
}

/** Visible text length of rich text (for "≥200 characters" style rules). */
export function richTextLength(html: string): number {
  return htmlToText(html).length;
}

/** `text` cut to at most `max` characters at a word boundary, with "…" when cut (meta descriptions). */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

/** Plain-text version of sanitized HTML (meta descriptions, feeds, emails). */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h3|h4)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}
