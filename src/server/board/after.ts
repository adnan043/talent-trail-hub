import type {Context} from 'hono';

import {errorLabel} from '../error-label';

/**
 * Work that runs AFTER the answer (emails, counters): the visitor never waits for it, and it never
 * fails the request. On the Worker it is kept alive with `c.executionCtx.waitUntil`; without an
 * execution context (an in-process call) it simply runs on. Errors are logged (name and code
 * only, never the message: it can quote an address), never thrown. Keep it short and bounded:
 * anything slow or that must retry is a background job (docs/agent/background-jobs.md).
 */
export function after(c: Context, label: string, work: () => Promise<unknown>): void {
  let running: Promise<unknown>;
  try {
    running = work();
  } catch (err) {
    running = Promise.reject(err);
  }
  const guarded = running.catch(err => console.error(`${label}: ${errorLabel(err)}`));
  try {
    c.executionCtx.waitUntil(guarded);
  } catch {
    // No execution context: the promise runs on by itself, its errors already handled.
  }
}
