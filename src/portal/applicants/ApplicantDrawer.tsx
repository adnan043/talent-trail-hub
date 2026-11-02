import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useEffect} from 'react';

import {APPLICATION_STATUSES, type ApplicationStatus, LIMITS} from '../../lib/board';
import {APPLICATION_STATUS_LABELS, type ApplicantRow, RESUME_EXPIRED_TEXT} from '../../lib/types-apply';
import {when} from '../shared';
import {Button, DefinitionList, Drawer, ErrorNote, Field, Notice, rules, SegmentedControl, type Tone, useForm, useToast} from '../ui';
import {ApiError} from '../api';
import {patchCachedApplicant, resumeLink, updateApplicant} from './queries';

export const STATUS_TONES: Record<ApplicationStatus, Tone> = {
  new: 'info',
  reviewed: 'neutral',
  shortlisted: 'success',
  rejected: 'danger',
};

const STATUS_OPTIONS = APPLICATION_STATUSES.map(value => ({value, label: APPLICATION_STATUS_LABELS[value]}));

/** Status saves at once (optimistic): the row changes now, and goes back with a toast if the save fails. */
export function useApplicantStatus() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({id, status}: {id: number; status: ApplicationStatus; previous: ApplicationStatus}) => updateApplicant(id, {status}),
    onMutate: ({id, status}) => patchCachedApplicant(queryClient, id, row => ({...row, status})),
    onError: (error, {id, previous}) => {
      patchCachedApplicant(queryClient, id, row => ({...row, status: previous}));
      toast.danger(`The status was not saved: ${error.message}`);
    },
    onSuccess: ({applicant}) => patchCachedApplicant(queryClient, applicant.id, () => applicant),
  });
}

/** Fetches a 10-minute link and starts the download (the link is never stored). */
export function useResumeDownload() {
  const toast = useToast();
  return useMutation({
    mutationFn: (id: number) => resumeLink(id),
    onSuccess: link => window.location.assign(link.url),
    onError: error => toast.danger(error.message),
  });
}

function ResumeButton({applicant}: {applicant: ApplicantRow}) {
  const download = useResumeDownload();
  if (applicant.resumeExpired) return <span className="muted">{RESUME_EXPIRED_TEXT}</span>;
  if (!applicant.resumeFileName) return <span className="muted">No resume</span>;
  return (
    <Button variant="secondary" size="sm" icon="file" pending={download.isPending} pendingLabel="Getting link…" onClick={() => download.mutate(applicant.id)}>
      {applicant.resumeFileName}
    </Button>
  );
}

const safeLink = (value: string | null) => {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
};

/** One applicant's details: status (instant), contact, resume, cover note, private notes. */
export function ApplicantDrawer({applicant, onClose}: {applicant: ApplicantRow | null; onClose: () => void}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const status = useApplicantStatus();
  const form = useForm({notes: applicant?.notes ?? ''}, {notes: [rules.maxLength(LIMITS.employerNotes)]});
  const saveNotes = useMutation({
    mutationFn: ({id, notes}: {id: number; notes: string}) => updateApplicant(id, {notes}),
    onSuccess: ({applicant: row}) => {
      patchCachedApplicant(queryClient, row.id, () => row);
      toast.success('Notes saved.');
    },
    // Only a field error lands on the field; anything else shows above it (saveNotes.error).
    onError: error => {
      if (error instanceof ApiError && error.fields.notes) form.setServerErrors({notes: error.fields.notes});
    },
  });

  // A different applicant: start from their notes.
  useEffect(() => {
    if (applicant) form.reset({notes: applicant.notes});
    saveNotes.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicant?.id]);

  const link = safeLink(applicant?.profileUrl ?? null);
  return (
    <Drawer
      open={applicant !== null}
      onClose={onClose}
      title={applicant?.name ?? ''}
      description={applicant?.job ? `${applicant.job.title} · ${applicant.job.company}` : undefined}
      dismissible={!saveNotes.isPending}
      onSubmit={form.submit(values => applicant && saveNotes.mutate({id: applicant.id, notes: values.notes}))}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saveNotes.isPending}>
            Close
          </Button>
          <Button type="submit" pending={saveNotes.isPending} pendingLabel="Saving…">
            Save notes
          </Button>
        </>
      }>
      {applicant && (
        <div className="form-stack">
          <div className="drawer-status">
            <p className="cell-title">Status</p>
            <SegmentedControl
              label="Status"
              options={STATUS_OPTIONS}
              value={applicant.status}
              onChange={next =>
                next !== applicant.status && status.mutate({id: applicant.id, status: next, previous: applicant.status})
              }
            />
            <p className="field-hint">Shortlisted and rejected candidates get one email about it. Notes are never sent.</p>
          </div>
          <DefinitionList
            items={[
              {label: 'Email', value: <a href={`mailto:${applicant.email}`}>{applicant.email}</a>},
              {label: 'Phone', value: applicant.phone ?? '—'},
              {
                label: 'Profile',
                value: link ? (
                  <a href={link} target="_blank" rel="noopener noreferrer">
                    {link}
                  </a>
                ) : (
                  '—'
                ),
              },
              {label: 'Applied', value: when(applicant.appliedAt)},
              {label: 'Resume', value: <ResumeButton applicant={applicant} />},
            ]}
          />
          {applicant.coverNote ? (
            <div>
              <p className="cell-title">Cover note</p>
              <p>{applicant.coverNote}</p>
            </div>
          ) : (
            <Notice>No cover note.</Notice>
          )}
          {saveNotes.error && !(saveNotes.error instanceof ApiError && saveNotes.error.fields.notes) && (
            <ErrorNote error={saveNotes.error} title="The notes were not saved" />
          )}
          <Field id="f-notes" label="Private notes" hint="Only you and the board’s staff see these." error={form.error('notes')}>
            <textarea {...form.field('notes')} rows={5} placeholder="Interview impressions, next steps…" />
          </Field>
        </div>
      )}
    </Drawer>
  );
}
