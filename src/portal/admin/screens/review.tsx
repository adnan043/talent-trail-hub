import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate, useParams} from '@tanstack/react-router';
import {useState} from 'react';

import {EMPLOYMENT_LABELS, type EmploymentType, LIMITS, SALARY_PERIOD_LABELS, type SalaryPeriod, WORKPLACE_LABELS, type WorkplaceType} from '../../../lib/board';
import {sanitizeRichText} from '../../../lib/rich-text';
import type {ModerationResult} from '../../../lib/types-manage';
import {api, ApiError, read} from '../../api';
import {when} from '../../shared';
import {
  Badge,
  Button,
  buttonClass,
  Card,
  DefinitionList,
  EmptyState,
  ErrorNote,
  Field,
  LoadingBlock,
  Modal,
  Notice,
  PageHeader,
  rules,
  StatusBadge,
  useForm,
  useToast,
} from '../../ui';
import {day, JOB_STATUS_TONES, jobStatusLabel, money} from '../format';
import {reviewQuery} from '../queries';

/**
 * `/manage/moderation/$id` (site:job:moderate): the job as it will appear, the employer's
 * history, approve or reject with a reason. No editing: the
 * admin reviews employer content as it is.
 */
export function Review() {
  const {id} = useParams({from: '/manage/moderation/$id'});
  const review = useQuery(reviewQuery(id));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);

  const done = (result: ModerationResult) => {
    void queryClient.invalidateQueries({queryKey: ['manage']});
    toast.success(result.message);
    if (result.refundNote) toast.info(result.refundNote);
    void navigate({to: '/manage/moderation'});
  };
  const approve = useMutation({
    // `seen`: what this page showed; an employer edit since then answers 409 and the page reloads it.
    mutationFn: (seen: string) => read<ModerationResult>(api.manage.moderation[':id'].approve.$post({param: {id}, json: {trust: false, seen}})),
    onSuccess: done,
    onError: err => {
      if (err instanceof ApiError && err.status === 409) void review.refetch();
    },
  });

  if (review.isPending) return <div className="app-page"><LoadingBlock rows={6} /></div>;
  if (review.error) {
    const gone = review.error instanceof ApiError && review.error.status === 404;
    return (
      <div className="app-page">
        <EmptyState
          icon={gone ? 'check-circle' : 'alert'}
          title={gone ? 'This job is not waiting for review' : 'This job could not load'}
          action={
            <Link className={buttonClass({variant: 'secondary'})} to="/manage/moderation">
              Back to the queue
            </Link>
          }>
          {gone ? 'Someone may have reviewed it already.' : review.error.message}
        </EmptyState>
      </div>
    );
  }
  const {item, job, history} = review.data;
  const salary = job.salary;
  const busy = approve.isPending;

  return (
    <div className="app-page screen-review">
      <PageHeader
        title={item.title}
        description={`${item.company.name} · submitted ${when(item.submittedAt)}`}
        actions={
          <>
            <Button variant="danger" onClick={() => setRejecting(true)} disabled={busy}>
              Reject
            </Button>
            <Button icon="check" pending={busy} pendingLabel="Approving…" onClick={() => approve.mutate(item.submittedAt)}>
              Approve
            </Button>
          </>
        }
      />
      {approve.error && <ErrorNote error={approve.error} />}
      {item.flagged && (
        <Notice tone="danger" title="Flagged">
          This job was flagged. Read it closely before approving.
        </Notice>
      )}
      {review.data.employer && !review.data.employer.verified && (
        <Notice tone="warning" title="Unconfirmed employer">
          The employer has not confirmed their email address yet.
        </Notice>
      )}
      {item.liveUntil && (
        <Notice tone="info" title="An edit of a live job">
          The job stays live while you decide. Approving keeps its end date ({day(item.liveUntil)}).
        </Notice>
      )}
      <div className="grid-main-side">
        <Card title="The job as it will appear">
          <div className="form-stack">
            <span className="badges">
              <Badge>{job.category}</Badge>
              <Badge>{EMPLOYMENT_LABELS[job.employmentType as EmploymentType] ?? job.employmentType}</Badge>
              <Badge>{WORKPLACE_LABELS[job.workplaceType as WorkplaceType] ?? job.workplaceType}</Badge>
              {job.tags.map(tag => (
                <Badge key={tag} tone="brand">
                  {tag}
                </Badge>
              ))}
            </span>
            {/* Sanitized when saved and again here, with the board's strict allow-list. */}
            <div className="job-description" dangerouslySetInnerHTML={{__html: sanitizeRichText(job.descriptionHtml)}} />
          </div>
        </Card>
        <div className="form-stack">
          <Card title="Listing">
            <DefinitionList
              items={[
                {label: 'Location', value: job.location ?? (job.workplaceType === 'remote' ? 'Remote' : '—')},
                {
                  label: 'Salary',
                  value: salary
                    ? `${[salary.minCents, salary.maxCents].filter((v): v is number => v !== null).map(v => money(v, salary.currency ?? 'USD')).join(' – ')} per ${SALARY_PERIOD_LABELS[(salary.period ?? 'YEAR') as SalaryPeriod]}`
                    : 'Not shown',
                },
                {label: 'Apply', value: job.applyMethod === 'onsite' ? 'On this board' : (job.applyTarget ?? '—')},
                {label: 'Listing', value: `${job.durationDays} days${job.listingFeatured ? ', featured' : ''}`},
                {label: 'Payment', value: item.payment ? money(item.payment.amountCents, item.payment.currency) : 'None'},
              ]}
            />
          </Card>
          <Card title="Employer history" description={`On the board since ${day(history.companySince)}.`}>
            <DefinitionList
              items={[
                {label: 'Jobs', value: `${history.jobs}${history.more ? '+' : ''}`},
                {label: 'Live', value: history.live},
                {label: 'Rejected', value: history.rejected},
                {label: 'Paid orders', value: history.paidOrders},
                {label: 'Spent', value: money(history.spentCents, item.payment?.currency ?? 'USD')},
              ]}
            />
            {history.recent.length > 0 && (
              <ul className="list">
                {history.recent.map(r => (
                  <li key={r.id} className="list-row">
                    <div className="list-row-text">
                      <p className="list-row-title">{r.title}</p>
                      <p className="list-row-sub">{day(r.createdAt)}</p>
                    </div>
                    <span className="list-row-end">
                      <StatusBadge tone={JOB_STATUS_TONES[r.status]}>{jobStatusLabel(r.status)}</StatusBadge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      {rejecting && <RejectDialog id={id} title={item.title} paid={item.payment !== null} onClose={() => setRejecting(false)} onDone={done} />}
    </div>
  );
}

function RejectDialog({id, title, paid, onClose, onDone}: {id: string; title: string; paid: boolean; onClose: () => void; onDone: (r: ModerationResult) => void}) {
  const form = useForm({reason: ''}, {reason: [rules.required('Say why, in a sentence the employer will read.'), rules.minLength(3, 'Use at least 3 characters.'), rules.maxLength(LIMITS.rejectionReason)]});
  const reject = useMutation({
    mutationFn: (reason: string) => read<ModerationResult>(api.manage.moderation[':id'].reject.$post({param: {id}, json: {reason}})),
    onSuccess: onDone,
    onError: err => err instanceof ApiError && form.setServerErrors(err.fields),
  });
  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!reject.isPending}
      title={`Reject “${title}”?`}
      description="The employer gets an email with your reason."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={reject.isPending}>
            Cancel
          </Button>
          <Button variant="danger" pending={reject.isPending} pendingLabel="Rejecting…" onClick={form.submit(v => reject.mutate(v.reason))}>
            Reject job
          </Button>
        </>
      }>
      <form className="form-stack" noValidate onSubmit={form.submit(v => reject.mutate(v.reason))}>
        <Field label="Reason" id="f-reason" error={form.error('reason')} hint={`3 to ${LIMITS.rejectionReason} characters.`}>
          <textarea {...form.field('reason')} rows={4} maxLength={LIMITS.rejectionReason + 50} placeholder="Tell the employer what to fix before it can go live." />
        </Field>
        {paid && <Notice tone="warning">This job was paid for. There is no refund from here: refund the order in the platform dashboard if one is due.</Notice>}
        {reject.error && !(reject.error instanceof ApiError && Object.keys(reject.error.fields).length) && <ErrorNote error={reject.error} />}
      </form>
    </Modal>
  );
}
