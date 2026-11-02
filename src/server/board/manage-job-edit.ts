import {Hono} from 'hono';
import {validator} from 'hono/validator';

import {LIMITS, type JobSource} from '../../lib/board';
import {jobValuesOf, readJobValues} from '../../lib/job-input';
import {type AdminCompanies, type AdminJobDetail, type AdminJobFormOptions, EMPLOYER_JOB_NOTE} from '../../lib/types-manage';
import {audit} from '../../platform/auth';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';
import {jobData, setJobTags, validateJob} from './employer-jobs';
import {actionsFor, actorOf, asObject, DAY_MS, effectiveStatus, idParam, invalid, isEmployerJob, notFound, refreshActiveJobCount, str} from './manage-shared';
import {getBoardSettings, isSingleCompany} from './settings';
import {createWithUniqueSlug} from './slug';

/**
 * F21 admin job create and edit, with the employer's form rules (src/lib/job-input.ts, shared with
 * C's JobForm). Admin jobs are free and live at once (`source: admin`). Only admin and import jobs
 * can be edited here: an employer's job (`paid`, `credit`, `free`) answers 403 `employer_job_locked`.
 * In single-company mode (F39) every admin job goes to the owner company, whatever was sent.
 */
const COMPANIES = 50;

const guard = [withViewer, requireAuth, requirePermission(PERMISSIONS.JOB_MANAGE), withDb] as const;

const createBody = validator('json', (value, c) => {
  const v = asObject(value);
  const days = v.durationDays === undefined ? 30 : v.durationDays;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > LIMITS.tierDaysMax) {
    return invalid(c, {durationDays: `Pick a whole number of days from 1 to ${LIMITS.tierDaysMax}.`});
  }
  const companyId = typeof v.companyId === 'number' && Number.isInteger(v.companyId) && v.companyId > 0 ? v.companyId : null;
  const newCompanyName = str(v.newCompanyName);
  if (newCompanyName.length > LIMITS.companyName) return invalid(c, {newCompanyName: `Use at most ${LIMITS.companyName} characters.`});
  return {values: readJobValues(v.values), companyId, newCompanyName, durationDays: days as number};
});

const editBody = validator('json', value => ({values: readJobValues(asObject(value).values)}));

const detailSelect = {
  id: true,
  slug: true,
  title: true,
  status: true,
  source: true,
  companyId: true,
  categoryId: true,
  employmentType: true,
  workplaceType: true,
  locationCity: true,
  locationRegion: true,
  locationCountry: true,
  applicantCountries: true,
  salaryMinCents: true,
  salaryMaxCents: true,
  salaryPeriod: true,
  descriptionMd: true,
  applyMethod: true,
  applyTarget: true,
  isFeatured: true,
  featuredUntil: true,
  expiresAt: true,
  company: {select: {id: true, name: true}},
  tags: {select: {tag: {select: {name: true}}}, take: LIMITS.tags},
} as const;

