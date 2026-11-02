/** Small colour maths shared by the brand stylesheet (server) and the live sidebar preview (browser). */

export type Rgb = [number, number, number];

export const toRgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
export const toHex = (rgb: Rgb) => `#${rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two colours (1–21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(toRgb(a)), luminance(toRgb(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `color` mixed toward `target` by `amount` (0–1). */
export const mix = (color: string, target: string, amount: number): string => {
  const [a, b] = [toRgb(color), toRgb(target)];
  return toHex(a.map((v, i) => v + (b[i] - v) * amount) as Rgb);
};

/** The colour moved toward `target` in small steps until it reaches `ratio` against `bg`. */
export function until(color: string, target: string, bg: string, ratio: number): string {
  let out = color;
  for (let step = 0; step < 20 && contrast(out, bg) < ratio; step++) out = mix(out, target, 0.1);
  return contrast(out, bg) >= ratio ? out : target;
}
