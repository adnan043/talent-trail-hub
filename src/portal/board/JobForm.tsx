import {type ReactNode, useEffect, useRef} from 'react';

import {
  APPLY_METHODS,
  EMPLOYMENT_LABELS,
  EMPLOYMENT_TYPES,
  LIMITS,
  SALARY_PERIOD_LABELS,
  SALARY_PERIODS,
  WORKPLACE_LABELS,
  WORKPLACE_TYPES,
  type ApplyMethod,
  type WorkplaceType,
} from '../../lib/board';
import {countryOptions} from '../../lib/job-display';
import {checkJobValues, type JobField, type JobValues} from '../../lib/job-input';
import {markdownTextLength} from '../../lib/markdown';
import {Button, Field, RadioCards, type Rule, Select, useForm} from '../ui';

/**
 * The job fields form (title, category, type, workplace, location or applicant countries,
 * salary, Markdown description, tags, apply method), shared by the employer's post-a-job wizard
 * and edit screen (workstream C) and the admin's jobs (D). Its rules ARE the server's:
 * `checkJobValues` (src/lib/job-input.ts) runs on both sides. Send the values as they are
 * (`{job: values}`); the server checks them again and answers `422 {fields}` with the same names.
 *
 *   <JobForm initial={EMPTY_JOB_VALUES} categories={…} currency="USD"
 *     onSubmit={values => save.mutate(values)} pending={save.isPending}
 *     serverErrors={save.error instanceof ApiError ? save.error.fields : undefined} />
 */
const COUNTRY_OPTIONS = countryOptions();

export interface JobFormProps {
  initial: JobValues;
  categories: {id: number; name: string}[];
  /** The board's currency: salaries are entered in it, in whole units. */
  currency: string;
  /** Called with valid values only (every rule passed). */
  onSubmit: (values: JobValues) => void;
  pending?: boolean;
  /** A `422` answer's `fields`: shown on their fields. */
  serverErrors?: Record<string, string>;
  /** Every change (the wizard autosaves its draft from it). */
  onChange?: (values: JobValues) => void;
  submitLabel?: string;
  pendingLabel?: string;
  /** A secondary action left of submit (Cancel, Back); disabled while pending. */
  secondary?: ReactNode;
  /** A line above the buttons: a failure that is not about one field. */
  status?: ReactNode;
}

const APPLY_LABELS: Record<ApplyMethod, {title: string; description: string}> = {
  onsite: {title: 'On this site', description: 'Candidates apply here with a resume.'},
  url: {title: 'Your website', description: 'A link to your own application page.'},
  email: {title: 'By email', description: 'Candidates write to an address you choose.'},
};

