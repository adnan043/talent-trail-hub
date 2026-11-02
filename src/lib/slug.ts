/** Max slug length before any uniqueness suffix. */
export const SLUG_MAX = 80;

/** Latin letters NFKD doesn't decompose. */
const TRANSLITERATE: Record<string, string> = {ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l', þ: 'th', ð: 'd'};

/** "Senior Café Engineer (Remote)!" → "senior-cafe-engineer-remote". Never empty. */
export function slugify(input: string, fallback = 'item'): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[ßæœøđłþð]/g, (ch) => TRANSLITERATE[ch] ?? '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return fallback;
  if (slug.length <= SLUG_MAX) return slug;
  const cut = slug.slice(0, SLUG_MAX);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > SLUG_MAX / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}
