/**
 * BROWSER: the apply form on the job page (./ApplySection.astro). Three steps, then the
 * application: ask `/site-api/applications/resume` for an upload URL, PUT the file there
 * (`putFile`, the bytes never pass through the Site API), confirm it, then apply with the
 * resume's token. A token stays usable after a failed apply (wrong field, already applied), so
 * fixing a field does not upload the same file again.
 */
import {replaceWithMessage} from '../../lib/account';
import {LIMITS} from '../../lib/board';
import {bindForm, postJson, type SubmitResult} from '../../lib/form';
import {rules, type Rule} from '../../lib/rules';
import {RESUME_UPLOAD_TYPES} from '../../lib/types-apply';
import {siteFetch} from '../../platform/browser';
import {putFile, type UploadGrant} from '../../platform/files-browser';

const PHONE_RE = /^[+\d][\d\s().-]{4,39}$/;
const MAX_BYTES = LIMITS.resumeMb * 1024 * 1024;

const httpsLink: Rule = value => {
  const v = value.trim();
  if (!v) return null;
  try {
    return v.length <= 300 && new URL(v).protocol === 'https:' ? null : 'Enter a link that starts with https://, up to 300 characters.';
  } catch {
    return 'Enter a link that starts with https://, up to 300 characters.';
  }
};

function resumeRule(input: HTMLInputElement): Rule {
  return () => {
    const file = input.files?.[0];
    if (!file) return 'Add your resume.';
    if (!(RESUME_UPLOAD_TYPES as readonly string[]).includes(file.type)) return 'Upload a PDF or DOCX file.';
    if (file.size < 1 || file.size > MAX_BYTES) return `Your resume must be ${LIMITS.resumeMb} MB or smaller.`;
    return null;
  };
}

/** Upload one file; the token the application sends back, or a field error. */
async function uploadResume(file: File): Promise<{token: string} | SubmitResult> {
  const asked = await postJson(siteFetch, '/site-api/applications/resume', {name: file.name, contentType: file.type, size: file.size});
  if (!asked.result.ok) return asked.result;
  const grant = asked.data as {token: string; upload: UploadGrant['upload']};
  const put = await putFile(grant.upload, file);
  if (!put.ok) return {ok: false, fields: {resume: put.message}};
  const done = await postJson(siteFetch, '/site-api/applications/resume/complete', {token: grant.token});
  if (!done.result.ok) return done.result;
  return {token: grant.token};
}

function bindClicks(section: HTMLElement, slug: string) {
  section.querySelectorAll<HTMLAnchorElement>('[data-apply-click]').forEach(link => {
    link.addEventListener('click', () => {
      // Counted on the way out; never blocks the link.
      void siteFetch(`/site-api/applications/jobs/${encodeURIComponent(slug)}/click`, {method: 'POST', keepalive: true}).catch(() => undefined);
    });
  });
}

function bindApplyForm(form: HTMLFormElement, slug: string) {
  const resume = form.elements.namedItem('resume') as HTMLInputElement;
  const consent = form.elements.namedItem('consent') as HTMLInputElement;
  let uploaded: {file: File; token: string} | null = null;
  const progress = form.querySelector<HTMLElement>('[data-upload-progress]');
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  /** Says which step runs: in the line under the resume field and on the (pending) button. */
  const step = (line: string | null, label?: string) => {
    if (progress) {
      progress.textContent = line ?? '';
      progress.hidden = !line;
    }
    const text = button?.lastChild;
    if (label && button?.getAttribute('aria-busy') === 'true' && text?.nodeType === Node.TEXT_NODE) text.textContent = label;
  };

  bindForm(form, {
    rules: {
      name: [rules.required('Enter your name.'), rules.maxLength(LIMITS.applicantName)],
      email: [rules.required('Enter your email address.'), rules.email(), rules.maxLength(254)],
      phone: [rules.maxLength(40), rules.pattern(PHONE_RE, 'Enter a phone number with digits only, like +1 555 123 4567.')],
      profileUrl: [httpsLink],
      resume: [resumeRule(resume)],
      coverNote: [rules.maxLength(LIMITS.coverNote)],
      consent: [() => (consent.checked ? null : 'Tick the box to agree before you apply.')],
    },
    pendingLabel: 'Sending application…',
    async submit(values) {
      const file = resume.files![0]!;
      if (uploaded?.file !== file) {
        const mb = (file.size / 1024 / 1024).toFixed(1);
        step(`Uploading ${file.name} (${mb} MB)…`, 'Uploading resume…');
        const result = await uploadResume(file);
        if (!('token' in result)) {
          step(null);
          return result;
        }
        uploaded = {file, token: result.token};
        step('Resume uploaded.', 'Sending application…');
      }
      const {res, result} = await postJson(siteFetch, `/site-api/applications/jobs/${encodeURIComponent(slug)}/apply`, {
        name: values.name,
        email: values.email,
        phone: values.phone,
        profileUrl: values.profileUrl,
        coverNote: values.coverNote,
        website: values.website,
        consent: consent.checked,
        resumeToken: uploaded.token,
      });
      // The resume was refused (used, expired): the next submit uploads it again.
      if (!result.ok && result.fields?.resume) uploaded = null;
      if (res?.status === 201) {
        replaceWithMessage(form, result.message ?? 'Application sent. Check your inbox for a confirmation.');
        return {ok: true};
      }
      return result;
    },
  });
}

const BLOCKED_NOTES = {
  own_job: 'This is your company’s job, so you cannot apply to it. Its applicants are in your dashboard.',
  staff: 'You are signed in as board staff, so the apply form is hidden. Applicants are in the dashboard.',
} as const;

/** The job's own employer and staff see a note instead of the form (the server refuses the owner too). */
async function hideForEmployerAndStaff(section: HTMLElement, form: HTMLFormElement, slug: string) {
  let answer: {canApply?: boolean; reason?: keyof typeof BLOCKED_NOTES | null} | null = null;
  try {
    const res = await siteFetch(`/site-api/applications/jobs/${encodeURIComponent(slug)}/can-apply`);
    answer = res.ok ? await res.json() : null;
  } catch {
    answer = null;
  }
  if (!answer || answer.canApply !== false || !answer.reason || !(answer.reason in BLOCKED_NOTES)) return;
  const note = section.querySelector<HTMLElement>('[data-apply-blocked]');
  if (!note) return;
  note.textContent = BLOCKED_NOTES[answer.reason];
  note.hidden = false;
  form.hidden = true;
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
    void hideForEmployerAndStaff(section, form, slug);
  });
}
