import type {JobStatus} from '../../lib/board';
import type {Tone} from '../ui';

/** Each job status's badge tone, once for the employer screens. */
export const STATUS_TONES: Record<JobStatus, Tone> = {
  draft: 'neutral',
  pending_payment: 'warning',
  pending_review: 'info',
  published: 'success',
  rejected: 'danger',
  expired: 'neutral',
  closed: 'neutral',
};