export const manageJobEditRoutes = new Hono()
  // Companies to post for: a name search (first 50); single-company mode: the owner company only.
  .get('/companies', validator('query', v => ({q: typeof v.q === 'string' ? v.q.trim().slice(0, 80) : ''})), ...guard, async c => {
    const db = c.var.db;
    const settings = await getBoardSettings(db);
    if (isSingleCompany(settings)) {
      const owner = await db.company.findUnique({where: {id: settings.ownerCompanyId!}, select: {id: true, name: true}});
      const body: AdminCompanies = {companies: owner ? [owner] : [], locked: owner};
      return c.json(body);
    }
    const {q} = c.req.valid('query');
    const companies = await db.company.findMany({
      where: {isBlocked: false, ...(q ? {name: {contains: q, mode: 'insensitive'}} : {})},
      orderBy: [{name: 'asc'}, {id: 'asc'}],
      select: {id: true, name: true},
      take: COMPANIES,
    });
    const body: AdminCompanies = {companies, locked: null};
    return c.json(body);
  })

  // What the job form needs: active categories (with ids) and the board's currency.
  .get('/form-options', ...guard, async c => {
    const db = c.var.db;
    const [categories, settings] = await Promise.all([
      db.category.findMany({where: {isActive: true}, orderBy: [{sortOrder: 'asc'}, {id: 'asc'}], select: {id: true, name: true}, take: 100}),
      getBoardSettings(db),
    ]);
    const body: AdminJobFormOptions = {categories, currency: settings.currency};
    return c.json(body);
  })

  .get('/:id', ...guard, async c => {
    const id = idParam(c.req.param('id'));
    if (!id) return notFound(c);
    const job = await c.var.db.job.findUnique({where: {id}, select: detailSelect});
    if (!job) return notFound(c);
    const now = new Date();
    const status = effectiveStatus(job, now);
    const featured = job.isFeatured && (job.featuredUntil === null || job.featuredUntil > now);
    const body: AdminJobDetail = {
      id: job.id,
      slug: job.slug,
      title: job.title,
      status,
      source: job.source as JobSource,
      company: job.company,
      featuredUntil: status === 'published' && featured ? (job.featuredUntil?.toISOString() ?? null) : null,
      expiresAt: job.expiresAt?.toISOString() ?? null,
      actions: actionsFor(status, job.source),
      values: jobValuesOf({...job, tags: job.tags.map(t => t.tag.name)}),
    };
    return c.json(body);
  })

  .post('/', createBody, ...guard, async c => {
    const db = c.var.db;
    const input = c.req.valid('json');
    const settings = await getBoardSettings(db);
    const checked = await validateJob(db, input.values);
    if ('fields' in checked) return invalid(c, checked.fields);

    let company: {id: number; name: string} | null = null;
    if (isSingleCompany(settings)) {
      company = await db.company.findUnique({where: {id: settings.ownerCompanyId!}, select: {id: true, name: true}});
    } else if (input.companyId) {
      company = await db.company.findFirst({where: {id: input.companyId, isBlocked: false}, select: {id: true, name: true}});
      if (!company) return invalid(c, {companyId: 'Choose a company.'});
    } else if (input.newCompanyName) {
      const name = input.newCompanyName;
      company = await createWithUniqueSlug(
        name,
        async slug => (await db.company.findUnique({where: {slug}, select: {id: true}})) !== null,
        slug => db.company.create({data: {name, slug, source: 'admin'}, select: {id: true, name: true}})
      );
      await audit(db, {...(await actorOf(c)), action: 'company_created', target: ['company', company.id]});
    }
    if (!company) return invalid(c, {companyId: 'Choose a company, or name a new one.'});

    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.durationDays * DAY_MS);
    const data = jobData(checked.columns, checked.html, settings.currency);
    const owner = company;
    const job = await createWithUniqueSlug(
      `${data.title} ${owner.name}`,
      async slug => (await db.job.findUnique({where: {slug}, select: {id: true}})) !== null,
      slug =>
        db.job.create({
          data: {
            ...data,
            slug,
            companyId: owner.id,
            source: 'admin',
            status: 'published',
            publishedAt: now,
            expiresAt,
            durationDays: input.durationDays,
            createdBy: c.var.viewer.id,
          },
          select: {id: true, slug: true},
        })
    );
    await setJobTags(db, job.id, checked.columns.tags);
    await audit(db, {...(await actorOf(c)), action: 'job_created', target: ['job', job.id], meta: {companyId: owner.id}});
    await refreshActiveJobCount(db, owner.id, now);
    return c.json({id: job.id, slug: job.slug}, 201);
  })

  .put('/:id', editBody, ...guard, async c => {
    const id = idParam(c.req.param('id'));
    if (!id) return notFound(c);
    const db = c.var.db;
    const job = await db.job.findUnique({where: {id}, select: {id: true, slug: true, source: true}});
    if (!job) return notFound(c);
    if (isEmployerJob(job.source)) return c.json(problem('employer_job_locked', EMPLOYER_JOB_NOTE), 403);
    const checked = await validateJob(db, c.req.valid('json').values);
    if ('fields' in checked) return invalid(c, checked.fields);
    const settings = await getBoardSettings(db);
    // Admin edits apply as they are (no re-review); the slug never changes.
    await db.job.update({where: {id}, data: jobData(checked.columns, checked.html, settings.currency), select: {id: true}});
    await setJobTags(db, id, checked.columns.tags);
    await audit(db, {...(await actorOf(c)), action: 'job_edited', target: ['job', id]});
    return c.json({id, slug: job.slug});
  });
