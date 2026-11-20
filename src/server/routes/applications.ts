import {type Context, Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {DEFAULT_CONSENT_TEXT, LIMITS} from '../../lib/board';
import {type CanApplyAnswer, missingToApply, missingLabel} from '../../lib/types-profile';
import {normalizeEmail} from '../../platform/auth';
import {can, problem, requireAuth, requireVerified, withDb, withViewer} from '../../platform/guards';
import type {Viewer} from '../../lib/types';
import {PERMISSIONS} from '../permissions';
import {notifyNewApplication, ownerInactive} from '../board/applicants';
import {accountKind} from '../board/applicant-profile';
import {ipHashOf} from '../board/ip';
import {publicJobWhere} from '../board/public';
import {after} from '../board/after';
import {cachedBoardSettings} from '../board/brand';
import {isSingleCompany} from '../board/settings';
import {applicantRoutes} from './applications-manage';

/**
 * F4 apply, mounted at `/site-api/applications`. Applying needs a signed-in APPLICANT account with a
 * confirmed email and a profile holding a photo and a CV
 * (`src/server/routes/applicant-profile.ts`): the application is made from that profile, so the
 * name and email come from the session, never from the request.
 *
 *   POST /jobs/:slug/apply       {coverNote?, consent: true}
 *   GET  /jobs/:slug/can-apply   what the job page shows this visitor (sign in, finish the profile, apply)
 *   POST /jobs/:slug/click       count a click on a url / email apply button
 *   …                            the applicants API (./applications-manage.ts)
 */
const HOUR_MS = 3600_000;
const CLICK_LIMIT = 120;
const SLUG_RE = /^[a-z0-9-]{1,120}$/;

type Db = PrismaClient;
type Kind = 'apply' | 'upload' | 'click';
type Env = {Variables: {viewer: Viewer; db: PrismaClient}};

/**
 * Records this attempt FIRST, then counts the hour's attempts (itself included): true over `limit`.
 * Insert-then-count, so a parallel burst cannot all read "under the limit" before any writes.
 */
export async function overLimit(db: Db, kind: Kind, ipHash: string, limit: number): Promise<boolean> {
  await db.boardAttempt.create({data: {kind, ipHash}, select: {id: true}});
  const recent = await db.boardAttempt.findMany({
    where: {kind, ipHash, createdAt: {gt: new Date(Date.now() - HOUR_MS)}},
    select: {id: true},
    take: limit + 1,
  });
  return recent.length > limit;
}

const noIp = (c: Context) => c.json(problem('auth_not_configured', 'Applying is not set up on this site yet.'), 503);

/** The application form: a cover note and the consent. Everything else comes from the profile. */
const applyBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const coverNote = typeof v.coverNote === 'string' ? v.coverNote.trim() : '';
  const fields: Record<string, string> = {};
  if (coverNote.length > LIMITS.coverNote) fields.coverNote = `Use at most ${LIMITS.coverNote} characters.`;
  if (v.consent !== true) fields.consent = 'Tick the box to agree before you apply.';
  if (Object.keys(fields).length) {
    return c.json({...problem('invalid_input', 'Check the highlighted fields.'), fields}, 422);
  }
  return {coverNote: coverNote || null};
});

const slugOf = (c: Context) => {
  const slug = c.req.param('slug') ?? '';
  return SLUG_RE.test(slug) ? slug : null;
};

const applyProfileSelect = {phone: true, profileUrl: true, headline: true, photoFileId: true, resumeFileId: true, resumeFileName: true} as const;

