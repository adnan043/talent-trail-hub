import type {Context} from 'hono';

import {clientIp} from '../../platform/auth/kit';
import {config} from '../../platform/config';

const encoder = new TextEncoder();
let cached: {secret: string; key: Promise<CryptoKey>} | null = null;

/** IPv6 clients control a whole /64: rate limits key on that prefix, never the full address. */
function rateKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * The visitor's IP (IPv6: its /64) as a keyed SHA-256 (hex, 64 chars): IPs are never stored in clear. Keyed by
 * `JWT_SECRET`, so the hashes mean nothing outside this site. `null` without a secret.
 */
export async function ipHashOf(c: Context): Promise<string | null> {
  const secret = config.jwtSecret;
  if (!secret) return null;
  if (cached?.secret !== secret) {
    cached = {secret, key: crypto.subtle.importKey('raw', encoder.encode(`board-ip:${secret}`), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])};
  }
  const mac = await crypto.subtle.sign('HMAC', await cached.key, encoder.encode(rateKey(clientIp(c))));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}
