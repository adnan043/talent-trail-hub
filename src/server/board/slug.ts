import {slugify} from '../../lib/slug';

const NUMBERED_TRIES = 3;

const randomSuffix = () => crypto.randomUUID().replace(/-/g, '').slice(0, 6);

/** Prisma's unique-constraint error (P2002). */
export const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as {code?: string}).code === 'P2002';

/** A unique clash on the slug itself (not another unique column, such as a company's owner). */
const isSlugClash = (err: unknown): boolean => {
  if (!isUniqueViolation(err)) return false;
  const target = (err as {meta?: {target?: unknown}}).meta?.target;
  return target === undefined || JSON.stringify(target).includes('slug');
};

/**
 * First free slug among `base`, `base-2`, `base-3`, then `base-<random>` (few queries, even for
 * titles that all reduce to the same base).
 * `isTaken` checks the target table (e.g. `db.job.findUnique({where: {slug}})`).
 */
export async function uniqueSlug(text: string, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  const base = slugify(text);
  for (let n = 1; n <= NUMBERED_TRIES; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${base}-${randomSuffix()}`;
}

/**
 * Creates a row with a unique slug. The check-then-insert can race with a concurrent
 * insert of the same slug, so a unique violation retries with a fresh slug.
 */
export async function createWithUniqueSlug<T>(
  text: string,
  isTaken: (slug: string) => Promise<boolean>,
  create: (slug: string) => Promise<T>,
  attempts = 3
): Promise<T> {
  for (let i = 1; ; i++) {
    const slug = await uniqueSlug(text, isTaken);
    try {
      return await create(slug);
    } catch (err) {
      if (!isSlugClash(err) || i >= attempts) throw err;
    }
  }
}