export const applicationRoutes = new Hono<Env>()
  .post('/jobs/:slug/apply', applyBody, withViewer, requireAuth, requireVerified, withDb, async c => {
    const input = c.req.valid('json');
    const db = c.var.db;
    const viewer = c.var.viewer;
    const email = viewer.email ? normalizeEmail(viewer.email) : null;
    // The site's owner signs in from the dashboard with no address: nothing to apply with.
    if (!email) return c.json(problem('no_email', 'This account has no email address to apply with.'), 409);
    const ipHash = await ipHashOf(c);
    if (!ipHash) return noIp(c);

    const slug = slugOf(c);
    // One parallel trip: the profile, and the job (by its unique slug, once the cached settings are in).
    const [{settings, job}, profile] = await Promise.all([
      cachedBoardSettings(db).then(async settings => ({
        settings,
        job: slug
          ? await db.job.findFirst({
              where: {...publicJobWhere(settings), slug},
              select: {id: true, title: true, slug: true, applyMethod: true, company: {select: {name: true, ownerUserId: true}}},
            })
          : null,
      })),
      db.applicantProfile.findUnique({where: {userId: viewer.id!}, select: applyProfileSelect}),
    ]);
    if (!profile) return c.json(problem('not_applicant', 'Set up your job seeker profile to apply.'), 409);
    const missing = missingToApply({hasPhoto: profile.photoFileId !== null, resumeFileName: profile.resumeFileId});
    if (missing.length) {
      return c.json({...problem('profile_incomplete', `Add ${missingLabel(missing)} to your profile first.`), missing}, 422);
    }
    if (!job) return c.json(problem('not_found', 'This job is no longer taking applications.'), 404);
    if (job.applyMethod !== 'onsite') return c.json(problem('apply_elsewhere', 'This job takes applications on the company’s own site.'), 400);
    if (job.company.ownerUserId === viewer.id) return c.json(problem('own_job', 'This is your company’s job: you cannot apply to it.'), 403);
    if (await ownerInactive(db, job.company.ownerUserId, isSingleCompany(settings))) {
      return c.json(problem('not_found', 'This job is no longer taking applications.'), 404);
    }
    // Counted only now: a refusal above (profile not finished, job closed, own job) sends nothing,
    // so it never uses up the hour's applications of a job seeker who then fixes it and applies.
    if (await overLimit(db, 'apply', ipHash, LIMITS.appliesPerIpHour)) {
      return c.json(problem('rate_limited', 'Too many applications from here in the last hour. Try again later.'), 429);
    }

    const name = (viewer.name ?? '').trim().slice(0, LIMITS.applicantName) || email;
    // ONE statement, so one implicit transaction and one round trip (an interactive transaction
    // opens its own connection and takes five). It locks the profile row and reads the CV as it is
    // NOW: a CV replaced meanwhile (`/resume/complete` waits on this lock) never deletes the file this
    // application points at. A second application from this account inserts nothing
    // (ON CONFLICT on the per-job unique key) and leaves the counter alone. The counter is raw so
    // it leaves `updated_at` (the sitemap's lastmod) alone, like the view and click counters.
    const [result] = await db.$queryRaw<{has_cv: boolean; inserted: boolean}[]>`
      WITH cv AS (
        SELECT "resume_file_id", "resume_file_name" FROM "applicant_profiles"
        WHERE "user_id" = ${viewer.id!}::int AND "resume_file_id" IS NOT NULL
        FOR UPDATE
      ), ins AS (
        INSERT INTO "applications" ("job_id", "applicant_user_id", "name", "email", "phone", "profile_url", "cover_note",
          "resume_file_id", "resume_file_name", "consent_at", "consent_text", "ip_hash", "updated_at")
        SELECT ${job.id}::int, ${viewer.id!}::int, ${name}::text, ${email}::text, ${profile.phone}::text, ${profile.profileUrl}::text,
          ${input.coverNote}::text, cv."resume_file_id", cv."resume_file_name", now(), ${DEFAULT_CONSENT_TEXT}::text, ${ipHash}::text, now()
        FROM cv
        ON CONFLICT DO NOTHING
        RETURNING "id"
      ), counted AS (
        UPDATE "jobs" SET "application_count" = "application_count" + 1
        WHERE "id" = ${job.id}::int AND EXISTS (SELECT 1 FROM ins)
      )
      SELECT EXISTS (SELECT 1 FROM cv) AS "has_cv", EXISTS (SELECT 1 FROM ins) AS "inserted"`;
    if (!result?.has_cv) return c.json(problem('profile_incomplete', 'Add your CV to your profile first.'), 422);
    // The address is the session's own, so saying so tells nobody anything new.
    if (!result.inserted) return c.json(problem('already_applied', 'You have already applied for this job.'), 409);

    // The confirmation and the employer's alert go AFTER the answer (a failed send is logged, never fails this).
    const candidate = {name, email};
    after(c, `apply emails for job ${job.id}`, () => notifyNewApplication(c, db, {job, candidate, boardName: settings.name, singleCompany: isSingleCompany(settings), settings}));
    return c.json({ok: true, message: 'Application sent. Follow it under My applications in your dashboard.'}, 201);
  })

  /** What the job page shows: sign in, pick an account kind, finish the profile, or the apply form. */
  .get('/jobs/:slug/can-apply', withViewer, withDb, async c => {
    const viewer = c.var.viewer;
    const db = c.var.db;
    const slug = slugOf(c);
    // An expired access token: 401 makes `siteFetch` refresh once and ask again.
    if (viewer.state === 'returning') return c.json(problem('token_expired', 'Your session needs refreshing.'), 401);
    const no = (reason: CanApplyAnswer['reason'], more: Partial<CanApplyAnswer> = {}) => c.json<CanApplyAnswer>({canApply: false, reason, ...more});
    if (viewer.state !== 'user' || !viewer.id) return no('sign_in');
    if (!slug) return no(null);
    const email = viewer.email ? normalizeEmail(viewer.email) : null;
    // Applied from this account (even under an older email), or an old GUEST application with this
    // address. Another account's application never counts: an address can pass to a new account.
    const mine = {OR: [{applicantUserId: viewer.id}, ...(email ? [{applicantUserId: null, email}] : [])]};
    // One parallel trip: "already applied?" goes by the job's unique slug, not after the job read.
    const [job, kind, profile, applied] = await Promise.all([
      cachedBoardSettings(db).then(async settings => {
        const found = await db.job.findFirst({where: {...publicJobWhere(settings), slug}, select: {id: true, company: {select: {ownerUserId: true}}}});
        // An employer whose account is suspended takes no applications (the POST answers 404).
        return found && (await ownerInactive(db, found.company.ownerUserId, isSingleCompany(settings))) ? null : found;
      }),
      accountKind(db, viewer.id),
      db.applicantProfile.findUnique({where: {userId: viewer.id}, select: applyProfileSelect}),
      db.application.findFirst({where: {...mine, job: {slug}}, select: {id: true}}),
    ]);
    // A closed, expired or hidden job takes no applications (the POST would answer 404).
    if (!job) return no('closed');
    if (job.company.ownerUserId === viewer.id) return no('own_job');
    if (kind === 'employer') return no('employer_account');
    if (kind === 'none') {
      if (await can(c as unknown as Context<{Variables: {viewer: Viewer}}>, PERMISSIONS.APPLICANT_READ_ALL)) return no('staff');
      return no('choose_kind');
    }
    const summary = {
      name: viewer.name ?? '',
      email: viewer.email ?? '',
      phone: profile?.phone ?? null,
      headline: profile?.headline ?? null,
      resumeFileName: profile?.resumeFileId ? profile.resumeFileName : null,
    };
    if (applied) return no('applied', {profile: summary});
    const missing = profile ? missingToApply({hasPhoto: profile.photoFileId !== null, resumeFileName: profile.resumeFileId}) : [];
    if (missing.length) return no('incomplete', {missing, profile: summary});
    return c.json<CanApplyAnswer>({canApply: true, reason: null, profile: summary});
  })

  /** F4: url / email apply opens the target in the browser; this counts the click (quietly capped). */
  .post('/jobs/:slug/click', withDb, async c => {
    const db = c.var.db;
    const slug = slugOf(c);
    // Answered at once; counted after the answer (quietly capped per IP hash, never an error).
    if (slug) after(c, 'apply click', () => countClick(c, db, slug));
    return c.body(null, 204);
  })

  .route('/', applicantRoutes);

/** +1 apply click on a public url / email job, at most CLICK_LIMIT per IP hash an hour. */
async function countClick(c: Context, db: Db, slug: string): Promise<void> {
  const [ipHash, settings] = await Promise.all([ipHashOf(c), cachedBoardSettings(db)]);
  if (!ipHash || (await overLimit(db, 'click', ipHash, CLICK_LIMIT))) return;
  // ONE statement: `publicJobWhere` in SQL (published, unexpired, company not blocked, the
  // single-company scope). Raw so the counter leaves `updated_at` (the sitemap's lastmod) alone.
  const scope = isSingleCompany(settings) ? settings.ownerCompanyId : null;
  await db.$executeRaw`
    UPDATE "jobs" j SET "apply_click_count" = j."apply_click_count" + 1
    FROM "companies" co
    WHERE co."id" = j."company_id" AND co."is_blocked" = false
      AND j."slug" = ${slug} AND j."status" = 'published' AND j."expires_at" > now()
      AND j."apply_method" IN ('url', 'email')
      AND (${scope}::int IS NULL OR j."company_id" = ${scope}::int)`;
}
