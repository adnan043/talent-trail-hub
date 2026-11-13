import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {BOARD_MODES, type BoardMode, FONT_PRESETS, LIMITS, MODERATION_MODES, type ModerationMode} from '../../lib/board';
import type {AdminBoardMode, AdminBranding, AdminModerationMode, FooterLink} from '../../lib/types-manage';
import {HEX_COLOR, isFooterHref, MANAGE_LIMITS} from '../../lib/types-manage';
import {audit} from '../../platform/auth';
import {config} from '../../platform/config';
import type {UploadGrant} from '../../platform/files-browser';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';
import {actorOf, asObject, invalid, str} from './manage-shared';
import {dropLogoFile, finishLogoUpload, isLogoImage, logoAttemptAllowed, startLogoUpload} from './employer-logo';
import {getBoardSettings} from './settings';
import {createWithUniqueSlug} from './slug';
import {forgetBoardSettings} from './brand';

/**
 * Board settings: branding (F30, with the logo as a PUBLIC platform file), board mode (F39) and
 * moderation mode (F31). Each save writes the one `board_settings` row and an audit event. Board
 * mode only writes the settings: jobs and companies are never touched, so switching back
 * restores the board exactly.
 */
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const COMPANY_OPTIONS = 100;

/** The local fallback (no file storage): a small downscaled image as base64, under the 64 KB body limit. */
const LOCAL_LOGO_MAX_BYTES = 48 * 1024;
const logoLocal = validator('json', (value, c) => {
  const v = asObject(value);
  const contentType = str(v.contentType);
  const data = typeof v.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(v.data) && v.data.length <= 66_000 ? v.data : '';
  if (!LOGO_TYPES.includes(contentType) || !data) return invalid(c, {logo: 'Use a PNG, JPG or WebP image.'});
  return {contentType, data};
});

/**
 * Saves, then clears the Site Cache's copy (`board:settings` and the public reads built from it,
 * brand.ts) for every Worker instance: the next public read shows the change.
 */
const saveSettings = async (db: PrismaClient, data: Record<string, unknown>) => {
  const saved = await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, ...data}, update: data, select: {id: true}});
  await forgetBoardSettings();
  return saved;
};

async function branding(db: PrismaClient): Promise<AdminBranding> {
  const s = await getBoardSettings(db);
  return {
    name: s.name,
    logoUrl: s.logoUrl,
    faviconUrl: s.faviconUrl,
    primaryColor: s.primaryColor,
    sidebarBg: s.sidebarBg ?? '',
    sidebarText: s.sidebarText ?? '',
    fontPreset: s.fontPreset,
    heroTitle: s.heroTitle,
    heroSubtitle: s.heroSubtitle,
    footerLinks: s.footerLinks,
  };
}

const brandingBody = validator('json', (value, c) => {
  const v = asObject(value);
  const fields: Record<string, string> = {};
  const text = (key: string, max: number, required: string | null) => {
    const s = str(v[key]);
    if (!s && required) fields[key] = required;
    else if (s.length > max) fields[key] = `Use at most ${max} characters.`;
    return s;
  };
  const name = text('name', MANAGE_LIMITS.boardName, 'Give the board a name.');
  const heroTitle = text('heroTitle', MANAGE_LIMITS.heroTitle, 'Write the home page title.');
  const heroSubtitle = text('heroSubtitle', MANAGE_LIMITS.heroSubtitle, null);
  const primaryColor = str(v.primaryColor).toLowerCase();
  if (!HEX_COLOR.test(primaryColor)) fields.primaryColor = 'Use a colour like #a63d23.';
  const optionalColour = (key: 'sidebarBg' | 'sidebarText') => {
    const value = str(v[key]).toLowerCase();
    if (value && !HEX_COLOR.test(value)) fields[key] = 'Use a colour like #1f1a16, or leave it empty for the default.';
    return value || null;
  };
  const sidebarBg = optionalColour('sidebarBg');
  const sidebarText = optionalColour('sidebarText');
  const fontPreset = str(v.fontPreset);
  if (!(FONT_PRESETS as readonly string[]).includes(fontPreset)) fields.fontPreset = 'Pick one of the fonts.';
  const rawLinks = Array.isArray(v.footerLinks) ? v.footerLinks : [];
  const footerLinks: FooterLink[] = [];
  if (rawLinks.length > MANAGE_LIMITS.footerLinks) fields.footerLinks = `Up to ${MANAGE_LIMITS.footerLinks} footer links.`;
  rawLinks.slice(0, MANAGE_LIMITS.footerLinks).forEach((raw, i) => {
    const link = asObject(raw);
    const label = str(link.label);
    const href = str(link.href);
    if (!label || label.length > MANAGE_LIMITS.footerLabel) fields[`footerLinks.${i}.label`] = `A label needs 1 to ${MANAGE_LIMITS.footerLabel} characters.`;
    if (!href || href.length > MANAGE_LIMITS.footerHref || !isFooterHref(href)) {
      fields[`footerLinks.${i}.href`] = 'Use a path on this site (/about/) or an https:// link.';
    }
    footerLinks.push({label, href});
  });
  if (Object.keys(fields).length) return invalid(c, fields);
  return {name, heroTitle, heroSubtitle, primaryColor, sidebarBg, sidebarText, fontPreset, footerLinks};
});

