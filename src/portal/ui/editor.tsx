import {type KeyboardEvent, type TextareaHTMLAttributes, useEffect, useRef, useState} from 'react';

import {renderMarkdown} from '../../lib/markdown';
import {applyMarkdown, type Edit, type MarkdownAction} from '../../lib/markdown-edit';
import {IconButton} from './button';
import {type IconName} from './icon';
import {SegmentedControl} from './nav';

const TOOLS: {action: MarkdownAction; icon: IconName; label: string; key?: string}[] = [
  {action: 'heading', icon: 'heading', label: 'Heading'},
  {action: 'bold', icon: 'bold', label: 'Bold', key: 'b'},
  {action: 'italic', icon: 'italic', label: 'Italic', key: 'i'},
  {action: 'bullets', icon: 'list', label: 'Bulleted list'},
  {action: 'numbers', icon: 'list-ordered', label: 'Numbered list'},
  {action: 'link', icon: 'link', label: 'Link', key: 'k'},
];

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * A textarea for the board's simple Markdown (job description, company about) with a toolbar
 * (heading, bold, italic, lists, link; ⌘/Ctrl B, I, K) and a Preview of the page's HTML. The
 * text stays Markdown, so the server, the stored value and the public page don't change.
 * Spread `form.field(name)` into it like a `<textarea>`, inside a `Field`.
 */
export function MarkdownEditor({
  value,
  onChange,
  ref,
  rows = 10,
  'aria-invalid': ariaInvalid,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'ref' | 'value' | 'onChange'> & {
  value: string;
  onChange: (event: {target: {value: string}}) => void;
  ref?: (node: HTMLElement | null) => void;
}) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const area = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelection = useRef<[number, number] | null>(null);

  // Back to Write when the field gets an error (the form focuses it, which a hidden one can't take).
  useEffect(() => {
    if (ariaInvalid && mode === 'preview') setMode('write');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaInvalid]);

  // A change made without the browser's undo stack (fallback below): restore the selection.
  useEffect(() => {
    const node = area.current;
    if (!node || !pendingSelection.current) return;
    node.setSelectionRange(...pendingSelection.current);
    pendingSelection.current = null;
  });

  const apply = (action: MarkdownAction) => {
    const node = area.current;
    if (!node) return;
    const before = node.value;
    const next: Edit = applyMarkdown(action, {value: before, start: node.selectionStart, end: node.selectionEnd});
    node.focus();
    // Replace only the part that changed, through the browser, so Ctrl/⌘ Z undoes a toolbar click.
    let head = 0;
    while (head < before.length && head < next.value.length && before[head] === next.value[head]) head++;
    let tail = 0;
    while (
      tail < before.length - head &&
      tail < next.value.length - head &&
      before[before.length - 1 - tail] === next.value[next.value.length - 1 - tail]
    )
      tail++;
    node.setSelectionRange(head, before.length - tail);
    let done = false;
    try {
      done = document.execCommand('insertText', false, next.value.slice(head, next.value.length - tail));
    } catch {
      done = false;
    }
    if (done && node.value === next.value) {
      node.setSelectionRange(next.start, next.end);
      return;
    }
    pendingSelection.current = [next.start, next.end];
    onChange({target: {value: next.value}});
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(MAC ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey) return;
    const tool = TOOLS.find(t => t.key === event.key.toLowerCase());
    if (!tool) return;
    event.preventDefault();
    apply(tool.action);
  };

  const shortcut = (key?: string) => (key ? ` (${MAC ? '⌘' : 'Ctrl+'}${key.toUpperCase()})` : '');

  return (
    <div className="md-editor" data-invalid={ariaInvalid ? '' : undefined}>
      <div className="md-editor-bar">
        <div className="md-editor-tools" role="toolbar" aria-label="Formatting">
          {TOOLS.map(tool => (
            <IconButton
              key={tool.action}
              icon={tool.icon}
              label={tool.label + shortcut(tool.key)}
              size="sm"
              disabled={mode === 'preview'}
              // Keep the textarea's selection: a click must not move focus before `apply` reads it.
              onMouseDown={event => event.preventDefault()}
              onClick={() => apply(tool.action)}
            />
          ))}
        </div>
        <SegmentedControl
          label="Editor view"
          value={mode}
          onChange={setMode}
          options={[
            {value: 'write', label: 'Write'},
            {value: 'preview', label: 'Preview'},
          ]}
        />
      </div>
      <textarea
        {...rest}
        ref={node => {
          area.current = node;
          ref?.(node);
        }}
        rows={rows}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        aria-invalid={ariaInvalid}
        hidden={mode === 'preview'}
      />
      {mode === 'preview' &&
        (value.trim() ? (
          <div className="md-editor-preview prose" dangerouslySetInnerHTML={{__html: renderMarkdown(value)}} />
        ) : (
          <p className="md-editor-preview muted">Nothing to preview yet.</p>
        ))}
    </div>
  );
}
