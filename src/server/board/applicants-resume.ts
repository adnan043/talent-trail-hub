import {deleteFile, fileUrl} from '../../platform/files';

/**
 * F4 resume check: the stored file's FIRST BYTES must match its type (the name and the browser's
 * type prove nothing). PDF starts `%PDF-`, DOCX is a ZIP (`PK\x03\x04`). Read through a 60-second
 * link with a byte range, as `employer-logo.ts` does; a refused file is deleted.
 */
const SIGNATURES: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [0x50, 0x4b, 0x03, 0x04],
};

export function looksLikeResume(contentType: string, bytes: Uint8Array): boolean {
  const signature = SIGNATURES[contentType];
  return Boolean(signature && signature.every((b, i) => bytes[i] === b));
}

async function firstBytes(requestUrl: string, fileId: string): Promise<Uint8Array | null> {
  const link = await fileUrl(requestUrl, fileId, {expiresIn: 60});
  if (!link.ok) return null;
  try {
    const res = await fetch(link.data.url, {headers: {range: 'bytes=0-15'}, signal: AbortSignal.timeout(8000)});
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const {value} = await reader.read();
    await reader.cancel().catch(() => undefined);
    return value ?? null;
  } catch {
    return null;
  }
}

/** True when the stored file really is a PDF / DOCX; otherwise deletes it and answers false. */
export async function checkStoredResume(requestUrl: string, fileId: string, contentType: string): Promise<boolean> {
  const bytes = await firstBytes(requestUrl, fileId);
  if (bytes && looksLikeResume(contentType, bytes)) return true;
  await deleteFile(requestUrl, fileId).catch(() => undefined);
  return false;
}
