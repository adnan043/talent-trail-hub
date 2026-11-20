import {
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {createPortal} from 'react-dom';

import {type PasswordCheck} from '../../lib/password-checks';
import {type Rule, rules} from '../../lib/rules';
import {Icon} from './icon';
import {Menu} from './overlay';

/**
 * Form controls. EVERY field in the portal uses these (AGENTS.md "Buttons and
 * forms"): a field always has a visible label and shows its own error in
 * place, in words, never a browser bubble. Text inputs and textareas are
 * plain `<input>` / `<textarea>` inside a `Field`, wired with
 * `{...form.field('name')}`; `.field` styles them.
 */

// ----------------------------------------------------------------- fields --

/**
 * One labelled field: the label, the control, a hint, and its error IN PLACE.
 * The control gets its wiring from `form.field(name)` (id, value, onChange,
 * onBlur, aria-invalid, aria-describedby).
 */
export function Field({
  label,
  hint,
  error,
  id,
  optional,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  id: string;
  optional?: boolean;
  children: ReactElement;
}) {
  return (
    <div className="field" data-invalid={error ? '' : undefined}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="muted"> (optional)</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// -------------------------------------------------------------- passwords --

/**
 * A new-password input with a show / hide button. Spread `form.field(name)`
 * into it as into an `<input>`. Pair it with `PasswordChecks` so the rules
 * show while typing (`src/lib/password-checks.ts`).
 */
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement> & {ref?: (node: HTMLInputElement | null) => void}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="pw-input">
      <input {...props} type={shown ? 'text' : 'password'} />
      <button
        className="pw-reveal"
        type="button"
        aria-controls={props.id}
        aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}
        onClick={() => setShown(value => !value)}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

/** The live rules under a password field; missing ones turn red once `tried`. */
export function PasswordChecks({id, checks, tried}: {id: string; checks: PasswordCheck[]; tried?: boolean}) {
  return (
    <ul className="pw-checks" id={id} data-tried={tried ? '' : undefined}>
      {checks.map(check => (
        <li key={check.id} data-ok={check.ok ? '' : undefined}>
          {check.label}
          <span className="pw-checks-state">{check.ok ? ' (done)' : ' (not yet)'}</span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------- validation --

// Pure rules live in `src/lib/rules.ts` (shared with the website's forms).
export {rules, type Rule};

type Values = Record<string, string | boolean>;
type Schema<V extends Values> = Partial<Record<keyof V, Rule[]>>;
type Errors<V extends Values> = Partial<Record<keyof V, string>>;

/**
 * A small form state: values, per-field errors, when to show them.
 *
 * - An error shows after the field is left (blur) or after a submit attempt,
 *   never while the visitor is still typing their first value; once shown it
 *   updates on every keystroke, so it disappears the moment the value is right.
 * - `submit(onValid)` validates everything, shows every error, focuses the
 *   first wrong field, and only then calls `onValid`.
 * - `setServerErrors` puts the server's answer on the fields it names.
 */
export function useForm<V extends Values>(initial: V, schema: Schema<V>) {
  const [values, setValues] = useState<V>(initial);
  const [touched, setTouched] = useState<Partial<Record<keyof V, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [server, setServer] = useState<Errors<V>>({});
  const refs = useRef<Partial<Record<keyof V, HTMLElement | null>>>({});

  const check = (name: keyof V, all: V = values): string | undefined => {
    const value = all[name];
    if (typeof value !== 'string') return undefined;
    for (const rule of schema[name] ?? []) {
      const message = rule(value);
      if (message) return message;
    }
    return undefined;
  };
  const errorOf = (name: keyof V) =>
    touched[name] || submitted ? (server[name] ?? check(name)) : server[name];

  const set = <K extends keyof V>(name: K, value: V[K]) => {
    setValues(current => ({...current, [name]: value}));
    setServer(current => ({...current, [name]: undefined}));
  };

  /** Everything a text input, textarea or select needs. */
  const field = (name: keyof V & string) => {
    const error = errorOf(name);
    const id = `f-${name}`;
    return {
      id,
      name,
      value: String(values[name] ?? ''),
      ref: (node: HTMLElement | null) => {
        refs.current[name] = node;
      },
      onChange: (event: {target: {value: string}}) => set(name, event.target.value as V[typeof name]),
      onBlur: () => setTouched(current => ({...current, [name]: true})),
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? `${id}-error` : `${id}-hint`,
    };
  };

  const submit = (onValid: (values: V) => void) => (event?: FormEvent) => {
    event?.preventDefault();
    setSubmitted(true);
    const first = (Object.keys(schema) as (keyof V)[]).find(name => check(name));
    if (first) {
      refs.current[first]?.focus();
      return;
    }
    onValid(values);
  };

  const reset = (next: V = initial) => {
    setValues(next);
    setTouched({});
    setSubmitted(false);
    setServer({});
  };

  return {
    values,
    set,
    field,
    error: errorOf,
    submit,
    reset,
    setServerErrors: (errors: Errors<V>) => setServer(errors),
  };
}

// ---------------------------------------------------------------- choices --

/**
 * A dropdown for a LONG list (countries, time zones, 6+ options). Five or
 * fewer options: `RadioCards` (every choice visible, with an explanation).
 * Spread `form.field(name)` into it like an `<input>`.
 */
export function Select({
  options,
  value,
  onChange,
  onBlur,
  disabled,
  id,
  ref,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': describedBy,
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'ref'> & {
  options: {value: string; label: string}[];
  ref?: (node: HTMLElement | null) => void;
}) {
  const current = options.find(option => option.value === String(value ?? ''));
  return (
    <Menu
      field
      align="start"
      label={ariaLabel ?? current?.label ?? 'Choose'}
      disabled={disabled}
      trigger={<span className="menu-trigger-value">{current?.label ?? options[0]?.label ?? ''}</span>}
      triggerProps={{id, ref, 'aria-invalid': ariaInvalid, 'aria-describedby': describedBy}}
      onClose={() => onBlur?.({} as FocusEvent<HTMLSelectElement>)}
      items={options.map(option => ({
        label: option.label,
        checked: option.value === current?.value,
        onSelect: () => onChange?.({target: {value: option.value}, currentTarget: {value: option.value}} as ChangeEvent<HTMLSelectElement>),
      }))}
    />
  );
}

/**
 * A dropdown you can type into: a search box and a picker in one. Typing calls
 * `onQueryChange` (the caller narrows `options`, on the server or not); the
 * list opens under it, arrows move, Enter picks, Esc closes. Closed, the box
 * shows the picked option's label. Spread `form.field(name)` into it.
 */
export function Combobox({
  options,
  value,
  onChange,
  onBlur,
  onQueryChange,
  placeholder,
  emptyLabel = 'Nothing matches.',
  disabled,
  id,
  ref,
  'aria-invalid': ariaInvalid,
  'aria-describedby': describedBy,
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'ref'> & {
  options: {value: string; label: string}[];
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  ref?: (node: HTMLElement | null) => void;
}) {
  const current = options.find(option => option.value === String(value ?? ''));
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null); // null: not typing, show the picked label
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();

  const query = (next: string | null) => {
    setText(next);
    onQueryChange?.(next ?? '');
  };
  const close = () => {
    setOpen(false);
    if (text !== null) query(null);
    onBlur?.({} as FocusEvent<HTMLSelectElement>);
  };
  const pick = (option: {value: string}) => {
    onChange?.({target: {value: option.value}, currentTarget: {value: option.value}} as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
    query(null);
  };

  // The list sits under (or over) the box, as wide as it, and scrolls inside itself. Placed when it
  // opens and when its row count changes (its height), then on resize and scroll: not after every
  // render (each keystroke and arrow key), which forced a layout read each time.
  const rows = options.length;
  useLayoutEffect(() => {
    if (!open || !input.current || !list.current) return;
    const place = () => {
      const rect = input.current!.getBoundingClientRect();
      const menu = list.current!;
      menu.style.width = `${rect.width}px`;
      menu.style.maxHeight = '';
      const natural = menu.offsetHeight;
      const roomBelow = window.innerHeight - rect.bottom - 18;
      const roomAbove = rect.top - 18;
      const below = roomBelow >= Math.min(natural, 240) || roomBelow >= roomAbove;
      menu.style.maxHeight = `${Math.max(120, Math.min(320, below ? roomBelow : roomAbove))}px`;
      menu.style.top = `${below ? rect.bottom + 6 : rect.top - menu.offsetHeight - 6}px`;
      menu.style.left = `${rect.left}px`;
    };
    place();
    const scrolled = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) place();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scrolled, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scrolled, true);
    };
  }, [open, rows]);

  // The highlighted option stays in range and in view as the list changes.
  const at = Math.min(active, Math.max(0, options.length - 1));
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({block: 'nearest'});
  }, [open, at]);

  const openAt = () => {
    if (text === null) query('');
    setOpen(true);
    setActive(Math.max(0, options.findIndex(option => option === current)));
  };

  return (
    <div className="combobox">
      <input
        ref={node => {
          input.current = node;
          ref?.(node);
        }}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options.length ? `${listId}-${at}` : undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={describedBy}
        disabled={disabled}
        // Typing starts from an empty box: the picked label stays visible as the placeholder.
        placeholder={text !== null && current ? current.label : placeholder}
        value={text ?? current?.label ?? ''}
        onFocus={() => text === null && query('')}
        onClick={() => {
          if (!open) openAt();
        }}
        onChange={event => {
          query(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onBlur={event => {
          if (!list.current?.contains(event.relatedTarget as Node)) close();
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) return openAt();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((at + step + options.length) % Math.max(1, options.length));
          } else if (event.key === 'Enter') {
            // Inside a form: Enter picks, never submits.
            event.preventDefault();
            if (open && options[at]) pick(options[at]);
            else openAt();
          } else if (event.key === 'Escape' && open) {
            // Only the list closes: not the drawer or modal it may sit in.
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            query(null);
          }
        }}
      />
      <Icon name="chevron-down" size={16} className="combobox-chevron" />
      {open &&
        createPortal(
          <div ref={list} id={listId} className="menu combobox-list" role="listbox" tabIndex={-1} onPointerDown={event => event.preventDefault()}>
            {options.length === 0 && <div className="combobox-empty">{emptyLabel}</div>}
            {options.map((option, i) => (
              <div
                key={option.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={option === current}
                className={['menu-item', option === current ? 'menu-item-checked' : '', i === at ? 'combobox-active' : ''].filter(Boolean).join(' ')}
                onPointerMove={() => i !== at && setActive(i)}
                onClick={() => pick(option)}>
                {option.label}
              </div>
            ))}
          </div>,
          input.current?.closest('dialog[open]') ?? document.body
        )}
    </div>
  );
}

/** A checkbox with its label (and an optional line under it). */
export function Checkbox({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="checkbox" data-disabled={disabled ? '' : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
      <span>
        <span className="checkbox-label">{label}</span>
        {description && <span className="checkbox-description">{description}</span>}
      </span>
    </label>
  );
}

/**
 * An on / off setting that applies AT ONCE (no Save button): "Remote",
 * "Email me a weekly summary". A choice that is saved with a form is a
 * `Checkbox`. While saving, pass `pending`: the switch is disabled.
 */
export function Switch({
  label,
  description,
  checked,
  onChange,
  disabled,
  pending,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  pending?: boolean;
}) {
  const id = useId();
  return (
    <div className="switch-row">
      <span className="switch-text">
        <span className="switch-label" id={`${id}-label`}>
          {label}
        </span>
        {description && (
          <span className="switch-description" id={`${id}-description`}>
            {description}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        aria-busy={pending || undefined}
        disabled={disabled || pending}
        onClick={() => onChange(!checked)}>
        <span className="switch-thumb" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Two to five choices, each one visible with a title, a line of explanation
 * and a tick on the picked one. Use it instead of a dropdown for short lists.
 */
export function RadioCards<V extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  columns = 2,
}: {
  legend: ReactNode;
  name: string;
  value: V;
  onChange: (value: V) => void;
  options: {value: V; title: ReactNode; description?: ReactNode; disabled?: boolean}[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <fieldset className="radio-cards">
      <legend>{legend}</legend>
      <div className={`radio-cards-grid cols-${columns}`}>
        {options.map(option => (
          <label key={option.value} className="radio-card" data-disabled={option.disabled ? '' : undefined}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="radio-card-body">
              <span className="radio-card-title">{option.title}</span>
              {option.description && <span className="radio-card-description">{option.description}</span>}
            </span>
            <span className="radio-card-tick" aria-hidden="true">
              <Icon name="check" size={14} />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A search box for a toolbar: an icon, a visible-to-screen-readers label. */
export function SearchInput({label, ...props}: InputHTMLAttributes<HTMLInputElement> & {label: string}) {
  return (
    <span className="search-input">
      <Icon name="search" size={16} />
      <input type="search" aria-label={label} {...props} />
    </span>
  );
}