const logoBody = validator('json', (value, c) => {
  const v = asObject(value);
  const name = str(v.name).slice(0, 200);
  const contentType = str(v.contentType);
  const size = typeof v.size === 'number' ? v.size : 0;
  if (!name || !LOGO_TYPES.includes(contentType) || size < 1 || size > LIMITS.logoMb * 1024 * 1024) {
    return invalid(c, {logo: `Pick a PNG, JPG or WebP image up to ${LIMITS.logoMb} MB.`});
  }
  return {name, contentType, size};
});

const boardBody = validator('json', (value, c) => {
  const v = asObject(value);
  const mode = str(v.mode);
  if (!(BOARD_MODES as readonly string[]).includes(mode)) return invalid(c, {mode: 'Pick a board mode.'});
  const ownerCompanyId = typeof v.ownerCompanyId === 'number' && Number.isInteger(v.ownerCompanyId) && v.ownerCompanyId > 0 ? v.ownerCompanyId : null;
  const newCompanyName = ownerCompanyId ? '' : str(v.newCompanyName);
  if (newCompanyName.length > LIMITS.companyName) return invalid(c, {newCompanyName: `Use at most ${LIMITS.companyName} characters.`});
  return {mode: mode as BoardMode, ownerCompanyId, newCompanyName};
});

const moderationBody = validator('json', (value, c) => {
  const mode = str(asObject(value).mode);
  if (!(MODERATION_MODES as readonly string[]).includes(mode)) return invalid(c, {mode: 'Pick a moderation mode.'});
  return {mode: mode as ModerationMode};
});

async function boardMode(db: PrismaClient): Promise<AdminBoardMode> {
  const s = await getBoardSettings(db);
  const [owner, companies] = await Promise.all([
    s.ownerCompanyId ? db.company.findUnique({where: {id: s.ownerCompanyId}, select: {id: true, name: true}}) : null,
    db.company.findMany({where: {isBlocked: false}, orderBy: [{name: 'asc'}, {id: 'asc'}], select: {id: true, name: true}, take: COMPANY_OPTIONS}),
  ]);
  return {mode: s.boardMode, currency: s.currency, ownerCompany: owner, companies};
}

const guard = [withViewer, requireAuth, requirePermission(PERMISSIONS.BOARD_SETTINGS), withDb] as const;

