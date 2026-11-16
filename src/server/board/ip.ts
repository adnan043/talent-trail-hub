import type {Context} from 'hono';

import {clientIp, rateLimitIp} from '../../platform/auth/kit';
import {config} from '../../platform/config';

const encoder = new TextEncoder();
let cached: {secret: string; key: Promise<CryptoKey>} | null = null;

/**
 * The visitor's IP (IPv6: its /56, as the platform's own limits) as a keyed SHA-256 (hex, 64 chars): IPs are never stored in clear. Keyed by
 * `JWT_SECRET`, so the hashes mean nothing outside this site. `null` without a secret.
 */
export async function ipHashOf(c: Context): Promise<string | null> {
  const secret = config.jwtSecret;
  if (!secret) return null;
  if (cached?.secret !== secret) {
    cached = {secret, key: crypto.subtle.importKey('raw', encoder.encode(`board-ip:${secret}`), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])};
  }
  const mac = await crypto.subtle.sign('HMAC', await cached.key, encoder.encode(rateLimitIp(clientIp(c))));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}
