import {keepPreviousData, useInfiniteQuery} from '@tanstack/react-query';
import {type FormEvent, useState} from 'react';

import type {EmailLogRow, EmailLogStatus} from '../../../lib/types-manage';
import {ago, when} from '../../shared';
import {Button, Card, type Column, DataTable, EmptyState, ErrorNote, LoadMore, PageHeader, SearchInput, SegmentedControl, StatusBadge, type Tone} from '../../ui';
import {emailLogQuery} from '../queries';

const TONES: Record<EmailLogStatus, Tone> = {sent: 'success', failed: 'danger', skipped: 'neutral'};
const FILTERS: {value: '' | EmailLogStatus; label: string}[] = [
  {value: '', label: 'All'},
  {value: 'sent', label: 'Sent'},
  {value: 'failed', label: 'Failed'},
  {value: 'skipped', label: 'Skipped'},
];

/** `/manage/emails` (site:board:reports): every board email, newest first. "Skipped" = no mail service set up. */
export function Emails() {
  const [to, setTo] = useState('');
  const [filter, setFilter] = useState<{status: '' | EmailLogStatus; to: string}>({status: '', to: ''});
  // The last list stays on screen while a new filter loads (no flash of the empty skeleton).
  const emails = useInfiniteQuery({...emailLogQuery(filter), placeholderData: keepPreviousData});
  const rows = emails.data?.pages.flatMap(page => page.emails);

  const columns: Column<EmailLogRow>[] = [
    {key: 'template', header: 'Email', cell: e => <span><span className="cell-title">{e.templateKey}</span><span className="cell-sub">{e.to}</span></span>},
    {key: 'status', header: 'Status', width: 'shrink', cell: e => <StatusBadge tone={TONES[e.status]}>{e.status}</StatusBadge>},
    {key: 'error', header: 'Detail', hideOnMobile: true, cell: e => <span className="muted">{e.error ?? '—'}</span>},
    {key: 'when', header: 'When', width: 'shrink', cell: e => <time className="muted" dateTime={e.createdAt} title={when(e.createdAt)}>{ago(e.createdAt)}</time>},
  ];
  const search = (event: FormEvent) => {
    event.preventDefault();
    setFilter(current => ({...current, to: to.trim().toLowerCase()}));
  };
  const filtered = Boolean(filter.status || filter.to);

  return (
    <div className="app-page screen-emails">
      <PageHeader title="Email log" description="Every email the board sent itself. Account emails (sign-in, password) are the platform's and are not listed." />
      <div className="toolbar">
        <form role="search" onSubmit={search} noValidate>
          <SearchInput label="Find emails to an exact address" placeholder="Exact address, then Enter" value={to} maxLength={254} autoComplete="off" onChange={e => setTo(e.target.value)} />
        </form>
        <SegmentedControl label="Status" options={FILTERS} value={filter.status} onChange={status => setFilter(current => ({...current, status}))} />
      </div>
      <Card flush>
        <DataTable
          caption="Email log"
          columns={columns}
          rows={rows}
          rowKey={e => e.id}
          loading={emails.isPending}
          error={emails.error}
          empty={
            filtered ? (
              <EmptyState icon="search" title="No emails match" action={<Button variant="secondary" onClick={() => { setTo(''); setFilter({status: '', to: ''}); }}>Show all</Button>}>
                Check the address: the search needs all of it.
              </EmptyState>
            ) : (
              <EmptyState icon="mail" title="No emails yet">Emails show here as the board sends them.</EmptyState>
            )
          }
        />
      </Card>
      {emails.error && rows?.length ? <ErrorNote error={emails.error} /> : null}
      <LoadMore query={emails} />
    </div>
  );
}
