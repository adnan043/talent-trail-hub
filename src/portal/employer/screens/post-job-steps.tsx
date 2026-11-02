import {useEffect} from 'react';

import {formatMoney} from '../../../lib/format';
import type {EmployerCompany, NewCompanyValues, TierOption} from '../../../lib/types-employer';
import {Button, Card, DefinitionList, Field, Notice, RadioCards, useForm} from '../../ui';
import {COMPANY_RULES} from '../draft';

/** Pieces of the post-a-job wizard (src/portal/employer/screens/post-job.tsx). */

export const tierPrice = (tier: TierOption, free: boolean) => (free || tier.priceCents === 0 ? 'Free' : formatMoney(tier.priceCents, tier.currency));

export const tierSummary = (tier: TierOption, free: boolean) =>
  `${tierPrice(tier, free)} · ${tier.durationDays} days live${tier.includesFeatured ? ' · Featured the whole time' : ''}`;

/** Step 2: the company. An employer who has one sees it; a first post creates it. */
export function CompanyStep({
  company,
  initial,
  serverErrors,
  onBack,
  onNext,
}: {
  company: EmployerCompany | null;
  initial: NewCompanyValues;
  serverErrors?: Record<string, string>;
  onBack: () => void;
  onNext: (values: NewCompanyValues) => void;
}) {
  const form = useForm<NewCompanyValues>(initial, COMPANY_RULES);
  useEffect(() => {
    // The server's field errors (a 422 on posting) land on their fields.
    if (serverErrors) form.setServerErrors(serverErrors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverErrors]);
  if (company) {
    return (
      <Card
        title="Your company"
        description="Your jobs show this company. Change its details in Company profile."
        footer={
          <div className="form-actions">
            <Button variant="secondary" onClick={onBack}>
              Back
            </Button>
            <Button onClick={() => onNext(initial)}>Continue</Button>
          </div>
        }>
        {company.isBlocked && <Notice tone="danger">This company cannot post jobs. Contact the board for help.</Notice>}
        <DefinitionList
          items={[
            {label: 'Name', value: company.name},
            {label: 'Website', value: company.website || '—'},
            {label: 'Location', value: company.location || '—'},
          ]}
        />
      </Card>
    );
  }
  return (
    <Card title="Your company" description="Tell candidates who is hiring. The name becomes your company's address on the board and cannot change later.">
      <form className="form-stack" noValidate onSubmit={form.submit(values => onNext(values))}>
        <Field id="f-companyName" label="Company name" error={form.error('companyName')}>
          <input {...form.field('companyName')} autoComplete="organization" placeholder="Acme Inc." />
        </Field>
        <div className="form-grid">
          <Field id="f-website" label="Website" optional error={form.error('website')} hint="The full link, starting with https://">
            <input {...form.field('website')} type="url" autoComplete="url" placeholder="https://example.com" />
          </Field>
          <Field id="f-location" label="Location" optional error={form.error('location')} hint="Like Berlin, Germany.">
            <input {...form.field('location')} autoComplete="off" placeholder="Berlin, Germany" />
          </Field>
        </div>
        <Field id="f-about" label="About the company" optional error={form.error('about')} hint="Up to 2,000 characters. The same simple Markdown as the description.">
          <textarea {...form.field('about')} rows={6} placeholder="What your company does and what it is like to work there." />
        </Field>
        <div className="form-actions">
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button type="submit">Continue</Button>
        </div>
      </form>
    </Card>
  );
}

/** Step 3: the listing tier (radio cards). Not shown when there is one tier or none. */
export function TierStep({
  tiers,
  free,
  value,
  error,
  onChange,
  onBack,
  onNext,
}: {
  tiers: TierOption[];
  free: boolean;
  value: number | null;
  error?: string;
  onChange: (id: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const picked = tiers.some(t => t.id === value);
  return (
    <Card
      title="Choose a listing"
      description={free ? 'Posting is free on this board right now.' : 'The price is charged once, when you post.'}
      footer={
        <div className="form-actions">
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onNext} disabled={!picked}>
            Continue
          </Button>
        </div>
      }>
      <RadioCards<string>
        legend="Listing"
        name="tier"
        columns={tiers.length >= 3 ? 3 : 2}
        value={value === null ? '' : String(value)}
        onChange={id => onChange(Number(id))}
        options={tiers.map(t => ({value: String(t.id), title: t.name, description: tierSummary(t, free)}))}
      />
      {error && <Notice tone="danger">{error}</Notice>}
    </Card>
  );
}

/** Several ways to pay: the buyer picks one (never chosen in code). */
export function GatewayChoice({
  gateways,
  value,
  onChange,
}: {
  gateways: {slug: string; name: string}[];
  value: string;
  onChange: (slug: string) => void;
}) {
  return (
    <RadioCards<string>
      legend="How do you want to pay?"
      name="gateway"
      columns={gateways.length >= 3 ? 3 : 2}
      value={value}
      onChange={onChange}
      options={gateways.map(g => ({value: g.slug, title: g.name}))}
    />
  );
}
