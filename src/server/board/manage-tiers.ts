import {type Context, Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {LIMITS} from '../../lib/board';
import type {AdminTier, AdminTiers, CataloguePrice, TierInput} from '../../lib/types-manage';
import {MANAGE_LIMITS} from '../../lib/types-manage';
import {audit} from '../../platform/auth';
import {listPrices, type Price} from '../../platform/payments';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import type {Viewer} from '../../platform/types';
import {PERMISSIONS} from '../permissions';
import {actorOf, asObject, idParam, invalid, str, tryPlatform} from './manage-shared';
import {getBoardSettings} from './settings';
import {forgetBoardSettings} from './brand';

/**
 * F25 listing tiers: 1 to 3 active, never deleted (paid orders point at them), each naming a
 * platform catalogue price (`priceKey`) whose amount and currency are COPIED here for display;
 * the checkout charges the catalogue's. A tier without a key works only with free posting on.
 */
const KEY = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_TIERS = 20;

const tierSelect = {
  id: true,
  name: true,
  priceKey: true,
  priceCents: true,
  currency: true,
  durationDays: true,
  includesFeatured: true,
  isActive: true,
  sortOrder: true,
} as const;

const loadTiers = (db: PrismaClient): Promise<AdminTier[]> =>
  db.listingTier.findMany({select: tierSelect, orderBy: [{isActive: 'desc'}, {sortOrder: 'asc'}, {id: 'asc'}], take: MAX_TIERS});

const toCatalogue = (p: Price): CataloguePrice => ({key: p.key, name: p.name, amountCents: p.amountCents, currency: p.currency, interval: p.interval});

/** One-time catalogue prices, or the words saying why there are none. */
async function catalogue(requestUrl: string): Promise<{prices: CataloguePrice[] | null; error: string | null}> {
  const res = await tryPlatform(() => listPrices(requestUrl));
  if (!res.ok) return {prices: null, error: res.message};
  return {prices: res.data.prices.filter(p => p.interval === 'one_time').map(toCatalogue), error: null};
}

const tierBody = validator('json', (value, c) => {
  const v = asObject(value);
  const fields: Record<string, string> = {};
  const name = str(v.name);
  if (!name) fields.name = 'Give the tier a name, like "Standard".';
  else if (name.length > MANAGE_LIMITS.tierName) fields.name = `Use at most ${MANAGE_LIMITS.tierName} characters.`;
  const priceKey = v.priceKey === null || v.priceKey === '' || v.priceKey === undefined ? null : str(v.priceKey);
  if (priceKey !== null && !KEY.test(priceKey)) fields.priceKey = 'Pick a price from the catalogue.';
  const days = v.durationDays;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > LIMITS.tierDaysMax) {
    fields.durationDays = `Pick a whole number of days from 1 to ${LIMITS.tierDaysMax}.`;
  }
  if (Object.keys(fields).length) return invalid(c, fields);
  const input: TierInput = {
    name,
    priceKey,
    durationDays: days as number,
    includesFeatured: v.includesFeatured === true,
    isActive: v.isActive !== false,
  };
  return input;
});

class TierRule extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
  }
}

/** Checked on the stored rows inside the write's transaction: 1 to 3 active tiers. */
async function checkActive(tx: Pick<PrismaClient, 'listingTier'>) {
  const active = await tx.listingTier.count({where: {isActive: true}});
  if (active < 1) throw new TierRule('isActive', 'Keep at least one active listing tier.');
  if (active > LIMITS.tiersActiveMax) throw new TierRule('isActive', `Up to ${LIMITS.tiersActiveMax} tiers can be active at once. Deactivate one first.`);
}

const guard = [withViewer, requireAuth, requirePermission(PERMISSIONS.BOARD_SETTINGS), withDb] as const;

/** The amount and currency to copy for a key (or the 422 / 503 answer to give). */
async function priceFor(requestUrl: string, key: string) {
  const res = await tryPlatform(() => listPrices(requestUrl));
  if (!res.ok) return {error: 'unavailable' as const, message: res.message};
  const price = res.data.prices.find(p => p.key === key);
  if (!price || price.interval !== 'one_time') return {error: 'missing' as const, message: 'That price is not in the catalogue (one-time prices only).'};
  return {price};
}

