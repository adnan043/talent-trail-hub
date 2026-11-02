import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';

import {type BoardMode, LIMITS, type ModerationMode} from '../../../lib/board';
import type {AdminBoardMode, AdminModerationMode} from '../../../lib/types-manage';
import {api, ApiError, read} from '../../api';
import {Button, buttonClass, Card, ErrorNote, Field, LoadingBlock, Notice, PageHeader, RadioCards, rules, Select, useConfirm, useForm, useToast} from '../../ui';
import {boardModeQuery, moderationModeQuery} from '../queries';

/** `/manage/settings/board` (site:board:settings): marketplace or one company's careers board (F39). */
export function BoardMode() {
  const board = useQuery(boardModeQuery);
  return (
    <div className="app-page screen-board-mode">
      <PageHeader title="Board mode" description="A marketplace for many employers, or the careers board of one company." />
      {board.isPending ? <LoadingBlock rows={4} /> : board.error ? <ErrorNote error={board.error} /> : <BoardModeForm data={board.data} />}
    </div>
  );
}

const NEW = 'new';

function BoardModeForm({data}: {data: AdminBoardMode}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<BoardMode>(data.mode);
  const [owner, setOwner] = useState(data.ownerCompany ? String(data.ownerCompany.id) : '');
  const [newName, setNewName] = useState('');
  const [errors, setErrors] = useState<{owner?: string; name?: string}>({});
  const save = useMutation({
    mutationFn: () =>
      read<AdminBoardMode>(
        api.manage.settings.board.$put({json: {mode, ownerCompanyId: owner && owner !== NEW ? Number(owner) : null, newCompanyName: owner === NEW ? newName.trim() : ''}})
      ),
    onSuccess: () => {
      toast.success(mode === 'single_company' ? 'The board now lists one company.' : 'The board is a marketplace again.');
      setNewName('');
      void queryClient.invalidateQueries({queryKey: ['manage']});
      void queryClient.invalidateQueries({queryKey: ['me']});
    },
    onError: err => err instanceof ApiError && setErrors({owner: err.fields.ownerCompanyId, name: err.fields.newCompanyName}),
  });
  const submit = async () => {
    const next: typeof errors = {};
    if (mode === 'single_company' && !owner) next.owner = 'Choose the company this board belongs to.';
    if (owner === NEW && mode === 'single_company' && !newName.trim()) next.name = 'Name the new company.';
    if (newName.trim().length > LIMITS.companyName) next.name = `Use at most ${LIMITS.companyName} characters.`;
    setErrors(next);
    if (next.owner) return document.getElementById('f-owner')?.focus();
    if (next.name) return document.getElementById('f-newName')?.focus();
    const single = mode === 'single_company';
    await confirm({
      title: single ? 'Make this a one-company board?' : 'Make this a marketplace again?',
      body: single
        ? 'Only that company’s jobs show on the public board; other companies’ jobs, the company directory and the employer area are hidden, and employers cannot post. Nothing is deleted.'
        : 'Every company’s live jobs show again and employers can sign up and post. Nothing was deleted while the board listed one company.',
      confirmLabel: single ? 'Switch to one company' : 'Switch to marketplace',
      pendingLabel: 'Saving…',
      tone: 'primary',
      action: () => save.mutateAsync(),
    });
  };
  const options = [{value: '', label: 'Choose a company'}, ...data.companies.map(c => ({value: String(c.id), label: c.name})), {value: NEW, label: 'A new company…'}];
  if (data.ownerCompany && !data.companies.some(c => c.id === data.ownerCompany!.id)) options.splice(1, 0, {value: String(data.ownerCompany.id), label: data.ownerCompany.name});
  const changed = mode !== data.mode || owner !== (data.ownerCompany ? String(data.ownerCompany.id) : '');

  return (
    <>
      <Card footer={<Button pending={save.isPending} pendingLabel="Saving…" disabled={!changed} onClick={() => void submit()}>Save board mode</Button>}>
        <form className="form-stack" noValidate onSubmit={e => { e.preventDefault(); void submit(); }}>
          <RadioCards<BoardMode>
            legend="Mode"
            name="mode"
            value={mode}
            onChange={setMode}
            options={[
              {value: 'marketplace', title: 'Marketplace', description: 'Employers sign up, pay and post their own jobs.'},
              {value: 'single_company', title: 'One company', description: 'Only one company’s jobs show; the employer area is hidden.'},
            ]}
          />
          {mode === 'single_company' && (
            <Field label="Company" id="f-owner" error={errors.owner} hint="Its jobs are the only ones listed. Post them from All jobs.">
              <Select id="f-owner" value={owner} onChange={e => setOwner(e.target.value)} options={options} aria-invalid={errors.owner ? true : undefined} aria-describedby={errors.owner ? 'f-owner-error' : 'f-owner-hint'} />
            </Field>
          )}
          {mode === 'single_company' && owner === NEW && (
            <Field label="New company name" id="f-newName" error={errors.name}>
              <input id="f-newName" value={newName} placeholder="Acme Inc." onChange={e => setNewName(e.target.value)} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? 'f-newName-error' : undefined} />
            </Field>
          )}
          <Notice tone="info">Switching never deletes anything: other companies’ jobs come back when you switch back.</Notice>
        </form>
      </Card>
      <CurrencyCard currency={data.currency} />
    </>
  );
}