export function JobForm({
  initial,
  categories,
  currency,
  onSubmit,
  pending,
  serverErrors,
  onChange,
  submitLabel = 'Save',
  pendingLabel = 'Saving…',
  secondary,
  status,
}: JobFormProps) {
  // Each field's rule asks the shared checker about the CURRENT values (cross-field rules too).
  const latest = useRef(initial);
  const ruleFor = (name: JobField): Rule[] => [() => checkJobValues(latest.current)[name] ?? null];
  const fields = Object.keys(initial) as JobField[];
  const form = useForm<JobValues>(initial, Object.fromEntries(fields.map(name => [name, ruleFor(name)])) as never);
  latest.current = form.values;

  useEffect(() => {
    if (serverErrors) form.setServerErrors(serverErrors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverErrors]);
  useEffect(() => {
    onChange?.(form.values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.values]);

  const v = form.values;
  const remote = v.workplaceType === 'remote';
  const textLength = markdownTextLength(v.descriptionMd);
  const categoryOptions = [{value: '', label: 'Choose a category'}, ...categories.map(c => ({value: String(c.id), label: c.name}))];

  return (
    <form className="form-stack" noValidate onSubmit={form.submit(values => onSubmit(values))}>
      <Field id="f-title" label="Job title" error={form.error('title')} hint="Like “Senior Backend Engineer”.">
        <input {...form.field('title')} maxLength={LIMITS.title + 20} autoComplete="off" placeholder="Senior Backend Engineer" />
      </Field>
      <div className="form-grid">
        <Field id="f-categoryId" label="Category" error={form.error('categoryId')}>
          <Select {...form.field('categoryId')} options={categoryOptions} />
        </Field>
        <Field id="f-employmentType" label="Employment type" error={form.error('employmentType')}>
          <Select {...form.field('employmentType')} options={EMPLOYMENT_TYPES.map(t => ({value: t, label: EMPLOYMENT_LABELS[t]}))} />
        </Field>
      </div>

      <RadioCards<WorkplaceType>
        legend="Workplace"
        name="workplaceType"
        columns={3}
        value={v.workplaceType as WorkplaceType}
        onChange={value => form.set('workplaceType', value)}
        options={WORKPLACE_TYPES.map(t => ({value: t, title: WORKPLACE_LABELS[t]}))}
      />
      {remote ? (
        <Field
          id="f-applicantCountries"
          label="Where candidates may live"
          optional
          error={form.error('applicantCountries')}
          hint="2-letter country codes separated by commas, like US, CA. Leave empty for anywhere.">
          <input {...form.field('applicantCountries')} autoComplete="off" placeholder="US, CA" />
        </Field>
      ) : (
        <div className="grid-3">
          <Field id="f-locationCity" label="City" optional error={form.error('locationCity')}>
            <input {...form.field('locationCity')} autoComplete="off" placeholder="Berlin" />
          </Field>
          <Field id="f-locationRegion" label="Region or state" optional error={form.error('locationRegion')}>
            <input {...form.field('locationRegion')} autoComplete="off" placeholder="Berlin" />
          </Field>
          <Field id="f-locationCountry" label="Country" error={form.error('locationCountry')} hint="Choose the country of the workplace.">
            <Select {...form.field('locationCountry')} options={[{value: '', label: 'Select a country'}, ...COUNTRY_OPTIONS]} />
          </Field>
        </div>
      )}

      <div className="grid-3">
        <Field id="f-salaryMin" label={`Salary from (${currency})`} optional error={form.error('salaryMin')}>
          <input {...form.field('salaryMin')} inputMode="numeric" autoComplete="off" placeholder="60000" />
        </Field>
        <Field id="f-salaryMax" label={`Salary to (${currency})`} optional error={form.error('salaryMax')}>
          <input {...form.field('salaryMax')} inputMode="numeric" autoComplete="off" placeholder="80000" />
        </Field>
        <Field id="f-salaryPeriod" label="Paid per" error={form.error('salaryPeriod')}>
          <Select {...form.field('salaryPeriod')} options={SALARY_PERIODS.map(p => ({value: p, label: SALARY_PERIOD_LABELS[p]}))} />
        </Field>
      </div>

      <Field
        id="f-descriptionMd"
        label="Description"
        error={form.error('descriptionMd')}
        hint={`${textLength} of at least ${LIMITS.descriptionMin} characters. Simple Markdown: a blank line starts a paragraph, “## ” a heading, “- ” a list item, **bold**, _italic_, [link](https://…).`}>
        <textarea {...form.field('descriptionMd')} rows={14} placeholder="What the role is, what the person will do, and what you are looking for." />
      </Field>

      <Field id="f-tags" label="Tags" optional error={form.error('tags')} hint={`Up to ${LIMITS.tags}, separated by commas, like react, typescript.`}>
        <input {...form.field('tags')} autoComplete="off" placeholder="react, typescript" />
      </Field>

      <RadioCards<ApplyMethod>
        legend="How people apply"
        name="applyMethod"
        columns={3}
        value={v.applyMethod as ApplyMethod}
        onChange={value => form.set('applyMethod', value)}
        options={APPLY_METHODS.map(m => ({value: m, ...APPLY_LABELS[m]}))}
      />
      {v.applyMethod !== 'onsite' && (
        <Field
          id="f-applyTarget"
          label={v.applyMethod === 'url' ? 'Application link' : 'Application email'}
          error={form.error('applyTarget')}
          hint={v.applyMethod === 'url' ? 'The full link, starting with https://' : 'Like jobs@example.com.'}>
          <input {...form.field('applyTarget')} type={v.applyMethod === 'email' ? 'email' : 'url'} autoComplete="off" placeholder={v.applyMethod === 'email' ? 'jobs@example.com' : 'https://example.com/careers/apply'} />
        </Field>
      )}

      {status}
      <div className="form-actions">
        {secondary}
        <Button type="submit" pending={pending} pendingLabel={pendingLabel}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
