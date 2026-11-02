import {JOB_STATUS_LABELS, type JobSource, type JobStatus} from '../../lib/board';
import type {Bounded} from '../../lib/types-manage';
import type {Tone} from '../ui';

/** Display helpers for the admin screens. */

export const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', {style: 'currency', currency, maximumFractionDigits: cents % 100 ? 2 : 0}).format(cents / 100);

export const bounded = (n: Bounded | undefined) => (n ? `${n.value.toLocaleString('en-US')}${n.more ? '+' : ''}` : null);

export const JOB_STATUS_TONES: Record<JobStatus, Tone> = {
  draft: 'neutral',
  pending_payment: 'warning',
  pending_review: 'info',
  published: 'success',
  rejected: 'danger',
  expired: 'neutral',
  closed: 'neutral',
};

export const jobStatusLabel = (status: JobStatus) => JOB_STATUS_LABELS[status] ?? status;

export const SOURCE_LABELS: Record<JobSource, string> = {
  paid: 'Paid',
  credit: 'Credit',
  free: 'Free (employer)',
  admin: 'Admin',
  import: 'Import',
};

export const day = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-GB', {dateStyle: 'medium'}).format(new Date(iso)) : '—';
