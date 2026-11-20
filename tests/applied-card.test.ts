import {describe, expect, it} from 'vitest';

import {APPLICATION_STATUSES} from '../src/lib/board';
import {appliedCard} from '../src/lib/types-profile';

/** The job page's "Already applied" card (apply-form.ts) never contradicts My applications. */
describe('appliedCard', () => {
  it('marks the steps the application has reached', () => {
    expect(appliedCard('new').steps).toBe(1);
    expect(appliedCard('reviewed').steps).toBe(2);
    expect(appliedCard('shortlisted').steps).toBe(3);
    expect(appliedCard('approved').steps).toBe(3);
  });

  it('a not-selected application is not "on its way" and shows no next step', () => {
    const card = appliedCard('rejected');
    expect(card.steps).toBe(0);
    expect(card.title).not.toMatch(/on its way/i);
    expect(card.title).toMatch(/not selected/i);
  });

  it('an older server without a status keeps the plain card', () => {
    expect(appliedCard(undefined)).toEqual(appliedCard('new'));
  });

  it('every status has its own title', () => {
    expect(new Set(APPLICATION_STATUSES.map(s => appliedCard(s).title)).size).toBe(APPLICATION_STATUSES.length);
  });
});
