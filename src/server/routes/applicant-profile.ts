import {type Context, Hono} from 'hono';
import type {ContentfulStatusCode} from 'hono/utils/http-status';
import {createMiddleware} from 'hono/factory';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {
  GENDERS,
  PHONE_RE,
  PROFILE_LIMITS,
  type ApplicantProfileAnswer,
  type ProfileDetails,
} from '../../lib/types-profile';
import type {Viewer} from '../../lib/types';
import {fileUrl} from '../files';
import {can, problem, requireAuth, requireVerified, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';
import {
  accountKind,
  checkFileInput,
  dropProfileFile,
  finishProfileUpload,
  PROFILE_UPLOADS_PER_HOUR,
  type ProfileFileKind,
  profileSelect,
  startProfileUpload,
  toProfileView,
} from '../board/applicant-profile';
import {userAttemptAllowed} from '../board/employer-logo';
import {trackProfileUpload} from '../board/applicant-profile';

/**
 * The job seeker's own profile, mounted at `/site-api/applicant-profile`. Signed in with a
 * confirmed email; the account comes from the session only, never from the request.
 *
 *   GET    /                    {kind, profile}: what this account is, and its profile (or null)
 *   POST   /start               make this account an applicant account (refused for a company owner and staff)
 *   PUT    /                    the details (everything but the files)
 *   POST   /photo|resume        {name, contentType, size} → a private upload URL + token
 *   POST   /photo|resume/complete  {fileId, token}: checks the stored bytes, then it is the profile's
 *   GET    /photo               the own photo (a redirect to a 5-minute link)
 *   GET    /resume              the own CV, downloaded
 */
type Env = {Variables: {viewer: Viewer; db: PrismaClient; cacheControl?: string}};

/**
 * `withViewer` stamps `private, no-store` on every answer AFTER the handler. Registered before it,
 * this puts back a header a handler chose on purpose (`c.set('cacheControl', …)`): only the own
 * photo's versioned redirect does. Every other answer keeps `no-store`.
 */
const keepChosenCacheControl = createMiddleware<Env>(async (c, next) => {
  await next();
  const chosen = c.get('cacheControl');
  if (chosen) c.header('Cache-Control', chosen);
});

const invalid = (c: Context, fields: Record<string, string>) =>
  c.json({...problem('invalid_input', Object.values(fields)[0] ?? 'Check the highlighted fields.'), fields}, 422);

const text = (v: unknown, max: number): string | null | false => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') return false;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? false : t;
};

const oneLine = (s: string) => !/[\u0000-\u001f\u007f\u2028\u2029]/.test(s);

const detailsBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const L = PROFILE_LIMITS;
  const read = (key: keyof ProfileDetails, max: number, label: string, multiline = false) => {
    const t = text(v[key], max);
    if (t === false) fields[key] = `${label}: use at most ${max} characters.`;
    else if (t && !multiline && !oneLine(t)) fields[key] = `${label}: keep it on one line.`;
    return t || null;
  };
  const phone = read('phone', L.phone, 'Phone');
  if (phone && !PHONE_RE.test(phone)) fields.phone = 'Enter a phone number with digits only, like +880 1700 000000.';
  let dateOfBirth: string | null = null;
  if (v.dateOfBirth) {
    const d = typeof v.dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.dateOfBirth) ? new Date(`${v.dateOfBirth}T00:00:00Z`) : null;
    const age = d ? (Date.now() - d.getTime()) / (365.25 * 86_400_000) : NaN;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v.dateOfBirth || age < 14 || age > 100) fields.dateOfBirth = 'Enter a real date of birth.';
    else dateOfBirth = v.dateOfBirth as string;
  }
  const gender = v.gender === null || v.gender === undefined || v.gender === '' ? null : (GENDERS as readonly unknown[]).includes(v.gender) ? (v.gender as ProfileDetails['gender']) : undefined;
  if (gender === undefined) fields.gender = 'Pick one.';
  const whole = (key: 'experienceYears' | 'passingYear', min: number, max: number, message: string) => {
    const raw = v[key];
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,4}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
    if (!Number.isInteger(n) || n < min || n > max) {
      fields[key] = message;
      return null;
    }
    return n;
  };
  const experienceYears = whole('experienceYears', 0, L.experienceYearsMax, `Enter whole years, 0 to ${L.experienceYearsMax}.`);
  const passingYear = whole('passingYear', L.passingYearMin, L.passingYearMax, 'Enter a year like 2020.');
  const profileUrl = read('profileUrl', L.profileUrl, 'Link');
  if (profileUrl) {
    let ok = false;
    try {
      ok = new URL(profileUrl).protocol === 'https:';
    } catch {
      ok = false;
    }
    if (!ok) fields.profileUrl = 'Enter a link that starts with https://.';
  }
  const details: ProfileDetails = {
    phone,
    dateOfBirth,
    gender: gender ?? null,
    presentAddress: read('presentAddress', L.address, 'Present address'),
    permanentAddress: read('permanentAddress', L.address, 'Permanent address'),
    headline: read('headline', L.headline, 'Career title'),
    careerSummary: read('careerSummary', L.careerSummary, 'Career summary', true),
    experienceYears,
    expectedSalary: read('expectedSalary', L.expectedSalary, 'Expected salary'),
    degree: read('degree', L.degree, 'Degree'),
    institute: read('institute', L.institute, 'Institute'),
    passingYear,
    skills: read('skills', L.skills, 'Skills', true),
    profileUrl,
  };
  if (Object.keys(fields).length) return invalid(c, fields);
  return details;
});

const fileBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const name = typeof v.name === 'string' ? v.name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(-200) : '';
  const contentType = typeof v.contentType === 'string' ? v.contentType : '';
  const size = typeof v.size === 'number' && Number.isSafeInteger(v.size) ? v.size : 0;
  return {name, contentType, size};
});

const completeBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const fileId = typeof v.fileId === 'string' ? v.fileId : '';
  const token = typeof v.token === 'string' ? v.token : '';
  if (!fileId || !token) return c.json(problem('invalid_input', 'Choose the file again.'), 422);
  return {fileId, token};
});

const status = (n: number): ContentfulStatusCode => (n === 402 ? 402 : n === 503 ? 503 : n === 422 ? 422 : 400);

/** The signed-in applicant's profile row, or null (not an applicant account). */
const ownProfile = (db: PrismaClient, userId: number) => db.applicantProfile.findUnique({where: {userId}, select: profileSelect});

const NOT_APPLICANT = problem('not_applicant', 'Set up your job seeker profile first.');

async function answer(c: Context<Env>): Promise<ApplicantProfileAnswer> {
  const viewer = c.var.viewer;
  const db = c.var.db;
  const [kind, row] = await Promise.all([accountKind(db, viewer.id!), ownProfile(db, viewer.id!)]);
  return {kind, profile: row ? toProfileView(row, {name: viewer.name ?? '', email: viewer.email ?? ''}) : null};
}