export const manageTierRoutes = new Hono()
  .get('/', ...guard, async c => {
    const [tiers, settings, prices] = await Promise.all([loadTiers(c.var.db), getBoardSettings(c.var.db), catalogue(c.req.url)]);
    const body: AdminTiers = {
      tiers,
      freePostingEnabled: settings.freePostingEnabled,
      prices: prices.prices,
      pricesError: prices.error,
      maxActive: LIMITS.tiersActiveMax,
      daysMax: LIMITS.tierDaysMax,
    };
    return c.json(body);
  })

  .post('/', tierBody, ...guard, async c => save(c, null, c.req.valid('json')))
  .put('/free-posting', validator('json', v => ({enabled: asObject(v).enabled === true})), ...guard, async c => {
    const {enabled} = c.req.valid('json');
    const db = c.var.db;
    if (!enabled) {
      const unpriced = await db.listingTier.findFirst({where: {isActive: true, priceKey: null}, select: {name: true}});
      if (unpriced) {
        return c.json(problem('tier_without_price', `"${unpriced.name}" has no price. Pick one for it, or deactivate it, before turning free posting off.`), 409);
      }
    }
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, freePostingEnabled: enabled}, update: {freePostingEnabled: enabled}, select: {id: true}});
    // After the write, outside any transaction: every instance's cached settings go (brand.ts).
    await forgetBoardSettings();
    await audit(db, {...(await actorOf(c)), action: 'free_posting_changed', target: ['board', 1], meta: {enabled}});
    return c.json({freePostingEnabled: enabled});
  })
  .put('/:id', tierBody, ...guard, async c => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json(problem('not_found', 'No such tier.'), 404);
    return save(c, id, c.req.valid('json'));
  });

type TierContext = Context<{Variables: {db: PrismaClient; viewer: Viewer}}>;

async function save(c: TierContext, id: number | null, input: TierInput) {
  const db = c.var.db;
  const existing = id ? await db.listingTier.findUnique({where: {id}, select: tierSelect}) : null;
  if (id && !existing) return c.json(problem('not_found', 'No such tier.'), 404);

  const copy: {priceCents: number; currency: string} = {
    priceCents: existing?.priceCents ?? 0,
    currency: existing?.currency ?? (await getBoardSettings(db)).currency,
  };
  if (input.priceKey) {
    const found = await priceFor(c.req.url, input.priceKey);
    if ('price' in found && found.price) {
      copy.priceCents = found.price.amountCents;
      copy.currency = found.price.currency;
    } else if (found.error === 'missing') {
      return invalid(c, {priceKey: found.message});
    } else if (input.priceKey !== existing?.priceKey) {
      // The same key as before keeps its copied amount; a new one must be read from the catalogue.
      return c.json(problem('prices_unavailable', found.message ?? 'The price catalogue did not answer. Try again.'), 503);
    }
  } else {
    copy.priceCents = 0;
    if (input.isActive && !(await getBoardSettings(db)).freePostingEnabled) {
      return invalid(c, {priceKey: 'Pick a price. A tier without one only works while free posting is on.'});
    }
  }

  try {
    const tier = await db.$transaction(async tx => {
      const data = {...input, ...copy};
      const row = existing
        ? await tx.listingTier.update({where: {id: existing.id}, data, select: tierSelect})
        : await tx.listingTier.create({
            data: {...data, sortOrder: (await tx.listingTier.count({where: {isActive: true}})) + 1},
            select: tierSelect,
          });
      await checkActive(tx);
      return row;
    });
    await audit(db, {
      ...(await actorOf(c)),
      action: existing ? 'tier_updated' : 'tier_created',
      target: ['listing_tier', tier.id],
      meta: {priceKey: tier.priceKey, durationDays: tier.durationDays, includesFeatured: tier.includesFeatured, isActive: tier.isActive},
    });
    return c.json({tier}, existing ? 200 : 201);
  } catch (err) {
    if (err instanceof TierRule) return invalid(c, {[err.field]: err.message}, err.message);
    throw err;
  }
}
