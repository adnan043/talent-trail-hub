import {useInfiniteQuery} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {type KeyboardEvent, useEffect, useMemo, useRef, useState} from 'react';

import {adminJobsQuery, NO_JOB_FILTERS} from './admin/queries';
import {myJobsQuery} from './employer/queries';
import {useMe} from './shared';
import {Icon, type IconName, Modal} from './ui';

/**
 * The top bar's search (⌘K / Ctrl+K): jumps to a screen of the sidebar, or to a job.
 * Staff who manage jobs search the whole board on the server (`q`, a capped page);
 * an employer searches the first page of their own jobs in the browser (it is already cached).
 */
export type SearchScreen = {to: string; label: string; icon: IconName; group: string};

type Hit = {key: string; label: string; detail: string; icon: IconName; go: () => void};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function useDebounced(value: string, ms: number) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return out;
}

export function CommandSearch({screens}: {screens: SearchScreen[]}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <button type="button" className="app-cmd" aria-label="Search jobs and screens" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'} onClick={() => setOpen(true)}>
        <Icon name="search" size={16} />
        <span>Search jobs and screens</span>
        <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Search" size="md">
        {open && <SearchBody screens={screens} close={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function SearchBody({screens, close}: {screens: SearchScreen[]; close: () => void}) {
  const me = useMe();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 250);
  const list = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // The dialog moves focus to its first control when it opens (the ×): the field takes it after.
  useEffect(() => {
    const t = window.setTimeout(() => input.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);
  const canBoard = Boolean(me.data?.abilities.manageJobs);
  const isEmployer = Boolean(me.data && !me.data.board.singleCompany && !canBoard);

  const boardJobs = useInfiniteQuery({...adminJobsQuery({...NO_JOB_FILTERS, q}), enabled: canBoard && q.length >= 2});
  const ownJobs = useInfiniteQuery({...myJobsQuery, enabled: isEmployer});

  const hits = useMemo<Hit[]>(() => {
    const needle = text.trim().toLowerCase();
    const go = (fn: () => void) => () => {
      close();
      fn();
    };
    const out: Hit[] = screens
      .filter(s => !needle || s.label.toLowerCase().includes(needle) || s.group.toLowerCase().includes(needle))
      .slice(0, needle ? 6 : 8)
      .map(s => ({key: `s:${s.to}`, label: s.label, detail: s.group, icon: s.icon, go: go(() => void navigate({to: s.to}))}));
    if (canBoard && q.length >= 2) {
      for (const job of boardJobs.data?.pages[0]?.jobs.slice(0, 8) ?? [])
        out.push({key: `j:${job.id}`, label: job.title, detail: job.company, icon: 'briefcase', go: go(() => void navigate({to: '/manage/jobs/$id', params: {id: String(job.id)}}))});
    }
    if (isEmployer && needle.length >= 1) {
      const mine = ownJobs.data?.pages.flatMap(p => p.items) ?? [];
      for (const job of mine.filter(j => j.title.toLowerCase().includes(needle)).slice(0, 8))
        out.push({key: `j:${job.id}`, label: job.title, detail: 'Your job · applicants', icon: 'briefcase', go: go(() => void navigate({to: '/employer/jobs/$id/applicants', params: {id: String(job.id)}}))});
    }
    return out;
  }, [screens, text, q, canBoard, isEmployer, boardJobs.data, ownJobs.data, navigate, close]);

  const move = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const nodes = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    if (!nodes.length) return;
    event.preventDefault();
    const at = nodes.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (at + 1) % nodes.length : at <= 0 ? nodes.length - 1 : at - 1;
    nodes[next]?.focus();
  };
  const searching = canBoard && text.trim().length >= 2 && (q !== text.trim() || boardJobs.isFetching);

  return (
    <div className="cmd" onKeyDown={move}>
      <div className="search-input cmd-input">
        <Icon name="search" size={16} />
        <input
          ref={input}
          type="search"
          aria-label="Search"
          placeholder={canBoard ? 'Job title, company or a screen' : 'A job of yours or a screen'}
          value={text}
          maxLength={100}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && hits[0]) {
              event.preventDefault();
              hits[0].go();
            }
          }}
        />
      </div>
      <p className="visually-hidden" role="status">
        {searching ? 'Searching…' : `${hits.length} result${hits.length === 1 ? '' : 's'}`}
      </p>
      {hits.length ? (
        <ul className="cmd-list" ref={list}>
          {hits.map(hit => (
            <li key={hit.key}>
              <button type="button" className="cmd-item" onClick={hit.go}>
                <span className="cmd-icon">
                  <Icon name={hit.icon} size={16} />
                </span>
                <span className="cmd-text">
                  <b>{hit.label}</b>
                  <small>{hit.detail}</small>
                </span>
                <Icon name="arrow-right" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cmd-empty">{searching ? 'Searching…' : 'Nothing matches. Try another word.'}</p>
      )}
    </div>
  );
}