export const manageSettingsRoutes = new Hono()
  .get('/branding', ...guard, async c => c.json(await branding(c.var.db)))
  .put('/branding', brandingBody, ...guard, async c => {
    const input = c.req.valid('json');
    await saveSettings(c.var.db, input);
    await audit(c.var.db, {...(await actorOf(c)), action: 'branding_changed', target: ['board', 1], meta: {fontPreset: input.fontPreset, primaryColor: input.primaryColor}});
    return c.json(await branding(c.var.db));
  })

  // The logo: 1. ask for a PUBLIC upload, 2. the browser PUTs it, 3. confirm, check its first
  // bytes and use it. The company-logo checks (employer-logo.ts), with the upload bound by a keyed
  // token to the admin who started it (`-userId` never collides with a company id), so no other
  // file of the site can be claimed as the logo (and later deleted with it).
  .post('/branding/logo', logoBody, ...guard, async c => {
    const userId = c.var.viewer.id!;
    if (!(await logoAttemptAllowed(c.var.db, userId))) {
      return c.json(problem('too_many_uploads', 'Too many uploads in the last hour. Try again later.'), 429);
    }
    const started = await startLogoUpload(c.req.url, -userId, c.req.valid('json'));
    if (!started.ok) return c.json(problem(started.code, started.message), started.status);
    return c.json({fileId: started.fileId, token: started.token, upload: started.upload as UploadGrant['upload']}, 201);
  })
  .post('/branding/logo/:fileId/complete', validator('json', v => ({token: str(asObject(v).token).slice(0, 128)})), ...guard, async c => {
    const finished = await finishLogoUpload(c.req.url, -c.var.viewer.id!, c.req.param('fileId'), c.req.valid('json').token);
    if (!finished.ok) return c.json(problem(finished.code, finished.message), finished.status);
    const db = c.var.db;
    const before = await db.boardSettings.findUnique({where: {id: 1}, select: {logoFileId: true}});
    await saveSettings(db, {logoFileId: finished.fileId, logoUrl: finished.url});
    await audit(db, {...(await actorOf(c)), action: 'logo_changed', target: ['board', 1]});
    if (before?.logoFileId && before.logoFileId !== finished.fileId) await dropLogoFile(c.req.url, before.logoFileId);
    return c.json({logoUrl: finished.url});
  })
  // No Site Key (local, demo): the logo is kept in the Site Database instead of file storage.
  .post('/branding/logo/local', logoLocal, ...guard, async c => {
    if (config.siteKey) return c.json(problem('use_storage', 'Upload the logo to file storage.'), 409);
    const db = c.var.db;
    const userId = c.var.viewer.id!;
    if (!(await logoAttemptAllowed(db, userId))) {
      return c.json(problem('too_many_uploads', 'Too many uploads in the last hour. Try again later.'), 429);
    }
    const {contentType, data} = c.req.valid('json');
    const bytes = Uint8Array.from(atob(data), ch => ch.charCodeAt(0));
    if (bytes.length > LOCAL_LOGO_MAX_BYTES || !isLogoImage(bytes)) return invalid(c, {logo: 'Use a PNG, JPG or WebP image.'});
    const before = await db.boardSettings.findUnique({where: {id: 1}, select: {logoFileId: true}});
    await db.boardLogo.upsert({where: {id: 1}, create: {id: 1, contentType, data: bytes}, update: {contentType, data: bytes}, select: {id: true}});
    const logoUrl = `/site-api/board/logo?v=${Date.now()}`;
    await saveSettings(db, {logoFileId: null, logoUrl});
    await audit(db, {...(await actorOf(c)), action: 'logo_changed', target: ['board', 1]});
    await dropLogoFile(c.req.url, before?.logoFileId ?? null);
    return c.json({logoUrl});
  })
  .delete('/branding/logo', ...guard, async c => {
    const db = c.var.db;
    const before = await db.boardSettings.findUnique({where: {id: 1}, select: {logoFileId: true}});
    await saveSettings(db, {logoFileId: null, logoUrl: null});
    await db.boardLogo.deleteMany({where: {id: 1}});
    await audit(db, {...(await actorOf(c)), action: 'logo_removed', target: ['board', 1]});
    await dropLogoFile(c.req.url, before?.logoFileId ?? null);
    return c.json({logoUrl: null});
  })

  // The favicon: the same public-upload flow as the logo, kept in its own columns. Needs file storage.
  .post('/branding/favicon', logoBody, ...guard, async c => {
    const userId = c.var.viewer.id!;
    if (!(await logoAttemptAllowed(c.var.db, userId))) {
      return c.json(problem('too_many_uploads', 'Too many uploads in the last hour. Try again later.'), 429);
    }
    const started = await startLogoUpload(c.req.url, -userId, c.req.valid('json'));
    if (!started.ok) return c.json(problem(started.code, started.message), started.status);
    return c.json({fileId: started.fileId, token: started.token, upload: started.upload as UploadGrant['upload']}, 201);
  })
  .post('/branding/favicon/:fileId/complete', validator('json', v => ({token: str(asObject(v).token).slice(0, 128)})), ...guard, async c => {
    const finished = await finishLogoUpload(c.req.url, -c.var.viewer.id!, c.req.param('fileId'), c.req.valid('json').token);
    if (!finished.ok) return c.json(problem(finished.code, finished.message), finished.status);
    const db = c.var.db;
    const before = await db.boardSettings.findUnique({where: {id: 1}, select: {faviconFileId: true}});
    await saveSettings(db, {faviconFileId: finished.fileId, faviconUrl: finished.url});
    await audit(db, {...(await actorOf(c)), action: 'favicon_changed', target: ['board', 1]});
    if (before?.faviconFileId && before.faviconFileId !== finished.fileId) await dropLogoFile(c.req.url, before.faviconFileId);
    return c.json({faviconUrl: finished.url});
  })
  .delete('/branding/favicon', ...guard, async c => {
    const db = c.var.db;
    const before = await db.boardSettings.findUnique({where: {id: 1}, select: {faviconFileId: true}});
    await saveSettings(db, {faviconFileId: null, faviconUrl: null});
    await audit(db, {...(await actorOf(c)), action: 'favicon_removed', target: ['board', 1]});
    await dropLogoFile(c.req.url, before?.faviconFileId ?? null);
    return c.json({faviconUrl: null});
  })

  .get('/board', ...guard, async c => c.json(await boardMode(c.var.db)))
  .put('/board', boardBody, ...guard, async c => {
    const {mode, ownerCompanyId, newCompanyName} = c.req.valid('json');
    const db = c.var.db;
    const before = await getBoardSettings(db);
    let owner = before.ownerCompanyId;
    if (ownerCompanyId !== null) {
      const company = await db.company.findUnique({where: {id: ownerCompanyId}, select: {id: true, isBlocked: true}});
      if (!company) return invalid(c, {ownerCompanyId: 'Choose a company.'});
      if (company.isBlocked) return invalid(c, {ownerCompanyId: 'This company is blocked. Choose another one.'});
      owner = company.id;
    }
    if (ownerCompanyId === null && newCompanyName && mode === 'single_company') {
      // A new admin company to own the board (F39).
      const created = await createWithUniqueSlug(
        newCompanyName,
        async slug => (await db.company.findUnique({where: {slug}, select: {id: true}})) !== null,
        slug => db.company.create({data: {name: newCompanyName, slug, source: 'admin'}, select: {id: true}})
      );
      await audit(db, {...(await actorOf(c)), action: 'company_created', target: ['company', created.id]});
      owner = created.id;
    }
    if (mode === 'single_company' && owner === null) {
      return invalid(c, {ownerCompanyId: 'Choose the company this board belongs to.'});
    }
    // Back to marketplace keeps the stored owner, so switching again pre-selects it.
    await saveSettings(db, {boardMode: mode, ownerCompanyId: owner});
    await audit(db, {
      ...(await actorOf(c)),
      action: 'board_mode_changed',
      target: ['board', 1],
      meta: {from: before.boardMode, to: mode, ownerCompanyId: owner},
    });
    return c.json(await boardMode(db));
  })

  .put('/currency', validator('json', (value, c) => {
    const currency = str(asObject(value).currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return invalid(c, {currency: 'Use a 3-letter currency code, like USD or EUR.'});
    return {currency};
  }), ...guard, async c => {
    const {currency} = c.req.valid('json');
    const db = c.var.db;
    const before = (await getBoardSettings(db)).currency;
    if (before !== currency) {
      // New salaries are entered in it; existing jobs keep the currency they were saved with.
      await saveSettings(db, {currency});
      await audit(db, {...(await actorOf(c)), action: 'currency_changed', target: ['board', 1], meta: {from: before, to: currency}});
    }
    return c.json({currency});
  })

  .get('/moderation', ...guard, async c => {
    const body: AdminModerationMode = {mode: (await getBoardSettings(c.var.db)).moderationMode};
    return c.json(body);
  })
  .put('/moderation', moderationBody, ...guard, async c => {
    const {mode} = c.req.valid('json');
    const db = c.var.db;
    const before = (await getBoardSettings(db)).moderationMode;
    if (before !== mode) {
      // Read when a job is submitted: jobs already in review stay there.
      await saveSettings(db, {moderationMode: mode});
      await audit(db, {...(await actorOf(c)), action: 'moderation_mode_changed', target: ['board', 1], meta: {from: before, to: mode}});
    }
    const body: AdminModerationMode = {mode};
    return c.json(body);
  });
