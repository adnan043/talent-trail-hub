import {type QueryClient, queryOptions} from '@tanstack/react-query';

import {LIMITS, RESUME_TYPES} from '../../lib/board';
import {
  type ApplicantProfileAnswer,
  type ApplicantProfileForEmployer,
  PHOTO_TYPES,
  type ProfileDetails,
  type ProfileUploadGrant,
} from '../../lib/types-profile';
import {siteFetch} from '../../platform/browser';
import {putFile} from '../../platform/files-browser';
import {ApiError, read} from '../api';
import {meQuery} from '../queries';

/** The job seeker's own profile reads and writes (`/site-api/applicant-profile`). Keys start `['applicant-profile']`. */

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: {'content-type': 'application/json'},
  ...(body === undefined ? {} : {body: JSON.stringify(body)}),
});

export const applicantProfileQuery = queryOptions({
  queryKey: ['applicant-profile'],
  queryFn: () => read<ApplicantProfileAnswer>(siteFetch('/site-api/applicant-profile')),
  staleTime: 60_000,
});

/** After a change: the profile, and `me` (its account kind decides the sidebar). */
export function storeProfile(queryClient: QueryClient, answer: ApplicantProfileAnswer) {
  queryClient.setQueryData(applicantProfileQuery.queryKey, answer);
  void queryClient.invalidateQueries({queryKey: meQuery.queryKey});
}

export const startApplicant = () => read<ApplicantProfileAnswer>(siteFetch('/site-api/applicant-profile/start', json('POST')));

export const saveProfileDetails = (details: ProfileDetails) =>
  read<ApplicantProfileAnswer>(siteFetch('/site-api/applicant-profile', json('PUT', details)));

/** The own photo, for `<img src>`: an access-checked redirect; `v` changes with the file. */
export const ownPhotoUrl = (version: string | null) => (version ? `/site-api/applicant-profile/photo?v=${version}` : null);
export const ownResumeUrl = '/site-api/applicant-profile/resume';

const FILE_RULES = {
  photo: {types: PHOTO_TYPES as readonly string[], mb: LIMITS.photoMb, message: `Use a PNG, JPG or WebP photo up to ${LIMITS.photoMb} MB.`},
  resume: {types: RESUME_TYPES as readonly string[], mb: LIMITS.resumeMb, message: `Upload your CV as a PDF or DOCX file up to ${LIMITS.resumeMb} MB.`},
} as const;

/** The browser's check, before any upload (the server checks again, and then the stored bytes). */
export function checkProfileFile(kind: 'photo' | 'resume', file: File): string | null {
  const rule = FILE_RULES[kind];
  return rule.types.includes(file.type) && file.size > 0 && file.size <= rule.mb * 1024 * 1024 ? null : rule.message;
}

/** Ask for an upload URL, send the bytes straight to storage, confirm. Throws an `ApiError` with words for people. */
export async function uploadProfileFile(kind: 'photo' | 'resume', file: File): Promise<ApplicantProfileAnswer> {
  const wrong = checkProfileFile(kind, file);
  if (wrong) throw new ApiError(wrong, 422, {[kind]: wrong});
  const base = `/site-api/applicant-profile/${kind}`;
  const grant = await read<ProfileUploadGrant>(siteFetch(base, json('POST', {name: file.name, contentType: file.type, size: file.size})));
  const put = await putFile(grant.upload as Parameters<typeof putFile>[0], file);
  if (!put.ok) throw new ApiError(put.message || 'The upload did not finish. Try again.', 400);
  return read<ApplicantProfileAnswer>(siteFetch(`${base}/complete`, json('POST', {fileId: grant.fileId, token: grant.token})));
}

/** The employer's / staff's view of one applicant's profile (null: applied without an account). */
export const applicantProfileOfQuery = (applicationId: number) =>
  queryOptions({
    queryKey: ['applicants', 'profile', applicationId],
    queryFn: () => read<{profile: ApplicantProfileForEmployer | null}>(siteFetch(`/site-api/applications/${applicationId}/profile`)),
    staleTime: 60_000,
  });

export const applicantPhotoUrl = (applicationId: number) => `/site-api/applications/${applicationId}/photo`;
