import {config} from '../../platform/config';
import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {readJobValues} from '../../lib/job-input';
import {isDbId} from '../../lib/board';
import type {EmployerOptions} from '../../lib/types-employer';
import type {Viewer} from '../../lib/types';
import {audit} from '../../platform/auth';
import {after} from '../board/after';
import {clearPublicListsAfterWrite} from '../board/public-cache';
import {problem, requireAuth, requireVerified, withDb, withViewer} from '../../platform/guards';
import {
  BLOCKED,
  changedFields,
  companySelect,
  employerArea,
  ownCompany,
  profileColumns,
  readCompanyProfile,
  readNewCompany,
  toEmployerCompany,
} from '../board/employer';
import {createJob, jobData, setJobTags, validateJob} from '../board/employer-jobs';
import {dropLogoFile, finishLogoUpload, isLogoImage, LOGO_MAX_BYTES, LOGO_TYPES, logoAttemptAllowed, POSTS_PER_HOUR, startLogoUpload, userAttemptAllowed} from '../board/employer-logo';
import {activeTiers, chooseTier, startListing} from '../board/employer-orders';
import {employerJobRoutes} from '../board/employer-routes';
import {ipHashOf} from '../board/ip';
import {cachedBoardSettings} from '../board/brand';
import {getBoardSettings} from '../board/settings';
import {createWithUniqueSlug, isUniqueViolation} from '../board/slug';

/**
 * The employer area (workstream C, docs/MIGRATION.md): `/site-api/employer/*`. Any signed-in,
 * VERIFIED user; their company is found from the session (`companies.owner_user_id`), never from
 * the request. The whole area answers 404 in single-company mode (F39).
 *
 *   GET    /options                   categories, tiers, free posting, currency, own company
 *   GET    /company                   own company (null before the first post)
 *   PUT    /company                   website, location, about, socials (F17; name is fixed)
 *   POST   /company/logo              {name, contentType, size} → a PUBLIC upload URL + token
 *   POST   /company/logo/complete     {fileId, token}: checks the bytes, becomes the logo
 *   DELETE /company/logo
 *   POST   /post                      the wizard: {job, company?, tierId, jobId?, gateway?} (F10, F12)
 *   …      /jobs, /orders             src/server/board/employer-routes.ts
 */

type Env = {Variables: {viewer: Viewer; db: PrismaClient}};

const invalid = (fields: Record<string, string>) => ({...problem('invalid_input', Object.values(fields)[0] ?? 'Check the highlighted fields.'), fields});

const postBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const tierId = v.tierId === null || v.tierId === undefined || v.tierId === '' ? null : Number(v.tierId);
  const jobId = v.jobId === null || v.jobId === undefined ? null : Number(v.jobId);
  const gateway = typeof v.gateway === 'string' && v.gateway ? v.gateway : undefined;
  if ((tierId !== null && !isDbId(tierId)) || (jobId !== null && !isDbId(jobId)) || (gateway && !/^[a-z0-9_-]{1,40}$/.test(gateway))) {
    return c.json(problem('invalid_input', 'That request could not be read.'), 400);
  }
  return {job: readJobValues(v.job), company: v.company, tierId, jobId, gateway};
});

const logoBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const name = typeof v.name === 'string' ? v.name.trim().slice(0, 200) : '';
  const contentType = typeof v.contentType === 'string' ? v.contentType : '';
  const size = typeof v.size === 'number' ? v.size : 0;
  if (!name || !(LOGO_TYPES as readonly string[]).includes(contentType) || size < 1 || size > LOGO_MAX_BYTES) {
    return c.json(invalid({logo: 'Use a PNG, JPG or WebP image up to 1 MB.'}), 422);
  }
  return {name, contentType, size};
});

/** The local fallback (no file storage): a small downscaled image as base64, under the 64 KB body limit. */
const LOCAL_LOGO_MAX_BYTES = 48 * 1024;
const logoLocal = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const contentType = typeof v.contentType === 'string' ? v.contentType : '';
  const data = typeof v.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(v.data) && v.data.length % 4 === 0 && v.data.length <= 66_000 ? v.data : '';
  if (!(LOGO_TYPES as readonly string[]).includes(contentType) || !data) {
    return c.json(invalid({logo: 'Use a PNG, JPG or WebP image.'}), 422);
  }
  return {contentType, data};
});

