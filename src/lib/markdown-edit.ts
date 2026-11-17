/**
 * The Markdown editor's toolbar actions (src/portal/ui/editor.tsx), as pure functions: each takes
 * the text and the selection and returns the new text and selection. They write the board's
 * SIMPLE Markdown only (src/lib/markdown.ts), so what the toolbar makes is what the page shows.
 */

export interface Edit {
  value: string;
  start: number;
  end: number;
}

export type MarkdownAction = 'heading' | 'bold' | 'italic' | 'bullets' | 'numbers' | 'link';

/** `**bold**` / `_italic_` around the selection; again on wrapped text takes the markers off. */
function wrap({value, start, end}: Edit, marker: string, placeholder: string): Edit {
  const before = value.slice(start - marker.length, start);
  const after = value.slice(end, end + marker.length);
  if (before === marker && after === marker) {
    return {
      value: value.slice(0, start - marker.length) + value.slice(start, end) + value.slice(end + marker.length),
      start: start - marker.length,
      end: end - marker.length,
    };
  }
  const selected = value.slice(start, end);
  // Spaces stay outside the markers (`** bold**` is not bold).
  const lead = selected.length - selected.trimStart().length;
  const trail = selected.length - selected.trimEnd().length;
  const text = selected.trim() || placeholder;
  const from = start + lead;
  const to = selected.trim() ? end - trail : start;
  return {
    value: value.slice(0, from) + marker + text + marker + value.slice(to),
    start: from + marker.length,
    end: from + marker.length + text.length,
  };
}

/** The start of the line `at` is on, and the end of the line `to` is on. */
function lineBounds(value: string, at: number, to: number): [number, number] {
  const first = value.lastIndexOf('\n', at - 1) + 1;
  // A selection that ends right after a newline does not include the next line.
  const last = to > at && value[to - 1] === '\n' ? to - 1 : to;
  const end = value.indexOf('\n', last);
  return [first, end === -1 ? value.length : end];
}

const PREFIXES = {
  heading: {test: /^#{1,6}\s+/, make: () => '## '},
  bullets: {test: /^\s*[-*+]\s+/, make: () => '- '},
  numbers: {test: /^\s*\d{1,3}[.)]\s+/, make: (i: number) => `${i + 1}. `},
} as const;

/** `## ` / `- ` / `1. ` at the start of every selected line; again when all have it takes it off. */
function prefixLines({value, start, end}: Edit, kind: keyof typeof PREFIXES): Edit {
  const [from, to] = lineBounds(value, start, end);
  const lines = value.slice(from, to).split('\n');
  const {test, make} = PREFIXES[kind];
  const filled = lines.filter(line => line.trim());
  // Only blank lines (a fresh line, an empty editor): the marker goes in, the caret after it.
  if (!filled.length) {
    const marker = make(0);
    const at = from + lines[0]!.length;
    return {value: value.slice(0, at) + marker + value.slice(at), start: at + marker.length, end: at + marker.length};
  }
  const remove = filled.every(line => test.test(line));
  let n = 0;
  const next = lines.map(line => {
    // A blank line ends a list on the page (src/lib/markdown.ts): numbering starts again after it.
    if (!line.trim()) {
      n = 0;
      return line;
    }
    // Any other list / heading marker is swapped, not stacked (`- 1. item`).
    const bare = line.replace(PREFIXES.heading.test, '').replace(PREFIXES.bullets.test, '').replace(PREFIXES.numbers.test, '');
    return remove ? bare : make(n++) + bare;
  });
  const text = next.join('\n');
  // A single line with nothing selected keeps the caret where it was in the text.
  if (start === end && lines.length === 1) {
    const caret = Math.max(from, start + text.length - (to - from));
    return {value: value.slice(0, from) + text + value.slice(to), start: caret, end: caret};
  }
  return {value: value.slice(0, from) + text + value.slice(to), start: from, end: from + text.length};
}

/** `[selection](https://)` with the URL selected; with no selection, the label is selected. */
function link({value, start, end}: Edit): Edit {
  const raw = value.slice(start, end);
  // A label is one line (the page reads no link across lines); spaces around it stay outside.
  const selected = raw.trim().replace(/\s*\n\s*/g, ' ');
  const from = selected ? start + (raw.length - raw.trimStart().length) : start;
  const to = selected ? end - (raw.length - raw.trimEnd().length) : end;
  const label = selected || 'link text';
  const url = 'https://';
  const text = `[${label}](${url})`;
  const next = value.slice(0, from) + text + value.slice(to);
  if (selected) {
    const at = from + label.length + 3;
    return {value: next, start: at, end: at + url.length};
  }
  return {value: next, start: from + 1, end: from + 1 + label.length};
}

export function applyMarkdown(action: MarkdownAction, edit: Edit): Edit {
  switch (action) {
    case 'bold':
      return wrap(edit, '**', 'bold text');
    case 'italic':
      return wrap(edit, '_', 'italic text');
    case 'link':
      return link(edit);
    default:
      return prefixLines(edit, action);
  }
}
