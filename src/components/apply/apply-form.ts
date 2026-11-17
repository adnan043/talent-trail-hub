/**
 * BROWSER: the apply section on the job page (./ApplySection.astro). Applying needs a job seeker
 * account, so the section first asks `/site-api/applications/jobs/:slug/can-apply` and shows ONE
 * step: sign in, set up the profile, finish it (photo, CV, phone), or the one-click form. The form
 * sends only the cover note and the consent: the name, email, phone and CV come from the profile,
 * on the server. Everything about the visitor is written with `textContent`, never as HTML.
 */
import {replaceWithMessage} from '../../lib/account';
import {LIMITS} from '../../lib/board';
import {bindForm, postJson} from '../../lib/form';
import {rules} from '../../lib/rules';
import {type CanApplyAnswer, REQUIREMENT_LABELS} from '../../lib/types-profile';
import {siteFetch} from '../../platform/browser';

function bindClicks(section: HTMLElement, slug: string) {
  section.querySelectorAll<HTMLAnchorElement>('[data-apply-click]').forEach(link => {
    // The job page's own script binds these links too (url / email jobs have no apply section):
    // whichever runs first takes the link, so a click is counted once.
    if (link.dataset.clickBound) return;
    link.dataset.clickBound = '1';
    link.addEventListener('click', () => {
      // Counted on the way out; never blocks the link.
      void siteFetch(`/site-api/applications/jobs/${encodeURIComponent(slug)}/click`, {method: 'POST', keepalive: true}).catch(() => undefined);
    });
  });
}

function bindApplyForm(form: HTMLFormElement, slug: string) {
  const consent = form.elements.namedItem('consent') as HTMLInputElement;
  bindForm(form, {
    rules: {
      coverNote: [rules.maxLength(LIMITS.coverNote)],
      consent: [() => (consent.checked ? null : 'Tick the box to agree before you apply.')],
    },
    pendingLabel: 'Sending application…',
    async submit(values) {
      const {res, result} = await postJson(siteFetch, `/site-api/applications/jobs/${encodeURIComponent(slug)}/apply`, {
        coverNote: values.coverNote,
        consent: consent.checked,
      });
      if (res?.status === 201) {
        replaceWithMessage(form, result.message ?? 'Application sent. Follow it under My applications in your dashboard.');
        return {ok: true};
      }
      return result;
    },
  });
}

const BLOCKED_NOTES: Partial<Record<NonNullable<CanApplyAnswer['reason']>, string>> = {
  own_job: 'This is your company’s job, so you cannot apply to it. Its applicants are in your dashboard.',
  staff: 'You are signed in as board staff. To apply for jobs, sign up with another email as a job seeker.',
  employer_account: 'You are signed in with a company account. To apply for jobs, sign up with another email as a job seeker.',
  closed: 'This job is no longer taking applications.',
  applied: 'You have already applied for this job. Follow its status under My applications in your dashboard.',
};

async function ask(slug: string): Promise<CanApplyAnswer | null> {
  try {
    const res = await siteFetch(`/site-api/applications/jobs/${encodeURIComponent(slug)}/can-apply`);
    // Still 401 after the refresh: the session is gone, so sign in again.
    if (res.status === 401) return {canApply: false, reason: 'sign_in'};
    return res.ok ? ((await res.json()) as CanApplyAnswer) : null;
  } catch {
    return null;
  }
}

/** Shows the one step that fits this visitor. */
async function showStep(section: HTMLElement, form: HTMLFormElement, slug: string) {
  const answer = await ask(slug);
  const pick = (name: string) => section.querySelector<HTMLElement>(`[data-${name}]`);
  pick('apply-loading')?.setAttribute('hidden', '');
  const show = (name: string) => pick(name)?.removeAttribute('hidden');

  if (answer?.reason === 'sign_in') return show('apply-signin');
  if (answer?.canApply && answer.profile) {
    const set = (field: string, value: string | null) => {
      const node = form.querySelector<HTMLElement>(`[data-profile-${field}]`);
      if (node) node.textContent = value || '—';
    };
    set('name', answer.profile.name);
    set('email', answer.profile.email);
    set('phone', answer.profile.phone);
    set('resume', answer.profile.resumeFileName);
    form.hidden = false;
    return;
  }
  if (answer?.reason === 'choose_kind') return show('apply-choose');
  if (answer?.reason === 'incomplete') {
    const line = pick('apply-missing');
    if (line) line.textContent = `Almost there: add ${(answer.missing ?? []).map(m => REQUIREMENT_LABELS[m]).join(', ')} to your profile, then come back to apply.`;
    return show('apply-incomplete');
  }
  const note = pick('apply-blocked');
  // No answer (offline, a server error) or one this page does not know: say so, never "sign in".
  const text = (answer?.reason ? BLOCKED_NOTES[answer.reason] : null) ?? 'We could not check your account just now. Reload the page to try again.';
  if (note && text) {
    note.textContent = text;
    note.hidden = false;
  }
}

/** Wires every apply section on the page (runs on each `astro:page-load`). */
export function bindApplySections() {
  document.querySelectorAll<HTMLElement>('[data-apply-section]').forEach(section => {
    if (section.dataset.bound) return;
    section.dataset.bound = '1';
    const slug = section.dataset.slug ?? '';
    bindClicks(section, slug);
    const form = section.querySelector<HTMLFormElement>('[data-apply-form]');
    if (!form) return;
    bindApplyForm(form, slug);
    void showStep(section, form, slug);
  });
}