const logoDone = validator('json', value => {
  const v = (value ?? {}) as Record<string, unknown>;
  return {fileId: typeof v.fileId === 'string' ? v.fileId : '', token: typeof v.token === 'string' ? v.token.slice(0, 128) : ''};
});

export const employerRoutes = new Hono<Env>()
  .use(withViewer, requireAuth, requireVerified, withDb, employerArea, clearPublicListsAfterWrite)

  .get('/options', async c => {
    const db = c.var.db;
    const settings = await cachedBoardSettings(db);
    const [categories, tiers, company] = await Promise.all([
      db.category.findMany({where: {isActive: true}, orderBy: [{sortOrder: 'asc'}, {name: 'asc'}], take: 100, select: {id: true, name: true}}),
      activeTiers(db, settings),
      ownCompany(db, c.var.viewer.id!),
    ]);
    const options: EmployerOptions = {
      categories,
      tiers,
      freePosting: settings.freePostingEnabled,
      currency: settings.currency,
      company: company ? toEmployerCompany(company) : null,
    };
    return c.json(options);
  })

  .get('/company', async c => {
    const company = await ownCompany(c.var.db, c.var.viewer.id!);
    // With file storage (a Site Key) the logo goes there; without one, to `/company/logo/local`.
    return c.json({company: company ? toEmployerCompany(company) : null, logoUploads: Boolean(config.siteKey)});
  })

  .put('/company', validator('json', value => (value ?? {}) as Record<string, unknown>), async c => {
    const read = readCompanyProfile(c.req.valid('json'));
    if ('fields' in read) return c.json(invalid(read.fields), 422);
    const db = c.var.db;
    const row = await ownCompany(db, c.var.viewer.id!);
    if (!row) return c.json(problem('no_company', 'Post your first job to create your company profile.'), 404);
    if (row.isBlocked) return c.json(BLOCKED, 403);
    const next = profileColumns(read.value);
    const changed = changedFields(row, next);
    if (!changed.length) return c.json({company: toEmployerCompany(row)});
    const updated = await db.company.update({where: {id: row.id}, data: next, select: companySelect});
    await audit(db, {actorUserId: c.var.viewer.id, action: 'company.update', target: ['company', row.id], ipHash: await ipHashOf(c), meta: {fields: changed}});
    return c.json({company: toEmployerCompany(updated)});
  })

  .post('/company/logo', logoBody, async c => {
    const row = await ownCompany(c.var.db, c.var.viewer.id!);
    if (!row) return c.json(problem('no_company', 'Post your first job to create your company profile.'), 404);
    if (row.isBlocked) return c.json(BLOCKED, 403);
    if (!(await logoAttemptAllowed(c.var.db, c.var.viewer.id!))) {
      return c.json(problem('rate_limited', 'Too many logo uploads. Try again in an hour.'), 429);
    }
    const started = await startLogoUpload(c.req.url, row.id, c.req.valid('json'));
    if (!started.ok) return c.json(problem(started.code, started.message), started.status);
    return c.json({fileId: started.fileId, token: started.token, upload: started.upload}, 201);
  })

  // No Site Key (local, demo): the logo is kept in the Site Database instead of file storage.
  .post('/company/logo/local', logoLocal, async c => {
    if (config.siteKey) return c.json(problem('use_storage', 'Upload the logo to file storage.'), 409);
    const db = c.var.db;
    const row = await ownCompany(db, c.var.viewer.id!);
    if (!row) return c.json(problem('no_company', 'Post your first job to create your company profile.'), 404);
    if (row.isBlocked) return c.json(BLOCKED, 403);
    if (!(await logoAttemptAllowed(db, c.var.viewer.id!))) {
      return c.json(problem('rate_limited', 'Too many logo uploads. Try again in an hour.'), 429);
    }
    const {contentType, data} = c.req.valid('json');
    const bytes = Uint8Array.from(atob(data), ch => ch.charCodeAt(0));
    if (bytes.length > LOCAL_LOGO_MAX_BYTES || !isLogoImage(bytes)) {
      return c.json(invalid({logo: 'Use a PNG, JPG or WebP image.'}), 422);
    }
    await db.companyLogo.upsert({
      where: {companyId: row.id},
      create: {companyId: row.id, contentType, data: bytes},
      update: {contentType, data: bytes},
      select: {companyId: true},
    });
    const updated = await db.company.update({
      where: {id: row.id},
      data: {logoFileId: null, logoUrl: `/site-api/companies/${row.slug}/logo?v=${Date.now()}`},
      select: companySelect,
    });
    await audit(db, {actorUserId: c.var.viewer.id, action: 'company.update', target: ['company', row.id], ipHash: await ipHashOf(c), meta: {fields: ['logo']}});
    if (row.logoFileId) await dropLogoFile(c.req.url, row.logoFileId);
    return c.json({company: toEmployerCompany(updated)});
  })

  .post('/company/logo/complete', logoDone, async c => {
    const db = c.var.db;
    const row = await ownCompany(db, c.var.viewer.id!);
    if (!row) return c.json(problem('no_company', 'Post your first job to create your company profile.'), 404);
    if (row.isBlocked) return c.json(BLOCKED, 403);
    const {fileId, token} = c.req.valid('json');
    const done = await finishLogoUpload(c.req.url, row.id, fileId, token);
    if (!done.ok) return c.json(problem(done.code, done.message), done.status);
    const updated = await db.company.update({where: {id: row.id}, data: {logoFileId: done.fileId, logoUrl: done.url}, select: companySelect});
    await audit(db, {actorUserId: c.var.viewer.id, action: 'company.update', target: ['company', row.id], ipHash: await ipHashOf(c), meta: {fields: ['logo']}});
    if (row.logoFileId && row.logoFileId !== done.fileId) await dropLogoFile(c.req.url, row.logoFileId);
    return c.json({company: toEmployerCompany(updated)});
  })

  .delete('/company/logo', async c => {
    const db = c.var.db;
    const row = await ownCompany(db, c.var.viewer.id!);
    if (!row) return c.json(problem('no_company', 'Post your first job to create your company profile.'), 404);
    if (!row.logoUrl && !row.logoFileId) return c.json({company: toEmployerCompany(row)});
    const updated = await db.company.update({where: {id: row.id}, data: {logoFileId: null, logoUrl: null}, select: companySelect});
    await audit(db, {actorUserId: c.var.viewer.id, action: 'company.update', target: ['company', row.id], ipHash: await ipHashOf(c), meta: {fields: ['logo']}});
    await db.companyLogo.deleteMany({where: {companyId: row.id}});
    await dropLogoFile(c.req.url, row.logoFileId);
    return c.json({company: toEmployerCompany(updated)});
  })

  // The wizard's last step. Price, days and featured come from the tier, on the server.
  .post('/post', postBody, async c => {
    const db = c.var.db;
    const viewer = c.var.viewer;
    if (!(await userAttemptAllowed(db, 'post', viewer.id!, POSTS_PER_HOUR))) {
      return c.json(problem('rate_limited', 'Too many jobs posted or renewed in the last hour. Try again later.'), 429);
    }
    const input = c.req.valid('json');
    // From the database, never the Site Cache: it decides free vs paid (and the currency charged).
    const [checked, existing, {settings, chosen}] = await Promise.all([
      validateJob(db, input.job),
      ownCompany(db, viewer.id!),
      getBoardSettings(db).then(async settings => ({settings, chosen: await chooseTier(db, settings, input.tierId)})),
    ]);
    const fields: Record<string, string> = 'fields' in checked ? {...checked.fields} : {};
    const newCompany = existing ? null : readNewCompany(input.company);
    if (newCompany && 'fields' in newCompany) Object.assign(fields, newCompany.fields);
    if ('field' in chosen) fields.tierId = chosen.field;
    if (Object.keys(fields).length) return c.json(invalid(fields), 422);
    if ('unavailable' in chosen) return c.json(problem(chosen.status === 409 ? 'tier_not_priced' : 'posting_unavailable', chosen.unavailable), chosen.status);
    if (existing?.isBlocked) return c.json(BLOCKED, 403);
    if ('fields' in checked || !('tier' in chosen)) return c.json(invalid(fields), 422);

    let company = existing ? {id: existing.id, name: existing.name} : null;
    if (!company && newCompany && 'value' in newCompany) {
      const {name, ...profile} = newCompany.value;
      try {
        company = await createWithUniqueSlug(
          name,
          async slug => (await db.company.findUnique({where: {slug}, select: {id: true}})) !== null,
          slug => db.company.create({data: {name, slug, ownerUserId: viewer.id!, source: 'employer', ...profileColumns(profile)}, select: {id: true, name: true}})
        );
        // Created, THEN checked: a job seeker profile started at the same moment (another tab) is
        // seen here or sees this company (applicant-profile.ts), so the account never ends up both.
        if (await db.applicantProfile.findUnique({where: {userId: viewer.id!}, select: {userId: true}})) {
          await db.company.deleteMany({where: {id: company.id, ownerUserId: viewer.id!}});
          return c.json(problem('applicant_account', 'This is a job seeker account. Sign up with another email to post jobs.'), 403);
        }
        await audit(db, {actorUserId: viewer.id, action: 'company.create', target: ['company', company.id], ipHash: await ipHashOf(c)});
      } catch (err) {
        // A second tab created it a moment ago: use that one.
        if (!isUniqueViolation(err)) throw err;
        const raced = await ownCompany(db, viewer.id!);
        if (!raced) throw err;
        company = {id: raced.id, name: raced.name};
      }
    }
    if (!company) return c.json(problem('no_company', 'Add your company details.'), 422);

    const data = {...jobData(checked.columns, checked.html, settings.currency), durationDays: chosen.tier.durationDays, listingFeatured: chosen.tier.includesFeatured, tierId: chosen.tier.tierId};
    // Coming back after a closed checkout: the same unpaid job, not a second one.
    const reuse = input.jobId
      ? await db.job.findFirst({where: {id: input.jobId, companyId: company.id, status: {in: ['draft', 'pending_payment']}}, select: {id: true}})
      : null;
    // Its job was paid for since (a slow payment event, another tab): never a second job and a
    // second checkout for the same post. A job closed while still unpaid has no paid order: posted anew.
    if (input.jobId && !reuse) {
      const paid = await db.listingOrder.findFirst({
        where: {jobId: input.jobId, companyId: company.id, kind: 'new', status: {in: ['paid', 'refunded']}},
        select: {id: true},
      });
      if (paid) return c.json({...problem('already_paid', 'This job was paid for a moment ago. Open your jobs to see it.'), jobId: input.jobId}, 409);
    }
    if (reuse) {
      // Reset only while it is STILL unpaid, in one conditional statement: a payment that settled
      // since the read above (another tab, a late event) keeps its live job.
      const {count} = await db.job.updateMany({where: {id: reuse.id, companyId: company.id, status: {in: ['draft', 'pending_payment']}}, data: {...data, status: 'pending_payment'}});
      if (!count) return c.json({...problem('already_paid', 'This job was paid for a moment ago. Open your jobs to see it.'), jobId: reuse.id}, 409);
      // Its earlier checkouts are superseded by this one: their orders become `failed` (the
      // allowed status for "will not be fulfilled"), so a late payment of one can never move the
      // job; the payment hook flags such a payment for a refund.
      await db.listingOrder.updateMany({where: {jobId: reuse.id, status: 'pending'}, data: {status: 'failed'}});
    }
    const jobId = reuse
      ? reuse.id
      : (await createJob(db, {companyId: company.id, companyName: company.name, userId: viewer.id!, data, status: 'pending_payment'})).id;
    await setJobTags(db, jobId, checked.columns.tags, {newJob: !reuse});

    const answer = await startListing(db, c.req.url, {
      companyId: company.id,
      viewer,
      jobId,
      kind: 'new',
      tier: chosen.tier,
      gateway: input.gateway,
      cancelPath: '/dashboard/post-a-job',
      defer: work => after(c, `listing emails for job ${jobId}`, work),
    });
    if ('problem' in answer) return c.json({...problem(answer.problem.code, answer.problem.message), jobId}, answer.problem.status);
    return c.json(answer, answer.status === 'done' ? 201 : 200);
  })

  .route('/', employerJobRoutes);
