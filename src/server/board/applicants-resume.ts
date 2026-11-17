import {deleteFile, firstBytes} from '../files';

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

/** The stored file's first bytes (`../files`: the platform's storage, or the local development table). */
export {firstBytes};

/** True when the stored file really is a PDF / DOCX; otherwise deletes it and answers false. */
export async function checkStoredResume(requestUrl: string, fileId: string, contentType: string): Promise<boolean> {
  const bytes = await firstBytes(requestUrl, fileId);
  if (bytes && looksLikeResume(contentType, bytes)) return true;
  await deleteFile(requestUrl, fileId).catch(() => undefined);
  return false;
}
