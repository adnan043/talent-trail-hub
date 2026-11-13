import {type Context, Hono} from 'hono';
import type {ContentfulStatusCode} from 'hono/utils/http-status';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {DEFAULT_CONSENT_TEXT, LIMITS} from '../../lib/board';
import {RESUME_UPLOAD_TYPES} from '../../lib/types-apply';
import {SiteKeyMissing} from '../../platform/api';
import {randomBytes, toBase64Url} from '../../platform/auth/encoding';
import {completeUpload, createUpload, type FileResult} from '../../platform/files';
import {can, problem, withDb, withViewer} from '../../platform/guards';
import type {Viewer} from '../../lib/types';
import {PERMISSIONS} from '../permissions';
import {notifyNewApplication} from '../board/applicants';
import {checkStoredResume} from '../board/applicants-resume';
import {ipHashOf} from '../board/ip';
import {publicJobWhere} from '../board/public';
import {cachedBoardSettings} from '../board/brand';
import {isSingleCompany} from '../board/settings';
import {applicantRoutes} from './applications-manage';

/**
 * F4 apply without an account (+ F35 basics, F36 consent), mounted at `/site-api/applications`:
 *
 *   POST /resume                 a one-time upload URL for the resume (private file)
 *   POST /resume/complete        confirm the browser's PUT
 *   POST /jobs/:slug/apply       the application (honeypot / > 5 per IP-hour: silently "accepted")
 *   POST /jobs/:slug/click       count a click on a url / email apply button
 *   …                            the applicants API (./applications-manage.ts)
 */
const HOUR_MS = 3600_000;
const UPLOAD_LIMIT = 20;
const CLICK_LIMIT = 120;
const SLUG_RE = /^[a-z0-9-]{1,120}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+\d][\d\s().-]{4,39}$/;

type Db = PrismaClient;
type Kind = 'apply' | 'upload' | 'click';

/** The stored form of a resume token: SHA-256, base64url (43 chars). The raw token is never kept. */
export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(digest));
}

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

/** A storage call, with "no Site Key on this machine" as a clean 503. */
async function storage<T>(work: () => Promise<FileResult<T>>): Promise<FileResult<T>> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof SiteKeyMissing) {
      return {ok: false, status: 503, code: 'E_STORAGE_UNAVAILABLE', message: "Resume uploads aren't available yet. Please try again later."};
    }
    throw err;
  }
}

const storageStatus = (status: number): ContentfulStatusCode => (status === 402 ? 402 : status === 503 || status === 0 ? 503 : 400);

const fieldError = (c: Context, field: string, message: string) =>
  c.json({...problem('invalid_input', message), fields: {[field]: message}}, 422);

const noIp = (c: Context) => c.json(problem('auth_not_configured', 'Applying is not set up on this site yet.'), 503);

const uploadBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const name = typeof v.name === 'string' ? v.name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(-200) : '';
  const contentType = typeof v.contentType === 'string' ? v.contentType : '';
  const size = typeof v.size === 'number' && Number.isSafeInteger(v.size) ? v.size : 0;
  if (!name || !(RESUME_UPLOAD_TYPES as readonly string[]).includes(contentType)) return fieldError(c, 'resume', 'Upload a PDF or DOCX file.');
  if (size < 1 || size > LIMITS.resumeMb * 1024 * 1024) return fieldError(c, 'resume', `Your resume must be ${LIMITS.resumeMb} MB or smaller.`);
  return {name, contentType, size};
});

const tokenBody = validator('json', (value, c) => {
  const token = (value as {token?: unknown})?.token;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return fieldError(c, 'resume', 'Upload your resume again.');
  return {token};
});

const optional = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max + 1) : '');

