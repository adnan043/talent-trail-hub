import {useInfiniteQuery, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {useEffect, useState} from 'react';

import {JOB_STATUS_LABELS} from '../../../lib/board';
import type {EmployerJobDetail, EmployerJobRow, ListingAnswer} from '../../../lib/types-employer';
import {api, read} from '../../api';
import {Badge, Button, buttonClass, Card, type Column, DataTable, EmptyState, LoadMore, Menu, Modal, Notice, PageHeader, RadioCards, StatusBadge, useConfirm, useToast} from '../../ui';
import {STATUS_TONES} from '../status';
import {confirmCheckout, openListingCheckout} from '../checkout';
import {clearDraft, emptyDraft, loadDraft, saveDraft} from '../draft';
import {employerOptionsQuery, myJobsQuery} from '../queries';
import {GatewayChoice, tierSummary} from './post-job-steps';

/** `/dashboard/employer/jobs` (F15): the company's jobs with their numbers and actions. */
export function EmployerJobs() {
  const jobs = useInfiniteQuery(myJobsQuery);
  const rows = jobs.data?.pages.flatMap(page => page.items);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const search = useSearch({strict: false}) as {checkout?: string};
  const [busy, setBusy] = useState<number | null>(null);
  const [renewing, setRenewing] = useState<EmployerJobRow | null>(null);

  // Back from a payment: confirm it (this also records it, in the Preview too), then refresh.
  useEffect(() => {
    const id = search.checkout;
    if (!id || !/^pcs_[A-Za-z0-9]{8,64}$/.test(id)) return;
    void confirmCheckout(id).then(status => {
      if (status === 'paid') {
        // A posted job's draft is done with (a renewal leaves an unrelated draft alone).
        if (loadDraft().jobId !== null) clearDraft();
        toast.success('Payment received. Thank you!');
      }
      else if (status === 'open') toast.info('Your payment is still being confirmed. This list updates once it is.');
      else toast.danger('The payment did not go through. Nothing was charged.');
      void queryClient.invalidateQueries({queryKey: ['employer']});
      void navigate({to: '/employer/jobs', search: {}, replace: true});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.checkout]);

  const close = useMutation({
    mutationFn: (id: number) => read(api.employer.jobs[':id'].close.$post({param: {id: String(id)}})),
    onSuccess: () => {
      toast.success('Job closed.');
      void queryClient.invalidateQueries({queryKey: ['employer']});
    },
  });

  const duplicate = async (job: EmployerJobRow) => {
    // An unfinished post-a-job draft is only replaced when the employer says so.
    const unfinished = loadDraft();
    if (unfinished.job.title.trim() || unfinished.job.descriptionMd.trim()) {
      const ok = await confirm({
        title: 'Replace your unfinished draft?',
        body: `You have an unfinished job post (“${unfinished.job.title.trim() || 'Untitled'}”). Duplicating “${job.title}” replaces it.`,
        confirmLabel: 'Replace draft',
        tone: 'primary',
      });
      if (!ok) return;
    }
    setBusy(job.id);
    try {
      const {job: detail} = await read<{job: EmployerJobDetail}>(api.employer.jobs[':id'].$get({param: {id: String(job.id)}}));
      saveDraft({...emptyDraft(), job: {...detail.values}, tierId: detail.tierId});
      void navigate({to: '/post-a-job', search: {step: 1}});
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(null);
    }
  };


  const columns: Column<EmployerJobRow>[] = [
    {
      key: 'title',
      header: 'Job',
      cell: j => (
        <>
          <span className="cell-title">{j.title}</span>
          {j.rejectionReason && <span className="cell-sub">Not approved: {j.rejectionReason}</span>}
        </>
      ),
    },
    {key: 'status', header: 'Status', width: 'shrink', cell: j => <StatusBadge tone={STATUS_TONES[j.status]}>{JOB_STATUS_LABELS[j.status]}</StatusBadge>},
    {key: 'days', header: 'Days left', width: 'shrink', align: 'end', cell: j => (j.daysLeft === null ? '—' : j.daysLeft)},
    {key: 'views', header: 'Views', width: 'shrink', align: 'end', hideOnMobile: true, cell: j => j.views},
    {key: 'clicks', header: 'Apply clicks', width: 'shrink', align: 'end', hideOnMobile: true, cell: j => j.applyClicks},
    {
      key: 'applicants',
      header: 'Applicants',
      width: 'shrink',
      align: 'end',
      cell: j => (
        <Link to="/employer/jobs/$id/applicants" params={{id: String(j.id)}} className="cell-title">
          {j.applicants}
        </Link>
      ),
    },
    {key: 'featured', header: 'Featured', width: 'shrink', hideOnMobile: true, cell: j => (j.featured ? <Badge tone="brand">Featured</Badge> : '—')},
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: j => (
        <Menu
          label={`Actions for ${j.title}`}
          disabled={busy !== null}
          items={[
            ...(j.actions.edit ? [{label: 'Edit', icon: 'pencil' as const, onSelect: () => void navigate({to: '/employer/jobs/$id/edit', params: {id: String(j.id)}})}] : []),
            {label: 'Applicants', icon: 'users' as const, onSelect: () => void navigate({to: '/employer/jobs/$id/applicants', params: {id: String(j.id)}})},
            ...(j.status === 'published' ? [{label: 'View on the board', icon: 'globe' as const, onSelect: () => window.open(`/jobs/${j.slug}/`, '_blank', 'noopener,noreferrer')}] : []),
            ...(j.actions.renew ? [{label: 'Renew', icon: 'refresh' as const, onSelect: () => setRenewing(j)}] : []),
            {label: 'Duplicate', icon: 'copy' as const, onSelect: () => void duplicate(j)},
            ...(j.actions.close
              ? [
                  'separator' as const,
                  {
                    label: 'Close as filled',
                    icon: 'x' as const,
                    danger: true,
                    onSelect: () =>
                      void confirm({
                        title: `Close “${j.title}”?`,
                        body: 'It leaves the board at once and takes no more applications. Its applicants stay here.',
                        confirmLabel: 'Close job',
                        pendingLabel: 'Closing…',
                        action: () => close.mutateAsync(j.id),
                      }),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];

  return (
    <div className="app-page screen-employer-jobs">
      <PageHeader
        title="My jobs"
        description="Every job your company posted, newest first."
        actions={
          <Link className={buttonClass()} to="/post-a-job">
            Post a job
          </Link>
        }
      />
      <Card flush>
        <DataTable
          caption="My jobs"
          columns={columns}
          rows={rows}
          rowKey={j => j.id}
          loading={jobs.isPending}
          error={jobs.error}
          busyKey={busy ?? (close.isPending ? close.variables : null)}
          empty={
            <EmptyState
              icon="briefcase"
              title="No jobs yet"
              action={
                <Link className={buttonClass()} to="/post-a-job">
                  Post your first job
                </Link>
              }>
              Your jobs show here once you post them.
            </EmptyState>
          }
        />
      </Card>
      <LoadMore query={jobs} />
      {renewing && <RenewDialog job={renewing} onClose={() => setRenewing(null)} />}
    </div>
  );
}

/** Renew (F15): pick a tier (default: the one the job was posted with), then pay or renew free. */
function RenewDialog({job, onClose}: {job: EmployerJobRow; onClose: () => void}) {
  const options = useQuery(employerOptionsQuery);
  const queryClient = useQueryClient();
  const toast = useToast();
  const tiers = options.data?.tiers ?? [];
  const [tierId, setTierId] = useState<number | null>(job.tierId);
  const [gateways, setGateways] = useState<{slug: string; name: string}[] | null>(null);
  const [gateway, setGateway] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const chosen = tiers.length === 1 ? tiers[0]!.id : tiers.some(t => t.id === tierId) ? tierId : null;
  const renew = useMutation({
    mutationFn: () =>
      read<ListingAnswer>(api.employer.jobs[':id'].renew.$post({param: {id: String(job.id)}, json: {tierId: chosen, gateway: gateway || undefined}})),
    onSuccess: async answer => {
      if (answer.status === 'choose') return setGateways(answer.gateways);
      if (answer.status === 'done') {
        toast.success('Job renewed.');
        void queryClient.invalidateQueries({queryKey: ['employer']});
        return onClose();
      }
      try {
        await openListingCheckout(answer.checkout, () => setNotice('The payment was closed. Nothing was charged.'));
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'The payment window could not be opened. Try again.');
      }
    },
  });
  const free = options.data?.freePosting || (tiers.find(t => t.id === chosen)?.priceCents ?? 0) === 0;
  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!renew.isPending}
      title={`Renew “${job.title}”`}
      description="One more listing period, starting today."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={renew.isPending}>
            Cancel
          </Button>
          <Button pending={renew.isPending} pendingLabel={free ? 'Renewing…' : 'Opening checkout…'} disabled={chosen === null || (gateways !== null && !gateway)} onClick={() => renew.mutate()}>
            {free ? 'Renew' : 'Pay and renew'}
          </Button>
        </>
      }>
      {tiers.length > 1 && (
        <RadioCards<string>
          legend="Listing"
          name="renew-tier"
          columns={1}
          value={chosen === null ? '' : String(chosen)}
          onChange={id => setTierId(Number(id))}
          options={tiers.map(t => ({value: String(t.id), title: t.name, description: tierSummary(t, Boolean(options.data?.freePosting))}))}
        />
      )}
      {gateways && <GatewayChoice gateways={gateways} value={gateway} onChange={setGateway} />}
      {notice && <Notice tone="info">{notice}</Notice>}
      {renew.error && <Notice tone="danger">{renew.error.message}</Notice>}
    </Modal>
  );
}