/** The board's currency: new salaries are entered in it. Tier prices keep their catalogue currency. */
function CurrencyCard({currency}: {currency: string}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const form = useForm({currency}, {currency: [rules.required('Enter a currency code.'), rules.pattern(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code, like USD or EUR.')]});
  const save = useMutation({
    mutationFn: (code: string) => read<{currency: string}>(api.manage.settings.currency.$put({json: {currency: code}})),
    onSuccess: r => {
      toast.success(`The board's currency is ${r.currency}.`);
      form.reset({currency: r.currency});
      void queryClient.invalidateQueries({queryKey: ['manage']});
    },
    onError: err => err instanceof ApiError && form.setServerErrors(err.fields),
  });
  const submit = form.submit(v => save.mutate(v.currency.trim().toUpperCase()));
  return (
    <form noValidate onSubmit={submit}>
      <Card title="Currency" description="Salaries on new and edited jobs are entered in it. Existing jobs keep theirs; listing prices come from the price catalogue." footer={<Button type="submit" pending={save.isPending} pendingLabel="Saving…">Save currency</Button>}>
        <Field label="Currency code" id="f-currency" error={form.error('currency')} hint="ISO 4217, like USD, EUR or GBP.">
          <input {...form.field('currency')} maxLength={3} autoComplete="off" placeholder="USD" />
        </Field>
        {save.error && !(save.error instanceof ApiError && Object.keys(save.error.fields).length) && <ErrorNote error={save.error} />}
      </Card>
    </form>
  );
}

/** `/manage/settings/moderation` (site:board:settings): review every job, or publish at once (F31). */
export function ModerationMode() {
  const current = useQuery(moderationModeQuery);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<ModerationMode | null>(null);
  const value = mode ?? current.data?.mode ?? 'all';
  const save = useMutation({
    mutationFn: () => read<AdminModerationMode>(api.manage.settings.moderation.$put({json: {mode: value}})),
    onSuccess: r => {
      toast.success(r.mode === 'all' ? 'Every new job is reviewed first.' : 'New jobs go live at once.');
      setMode(null);
      void queryClient.invalidateQueries({queryKey: ['manage', 'settings', 'moderation']});
    },
  });
  return (
    <div className="app-page screen-moderation-mode">
      <PageHeader
        title="Moderation mode"
        description="Whether employer jobs wait for your approval."
        actions={<Link className={buttonClass({variant: 'secondary'})} to="/manage/moderation">Open the queue</Link>}
      />
      {current.isPending ? (
        <LoadingBlock rows={3} />
      ) : current.error ? (
        <ErrorNote error={current.error} />
      ) : (
        <Card footer={<Button pending={save.isPending} pendingLabel="Saving…" disabled={value === current.data.mode} onClick={() => save.mutate()}>Save</Button>}>
          <div className="form-stack">
            <RadioCards<ModerationMode>
              legend="New and edited jobs"
              name="moderation"
              value={value}
              onChange={setMode}
              options={[
                {value: 'all', title: 'Review every job', description: 'Jobs wait in the queue until approved.'},
                {value: 'auto', title: 'Publish at once', description: 'Jobs go live when paid. You can still close or delete them.'},
              ]}
            />
            <p className="muted">Jobs already waiting stay in the queue.</p>
            {save.error && <ErrorNote error={save.error} />}
          </div>
        </Card>
      )}
    </div>
  );
}