/** One of the two private files: the upload URL, its confirmation, and the own link. */
function fileRoutes(kind: ProfileFileKind) {
  const column = kind === 'photo' ? 'photoFileId' : 'resumeFileId';
  return new Hono<Env>()
    .post('/', fileBody, async c => {
      const db = c.var.db;
      const userId = c.var.viewer.id!;
      const input = c.req.valid('json');
      const wrong = checkFileInput(kind, input);
      if (wrong) return invalid(c, {[kind]: wrong});
      if (!(await db.applicantProfile.findUnique({where: {userId}, select: {userId: true}}))) return c.json(NOT_APPLICANT, 409);
      if (!(await userAttemptAllowed(db, 'profile-file', userId, PROFILE_UPLOADS_PER_HOUR))) {
        return c.json(problem('rate_limited', 'Too many uploads in the last hour. Try again later.'), 429);
      }
      const grant = await startProfileUpload(c.req.url, userId, kind, input);
      if (!grant.ok) return c.json({...problem(grant.code, grant.message), fields: {[kind]: grant.message}}, status(grant.status));
      // Tracked until `/complete` takes it: an upload never confirmed (tab closed) is swept by the
      // nightly purge after a day, like any upload never attached (tasks.ts).
      await trackProfileUpload(db, grant.fileId, input);
      return c.json({fileId: grant.fileId, token: grant.token, upload: grant.upload}, 201);
    })
    .post('/complete', completeBody, async c => {
      const db = c.var.db;
      const userId = c.var.viewer.id!;
      const {fileId, token} = c.req.valid('json');
      const before = await db.applicantProfile.findUnique({where: {userId}, select: {photoFileId: true, resumeFileId: true}});
      if (!before) return c.json(NOT_APPLICANT, 409);
      // A repeat of the same confirmation: already done.
      if (before[column] === fileId) return c.json(await answer(c));
      const done = await finishProfileUpload(c.req.url, userId, kind, fileId, token);
      if (!done.ok) return c.json({...problem(done.code, done.message), fields: {[kind]: done.message}}, status(done.status));
      const now = new Date();
      // Only over the file read above: a second tab that switched it first wins, and this new
      // file (referenced by nothing) is dropped instead of being left behind.
      const {count} = await db.applicantProfile.updateMany({
        where: {userId, [column]: before[column]},
        data: kind === 'photo' ? {photoFileId: done.fileId} : {resumeFileId: done.fileId, resumeFileName: done.name, resumeUpdatedAt: now},
      });
      await db.resumeUpload.deleteMany({where: {fileId: done.fileId, applicationId: null}});
      // The old photo goes now; an old CV only once no application points at it.
      await dropProfileFile(db, c.req.url, count ? before[column] : done.fileId);
      return c.json(await answer(c));
    })
    .get('/', async c => {
      const row = await c.var.db.applicantProfile.findUnique({where: {userId: c.var.viewer.id!}, select: {[column]: true}});
      const fileId = (row as Record<string, string | null> | null)?.[column];
      if (!fileId) return c.json(problem('not_found', 'Nothing uploaded yet.'), 404);
      const link = await fileUrl(c.req.url, fileId, {expiresIn: 300, download: kind === 'resume'}).catch(() => null);
      if (!link?.ok) return c.json(problem('storage_unavailable', 'The file cannot be shown right now.'), 503);
      // The photo's `?v=` (the file id's tail, `ownPhotoUrl`) names this very file: the browser may
      // keep that redirect for 4 minutes (the link lives 5), so the sidebar photo on every dashboard
      // page is not a Worker call and a storage link each time. A new photo is a new `v`.
      const versioned = kind === 'photo' && c.req.query('v') === fileId.slice(-8);
      c.header('Cache-Control', 'private, no-store');
      if (versioned) c.set('cacheControl', 'private, max-age=240');
      return c.redirect(link.data.url, 302);
    });
}

export const applicantProfileRoutes = new Hono<Env>()
  .use('*', keepChosenCacheControl, withViewer, requireAuth, requireVerified, withDb)

  .get('/', async c => c.json(await answer(c)))

  .post('/start', async c => {
    const db = c.var.db;
    const userId = c.var.viewer.id!;
    const kind = await accountKind(db, userId);
    if (kind === 'employer') {
      return c.json(problem('employer_account', 'This is a company account. Sign up with another email to apply for jobs.'), 409);
    }
    // Board staff see the board's own applicants; they do not apply with the same account.
    if (kind === 'none' && (await can(c as unknown as Context<{Variables: {viewer: Viewer}}>, PERMISSIONS.APPLICANT_READ_ALL))) {
      return c.json(problem('staff_account', 'Staff accounts cannot apply for jobs. Sign up with another email.'), 409);
    }
    // Idempotent: a second tab's start finds the row there.
    const {count} = await db.applicantProfile.createMany({data: [{userId}], skipDuplicates: true});
    // Written, THEN checked: a company created at the same moment (another tab) is seen here or sees
    // this row (employer.ts), so the account never ends up both. This start lets go of its row.
    if (count && (await db.company.findUnique({where: {ownerUserId: userId}, select: {id: true}}))) {
      await db.applicantProfile.deleteMany({where: {userId, photoFileId: null, resumeFileId: null}});
      return c.json(problem('employer_account', 'This is a company account. Sign up with another email to apply for jobs.'), 409);
    }
    return c.json(await answer(c));
  })

  .put('/', detailsBody, async c => {
    const db = c.var.db;
    const d = c.req.valid('json');
    const viewer = c.var.viewer;
    // The saved row comes back from the write itself: no second read. A profile row makes the
    // account an applicant account, so that is its kind.
    const [row] = await db.applicantProfile.updateManyAndReturn({
      where: {userId: viewer.id!},
      data: {...d, dateOfBirth: d.dateOfBirth ? new Date(`${d.dateOfBirth}T00:00:00Z`) : null},
      select: profileSelect,
    });
    if (!row) return c.json(NOT_APPLICANT, 409);
    return c.json<ApplicantProfileAnswer>({kind: 'applicant', profile: toProfileView(row, {name: viewer.name ?? '', email: viewer.email ?? ''})});
  })

  .route('/photo', fileRoutes('photo'))
  .route('/resume', fileRoutes('resume'));