/** The application form. A filled honeypot (`website`) skips every check: it is answered "accepted". */
const applyBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  if (typeof v.website === 'string' && v.website.trim()) return {honeypot: true as const};
  const name = optional(v.name, LIMITS.applicantName);
  const email = optional(v.email, 254).toLowerCase();
  const phone = optional(v.phone, 40);
  const profileUrl = optional(v.profileUrl, 300);
  const coverNote = optional(v.coverNote, LIMITS.coverNote);
  const resumeToken = typeof v.resumeToken === 'string' ? v.resumeToken : '';
  const fields: Record<string, string> = {};
  if (!name) fields.name = 'Enter your name.';
  else if (name.length > LIMITS.applicantName) fields.name = `Use at most ${LIMITS.applicantName} characters.`;
  if (!email) fields.email = 'Enter your email address.';
  else if (email.length > 254 || !EMAIL_RE.test(email)) fields.email = 'Enter a valid email address, like name@example.com.';
  if (phone && !PHONE_RE.test(phone)) fields.phone = 'Enter a phone number with digits only, like +1 555 123 4567.';
  if (profileUrl) {
    let ok = false;
    try {
      ok = profileUrl.length <= 300 && new URL(profileUrl).protocol === 'https:';
    } catch {
      ok = false;
    }
    if (!ok) fields.profileUrl = 'Enter a link that starts with https://, up to 300 characters.';
  }
  if (coverNote.length > LIMITS.coverNote) fields.coverNote = `Use at most ${LIMITS.coverNote} characters.`;
  if (!TOKEN_RE.test(resumeToken)) fields.resume = 'Add your resume.';
  if (v.consent !== true) fields.consent = 'Tick the box to agree before you apply.';
  if (Object.keys(fields).length) {
    return c.json({...problem('invalid_input', 'Check the highlighted fields.'), fields}, 422);
  }
  return {honeypot: false as const, name, email, phone: phone || null, profileUrl: profileUrl || null, coverNote: coverNote || null, resumeToken};
});

const accepted = (c: Context) => c.json({ok: true, message: 'Application sent. Check your inbox for a confirmation.'}, 201);

const slugOf = (c: Context) => {
  const slug = c.req.param('slug') ?? '';
  return SLUG_RE.test(slug) ? slug : null;
};

