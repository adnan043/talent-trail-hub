import {useMutation} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';

import {RESUME_RETENTION_DAYS} from '../../../lib/board';
import {AUTH_RULES} from '../../../lib/rules';
import type {PrivacyDeleted, PrivacyLookup, TaskRun} from '../../../lib/types-manage';
import {api, ApiError, read} from '../../api';
import {
  Badge,
  Button,
  buttonClass,
  Card,
  type Column,
  DataTable,
  DefinitionList,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  useConfirm,
  useForm,
  useToast,
} from '../../ui';
import {day} from '../format';

type Item = PrivacyLookup['items'][number];

/**
 * `/manage/privacy` (site:privacy:manage): a candidate asks what the board keeps about them, or
 * to delete it (F36). Look up the exact email, then delete everything or one application. The
 * audit log records a salted hash of the address, never the address.
 */
export function Privacy() {
  const confirm = useConfirm();
  const toast = useToast();
  const [result, setResult] = useState<{email: string; data: PrivacyLookup} | null>(null);
  const form = useForm({email: ''}, {email: AUTH_RULES.email});

  const lookup = useMutation({
    mutationFn: (email: string) => read<PrivacyLookup>(api.manage.privacy.lookup.$post({json: {email, applicationId: null}})),
    onSuccess: (data, email) => setResult({email, data}),
    onError: err => err instanceof ApiError && form.setServerErrors(err.fields),
  });
  const removeAll = useMutation({
    mutationFn: (email: string) => read<{deleted: PrivacyDeleted; filesLeft: number}>(api.manage.privacy.delete.$post({json: {email, applicationId: null}})),
  });
  const removeOne = useMutation({
    mutationFn: ({email, applicationId}: {email: string; applicationId: number}) =>
      read<{ok: true; filesLeft: number}>(api.manage.privacy['delete-application'].$post({json: {email, applicationId}})),
  });
  const purge = useMutation({
    mutationFn: () => read<TaskRun>(api.manage.privacy['run-purge'].$post()),
    onSuccess: r => toast.success(r.message),
    onError: err => toast.danger(err.message),
  });

  const again = (email: string) => lookup.mutate(email);

  const askAll = async () => {
    if (!result) return;
    const {email, data} = result;
    let filesLeft = 0;
    const ok = await confirm({
      title: `Delete everything for ${email}?`,
      body: `${data.applications}${data.more ? '+' : ''} applications, ${data.resumeFiles} resumes and ${data.emailLogs} email log rows are deleted for good.`,
      confirmLabel: 'Delete everything',
      pendingLabel: 'Deleting…',
      action: async () => {
        filesLeft = (await removeAll.mutateAsync(email)).filesLeft;
      },
    });
    if (ok) {
      toast.success(filesLeft ? 'Deleted. Some resume files could not be removed yet: try again later.' : 'Everything for this email is deleted.');
      again(email);
    }
  };
  const askOne = async (item: Item) => {
    if (!result) return;
    const ok = await confirm({
      title: `Delete the application for “${item.jobTitle}”?`,
      body: item.hasResume ? 'The application and its resume are deleted for good.' : 'The application is deleted for good.',
      confirmLabel: 'Delete application',
      pendingLabel: 'Deleting…',
      action: () => removeOne.mutateAsync({email: result.email, applicationId: item.id}),
    });
    if (ok) {
      toast.success('Application deleted.');
      again(result.email);
    }
  };

  const columns: Column<Item>[] = [
    {key: 'job', header: 'Job', cell: i => <span><span className="cell-title">{i.jobTitle}</span><span className="cell-sub">{i.companyName}</span></span>},
    {key: 'when', header: 'Applied', width: 'shrink', cell: i => day(i.createdAt)},
    {key: 'resume', header: 'Resume', width: 'shrink', cell: i => (i.hasResume ? <Badge>Kept</Badge> : <span className="muted">None</span>)},
    {key: 'actions', header: 'Actions', actions: true, cell: i => <Button size="sm" variant="danger" onClick={() => void askOne(i)}>Delete</Button>},
  ];

  return (
    <div className="app-page screen-privacy">
      <PageHeader
        title="Candidate data"
        description={`Find and delete what the board keeps for an email: applications, resumes and the email log. Payment records (orders) keep their email: they are money records. Resumes are deleted ${RESUME_RETENTION_DAYS} days after applying in any case.`}
        actions={
          <Button variant="secondary" icon="refresh" pending={purge.isPending} pendingLabel="Running…" onClick={() => purge.mutate()}>
            Run purge now
          </Button>
        }
      />
      <Card title="Look up an email">
        <form className="form-stack" noValidate onSubmit={form.submit(v => lookup.mutate(v.email.trim().toLowerCase()))}>
          <Field label="Email address" id="f-email" error={form.error('email')} hint="The exact address the candidate applied with.">
            <input {...form.field('email')} type="email" autoComplete="off" placeholder="name@example.com" />
          </Field>
          <div className="form-actions">
            <Button type="submit" icon="search" pending={lookup.isPending} pendingLabel="Looking up…">Look up</Button>
          </div>
          {lookup.error && !(lookup.error instanceof ApiError && Object.keys(lookup.error.fields).length) && <ErrorNote error={lookup.error} />}
        </form>
      </Card>
      {result && (
        <Card
          title={result.email}
          description="What the board keeps for this address."
          actions={<Button variant="danger" icon="trash" onClick={() => void askAll()} disabled={!result.data.applications && !result.data.emailLogs}>Delete everything</Button>}
          footer={<Link className={buttonClass({variant: 'link'})} to="/activity">See the audit log</Link>}>
          <div className="form-stack">
            <DefinitionList
              items={[
                {label: 'Applications', value: `${result.data.applications}${result.data.more ? '+' : ''}`},
                {label: 'Resume files', value: result.data.resumeFiles},
                {label: 'Email log rows', value: result.data.emailLogs},
              ]}
            />
            <DataTable
              caption="Applications"
              columns={columns}
              rows={result.data.items}
              rowKey={i => i.id}
              busyKey={removeOne.isPending ? (removeOne.variables?.applicationId ?? null) : null}
              empty={<EmptyState icon="inbox" title="No applications">Nothing on the board was sent from this address.</EmptyState>}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
