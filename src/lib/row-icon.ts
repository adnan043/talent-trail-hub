/**
 * The "Vela" job row's icon, picked from words in the job title (the design's mapping; unknown
 * titles get a briefcase). Browser-safe: the job rows (VelaJobRow.astro) and the sign-in page's
 * "you'll go straight back to" card use it.
 */
export type RowIcon = 'code' | 'design' | 'write' | 'support' | 'coach' | 'finance' | 'marketing' | 'ops' | 'sales';

export const ROW_ICON_NAMES: readonly RowIcon[] = ['code', 'design', 'write', 'support', 'coach', 'finance', 'marketing', 'ops', 'sales'];

const ROW_ICONS: [RegExp, RowIcon][] = [
  [/engineer|developer|programm|devops|software/i, 'code'],
  [/design/i, 'design'],
  [/writ|copy|content|editor/i, 'write'],
  [/customer|support|success/i, 'support'],
  [/coach|teach|tutor|trainer/i, 'coach'],
  [/financ|analyst|accountant/i, 'finance'],
  [/social|marketing|seo\b|growth/i, 'marketing'],
  [/operations|logistics/i, 'ops'],
];

export const rowIcon = (title: string): RowIcon => ROW_ICONS.find(([re]) => re.test(title))?.[1] ?? 'sales';