export const applicationRoutes = new Hono()
  // 1. A one-time upload URL. Guests may apply, so this is limited per IP hash instead.
  .post('/resume', uploadBody, withDb, async c => {
    const db = c.var.db;
    const ipHash = await ipHashOf(c);
    if (!ipHash) return noIp(c);
    if (await overLimit(db, 'upload', ipHash, UPLOAD_LIMIT)) {
      return c.json(problem('rate_limited', 'Too many uploads from here. Try again in an hour.'), 429);
    }
    const input = c.req.valid('json');
    const grant = await storage(() => createUpload(c.req.url, {...input, visibility: 'private'}));
    if (!grant.ok) return c.json(problem(grant.code, grant.message), storageStatus(grant.status));
    const token = toBase64Url(randomBytes(32));
    await db.resumeUpload.create({
      data: {token: await tokenHash(token), fileId: grant.data.file.id, ...input, ipHash},
      select: {id: true},
    });
    return c.json({token, upload: grant.data.upload}, 201);
  })

  // 2. (the browser PUTs the bytes) 3. confirm before the application may point at it.
  .post('/resume/complete', tokenBody, withDb, async c => {
    const db = c.var.db;
    const upload = await db.resumeUpload.findUnique({
      where: {token: await tokenHash(c.req.valid('json').token)},
      select: {id: true, fileId: true, name: true, contentType: true, applicationId: true, createdAt: true},
    });
    if (!upload || upload.applicationId !== null || upload.createdAt.getTime() < Date.now() - HOUR_MS) {
      return fieldError(c, 'resume', 'Upload your resume again.');
    }
    const done = await storage(() => completeUpload(c.req.url, upload.fileId));
    if (!done.ok) return c.json({...problem(done.code, done.message), fields: {resume: done.message}}, storageStatus(done.status));
    // The stored bytes must really be a PDF / DOCX; otherwise the file and its row go.
    if (!(await checkStoredResume(c.req.url, upload.fileId, upload.contentType))) {
      await db.resumeUpload.delete({where: {id: upload.id}, select: {id: true}});
      return fieldError(c, 'resume', 'That file is not a real PDF or DOCX. Upload your resume as a PDF or DOCX file.');
    }
    await db.resumeUpload.update({where: {id: upload.id}, data: {ready: true}, select: {id: true}});
    return c.json({ok: true, fileName: upload.name});
  })

  .post('/jobs/:slug/apply', applyBody, withViewer, withDb, async c => {
    const input = c.req.valid('json');
    if (input.honeypot) return accepted(c); // only bots fill the hidden field
    const db = c.var.db;
    const ipHash = await ipHashOf(c);
    if (!ipHash) return noIp(c);
    if (await overLimit(db, 'apply', ipHash, LIMITS.appliesPerIpHour)) return accepted(c); // silently dropped

    const slug = slugOf(c);
    // The job (it needs the settings) and the resume upload, in parallel.
    const [{settings, job}, upload] = await Promise.all([
      cachedBoardSettings(db).then(async settings => ({
        settings,
        job: slug
          ? await db.job.findFirst({
              where: {...publicJobWhere(settings), slug},
              select: {id: true, title: true, slug: true, applyMethod: true, company: {select: {name: true, ownerUserId: true}}},
            })
          : null,
      })),
      tokenHash(input.resumeToken).then(token =>
        db.resumeUpload.findUnique({
          where: {token},
          select: {id: true, fileId: true, name: true, ready: true, applicationId: true, createdAt: true},
        })
      ),
    ]);
    if (!job) return c.json(problem('not_found', 'This job is no longer taking applications.'), 404);
    if (job.applyMethod !== 'onsite') return c.json(problem('apply_elsewhere', 'This job takes applications on the company’s own site.'), 400);
    // The job's own employer cannot apply to it.
    if (c.var.viewer.state === 'user' && job.company.ownerUserId === c.var.viewer.id) {
      return c.json(problem('own_job', 'This is your company’s job: you cannot apply to it.'), 403);
    }
    if (!upload || !upload.ready || upload.applicationId !== null || upload.createdAt.getTime() < Date.now() - HOUR_MS) {
      return fieldError(c, 'resume', 'Upload your resume again.');
    }

    try {
      await db.$transaction(async tx => {
        const created = await tx.application.create({
          data: {
            jobId: job.id,
            name: input.name,
            email: input.email,
            phone: input.phone,
            profileUrl: input.profileUrl,
            coverNote: input.coverNote,
            resumeFileId: upload.fileId,
            resumeFileName: upload.name,
            consentAt: new Date(),
            consentText: DEFAULT_CONSENT_TEXT,
            ipHash,
          },
          select: {id: true},
        });
        await tx.job.update({where: {id: job.id}, data: {applicationCount: {increment: 1}}, select: {id: true}});
        const attached = await tx.resumeUpload.updateMany({where: {id: upload.id, applicationId: null}, data: {applicationId: created.id}});
        if (attached.count !== 1) throw new ResumeTaken();
        return created.id;
      });
    } catch (err) {
      if (err instanceof ResumeTaken) return fieldError(c, 'resume', 'Upload your resume again.');
      // Already applied with this address: the same answer as a new application, so nobody can
      // learn whether a named person applied here. Nothing is stored or sent a second time.
      if ((err as {code?: string}).code === 'P2002') return accepted(c);
      throw err;
    }

    await notifyNewApplication(c, db, {job, candidate: {name: input.name, email: input.email}, boardName: settings.name, singleCompany: isSingleCompany(settings)});
    return accepted(c);
  })

  /** Should the job page show the form to this visitor? Guests: yes. The job's employer and staff: a note. */
  .get('/jobs/:slug/can-apply', withViewer, withDb, async c => {
    const viewer = c.var.viewer;
    const slug = slugOf(c);
    // An expired access token: 401 makes `siteFetch` refresh once and ask again.
    if (viewer.state === 'returning') return c.json(problem('token_expired', 'Your session needs refreshing.'), 401);
    if (viewer.state !== 'user' || !slug) return c.json({canApply: true, reason: null});
    const job = await c.var.db.job.findFirst({where: {slug}, select: {company: {select: {ownerUserId: true}}}});
    if (job?.company.ownerUserId === viewer.id) return c.json({canApply: false, reason: 'own_job' as const});
    if (await can(c as unknown as Context<{Variables: {viewer: Viewer}}>, PERMISSIONS.APPLICANT_READ_ALL)) {
      return c.json({canApply: false, reason: 'staff' as const});
    }
    return c.json({canApply: true, reason: null});
  })

  /** F4: url / email apply opens the target in the browser; this counts the click (quietly capped). */
  .post('/jobs/:slug/click', withDb, async c => {
    const db = c.var.db;
    const slug = slugOf(c);
    const ipHash = await ipHashOf(c);
    if (!slug || !ipHash || (await overLimit(db, 'click', ipHash, CLICK_LIMIT))) return c.body(null, 204);
    const settings = await cachedBoardSettings(db);
    const job = await db.job.findFirst({
      where: {...publicJobWhere(settings), slug, applyMethod: {in: ['url', 'email']}},
      select: {id: true},
    });
    // Raw SQL so the counter leaves `updated_at` (the sitemap's lastmod) alone.
    if (job) await db.$executeRaw`UPDATE "jobs" SET "apply_click_count" = "apply_click_count" + 1 WHERE "id" = ${job.id}`;
    return c.body(null, 204);
  })

  .route('/', applicantRoutes);

class ResumeTaken extends Error {}
