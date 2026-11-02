import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useSearch} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';

import {JOB_FIELDS} from '../../../lib/job-input';
import type {ListingAnswer, NewCompanyValues} from '../../../lib/types-employer';
import {api, ApiError, read} from '../../api';
import {JobForm} from '../../board/JobForm';
import {useMe} from '../../shared';
import {Button, Card, EmptyState, ErrorNote, LoadingBlock, Notice, PageHeader, useToast} from '../../ui';
import {openListingCheckout} from '../checkout';
import {clearDraft, loadDraft, type PostDraft, saveDraft} from '../draft';
import {JobPreview} from '../JobPreview';
import {employerOptionsQuery} from '../queries';
import {CompanyStep, GatewayChoice, TierStep, tierSummary} from './post-job-steps';

const STEPS = ['The job', 'Company', 'Listing', 'Preview'] as const;
const COMPANY_FIELDS = ['companyName', 'website', 'location', 'about'];

/**
 * `/dashboard/post-a-job` (F10 → F12): job fields → company → listing tier → preview, then post.
 * The draft is kept in this browser (saved every 5 s). The server prices the tier; a paid tier
 * opens the platform's checkout over the dashboard, and the payment hook puts the job live or
 * into review. A closed checkout keeps the draft (and the unpaid job, reused on the next try).
 */
export function PostJob() {
  const me = useMe();
  const options = useQuery(employerOptionsQuery);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const search = useSearch({strict: false}) as {step?: PostDraft['step']};
  const [draft, setDraft] = useState<PostDraft>(() => {
    const saved = loadDraft();
    return search.step ? {...saved, step: search.step} : saved;
  });
  const stepBox = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);
  // The step lives in the URL too (Back / Forward move between steps)…
  useEffect(() => {
    if (search.step && search.step !== draft.step) setDraft(current => ({...current, step: search.step!}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.step]);
  // …and every step change is written there, with focus moved to the new step.
  useEffect(() => {
    if (search.step !== draft.step) void navigate({to: '/post-a-job', search: {step: draft.step}, replace: firstStep.current});
    if (!firstStep.current) stepBox.current?.focus();
    firstStep.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.step]);
  const [serverErrors, setServerErrors] = useState<Record<string, string> | undefined>();
  const [gateways, setGateways] = useState<{slug: string; name: string}[] | null>(null);
  const [gateway, setGateway] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  // Autosave every 5 s (only when something changed).
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    let saved = '';
    const timer = window.setInterval(() => {
      const text = JSON.stringify(latest.current);
      if (text !== saved) {
        saveDraft(latest.current);
        saved = text;
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const post = useMutation({
    mutationFn: (input: {gateway?: string}) =>
      read<ListingAnswer>(
        api.employer.post.$post({
          json: {job: draft.job, company: draft.company, tierId: draft.tierId, jobId: draft.jobId, gateway: input.gateway || undefined},
        })
      ),
    onSuccess: async answer => {
      const next = {...draft, jobId: answer.jobId};
      setDraft(next);
      saveDraft(next);
      void queryClient.invalidateQueries({queryKey: ['employer']});
      if (answer.status === 'choose') {
        setGateways(answer.gateways);
        return;
      }
      if (answer.status === 'done') {
        clearDraft();
        toast.success(answer.jobStatus === 'published' ? 'Your job is live.' : 'Your job was sent for review.');
        void navigate({to: '/employer/jobs'});
        return;
      }
      setNotice(null);
      try {
        await openListingCheckout(answer.checkout, () => setNotice('The payment was closed. Nothing was charged; your job is saved. Post it again when you are ready.'));
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'The payment window could not be opened. Try again.');
      }
    },
    onError: err => {
      if (!(err instanceof ApiError) || !Object.keys(err.fields).length) return;
      setServerErrors(err.fields);
      const keys = Object.keys(err.fields);
      const step = keys.some(k => (JOB_FIELDS as string[]).includes(k)) ? 1 : keys.some(k => COMPANY_FIELDS.includes(k)) ? 2 : 3;
      setDraft(current => ({...current, step}));
    },
  });

  if (me.data?.board.singleCompany) {
    return (
      <div className="app-page">
        <EmptyState icon="briefcase" title="Posting is not open on this board">This board lists one company's jobs only.</EmptyState>
      </div>
    );
  }
  if (options.isPending) return <div className="app-page"><LoadingBlock rows={6} /></div>;
  if (options.error) return <div className="app-page"><ErrorNote error={options.error} /></div>;

  const {categories, tiers, freePosting, currency, company} = options.data;
  const singleTier = tiers.length <= 1;
  const tierId = singleTier ? (tiers[0]?.id ?? null) : draft.tierId;
  const tier = tiers.find(t => t.id === tierId) ?? null;
  const go = (step: PostDraft['step']) => {
    setDraft(current => ({...current, step, tierId}));
  };
  const free = freePosting || (tier?.priceCents ?? 0) === 0;
  const companyPreview = company
    ? {name: company.name, logoUrl: company.logoUrl, location: company.location || null}
    : {name: draft.company.companyName || 'Your company', logoUrl: null, location: draft.company.location || null};
  const categoryName = categories.find(c => String(c.id) === draft.job.categoryId)?.name ?? '';
  const failed = post.error && !(post.error instanceof ApiError && Object.keys(post.error.fields).length) ? post.error : null;

  return (
    <div className="app-page screen-post-job">
      <PageHeader
        title="Post a job"
        description={`Step ${draft.step} of ${STEPS.length}: ${STEPS[draft.step - 1]}. Your draft is saved in this browser.`}
      />
      <div ref={stepBox} tabIndex={-1} aria-label={`Step ${draft.step}: ${STEPS[draft.step - 1]}`} className="form-stack">
      {draft.step === 1 && (
        <Card title="The job" description="What the role is, where, and how people apply.">
          <JobForm
            initial={draft.job}
            categories={categories}
            currency={currency}
            serverErrors={serverErrors}
            onChange={job => setDraft(current => ({...current, job}))}
            onSubmit={job => {
              setDraft(current => ({...current, job}));
              go(2);
            }}
            submitLabel="Continue"
          />
        </Card>
      )}
      {draft.step === 2 && (
        <CompanyStep
          company={company}
          initial={draft.company}
          serverErrors={serverErrors}
          onBack={() => go(1)}
          onNext={(values: NewCompanyValues) => {
            setDraft(current => ({...current, company: values}));
            go(singleTier ? 4 : 3);
          }}
        />
      )}
      {draft.step === 3 && !singleTier && (
        <TierStep
          tiers={tiers}
          free={freePosting}
          value={draft.tierId}
          error={serverErrors?.tierId}
          onChange={id => setDraft(current => ({...current, tierId: id}))}
          onBack={() => go(2)}
          onNext={() => go(4)}
        />
      )}
      {(draft.step === 4 || (draft.step === 3 && singleTier)) && (
        <>
          <JobPreview values={draft.job} company={companyPreview} categoryName={categoryName} currency={currency} />
          <Card
            title="Post it"
            description={tier ? `${tier.name}: ${tierSummary(tier, freePosting)}` : 'A free listing.'}
            footer={
              <div className="form-actions">
                <Button variant="secondary" onClick={() => go(singleTier ? 2 : 3)} disabled={post.isPending}>
                  Back
                </Button>
                <Button
                  pending={post.isPending}
                  pendingLabel={free ? 'Posting…' : 'Opening checkout…'}
                  disabled={Boolean(gateways && !gateway) || company?.isBlocked}
                  onClick={() => post.mutate({gateway: gateways ? gateway : undefined})}>
                  {free ? 'Post job' : 'Pay and post'}
                </Button>
              </div>
            }>
            {gateways && <GatewayChoice gateways={gateways} value={gateway} onChange={setGateway} />}
            {notice && <Notice tone="info">{notice}</Notice>}
            {failed && <Notice tone="danger">{failed.message}</Notice>}
            {!free && !gateways && <p className="muted">The payment opens over this page. You will not leave the site.</p>}
          </Card>
        </>
      )}
      </div>
    </div>
  );
}
