import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {type ReactNode, useRef, useState} from 'react';

import {LIMITS} from '../../lib/board';
import {
  type ApplicantProfileView,
  GENDER_LABELS,
  GENDERS,
  type Gender,
  missingToApply,
  PHONE_RE,
  PHOTO_ACCEPT,
  PROFILE_LIMITS,
  profileCompletion,
  type ProfileDetails,
  REQUIREMENT_LABELS,
} from '../../lib/types-profile';
import {RESUME_ACCEPT} from '../../lib/types-apply';
import {AUTH_RULES, type Rule} from '../../lib/rules';
import {api, ApiError, read} from '../api';
import {meQuery, twoFactorQuery} from '../queries';
import {when} from '../shared';
import {
  Button,
  buttonClass,
  Card,
  DefinitionList,
  Drawer,
  EmptyState,
  ErrorNote,
  Field,
  Icon,
  type IconName,
  LoadingBlock,
  Notice,
  PasswordInput,
  rules,
  Select,
  Tabs,
  useForm,
  useToast,
} from '../ui';
import {ProfilePhoto} from './profile-parts';
import {applicantProfileQuery, ownPhotoUrl, openOwnResume, ownResumeUrl, saveProfileDetails, storeProfile, uploadProfileFile} from './profile-queries';

/**
 * `/dashboard/profile`: the job seeker's profile. A completion banner, then tabs of sections that
 * open and close; each section shows its details and edits them in a drawer. The photo and the CV
 * upload straight to storage (private files) and are checked again on the server.
 */

type Tab = 'personal' | 'career' | 'education' | 'documents';
const TABS: {value: Tab; label: string}[] = [
  {value: 'personal', label: 'Personal information'},
  {value: 'career', label: 'Career and skills'},
  {value: 'education', label: 'Education'},
  {value: 'documents', label: 'Photo and CV'},
];

const dash = (v: ReactNode) => (v === null || v === undefined || v === '' ? '—' : v);

const details = (p: ApplicantProfileView): ProfileDetails => ({
  phone: p.phone,
  dateOfBirth: p.dateOfBirth,
  gender: p.gender,
  presentAddress: p.presentAddress,
  permanentAddress: p.permanentAddress,
  headline: p.headline,
  careerSummary: p.careerSummary,
  experienceYears: p.experienceYears,
  expectedSalary: p.expectedSalary,
  degree: p.degree,
  institute: p.institute,
  passingYear: p.passingYear,
  skills: p.skills,
  profileUrl: p.profileUrl,
});

export function Profile() {
  const answer = useQuery(applicantProfileQuery);
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('personal');

  if (answer.isPending) return <div className="app-page"><LoadingBlock rows={6} /></div>;
  if (answer.error) return <div className="app-page"><ErrorNote error={answer.error} title="Your profile could not load" /></div>;
  const profile = answer.data.profile;
  if (!profile) {
    return (
      <div className="app-page">
        <EmptyState
          icon="user"
          title={answer.data.kind === 'employer' ? 'This is a company account' : 'You have no job seeker profile yet'}
          action={
            answer.data.kind === 'employer' ? undefined : (
              <Button onClick={() => void navigate({to: '/welcome', search: {as: 'applicant'}})}>Set up my profile</Button>
            )
          }>
          {answer.data.kind === 'employer' ? 'Company accounts post jobs. To apply for jobs, sign up with another email.' : 'Set it up once, then apply to any job with one click.'}
        </EmptyState>
      </div>
    );
  }

  const percent = profileCompletion(profile);
  const missing = missingToApply(profile);
  return (
    <div className="app-page screen-profile">
      <section className="profile-banner" aria-label="Profile completion">
        <div className="profile-banner-text">
          <p className="profile-banner-title">{percent === 100 ? 'Your profile is complete' : `Your profile is ${percent}% complete`}</p>
          <p className="muted">
            Last updated <strong>{when(profile.updatedAt)}</strong>
          </p>
        </div>
        <div className="profile-banner-actions">
          {profile.resumeFileName && (
            <a className={buttonClass({variant: 'link'})} href={ownResumeUrl} onClick={openOwnResume}>
              Download CV <Icon name="download" size={16} />
            </a>
          )}
          <Link className={buttonClass()} to="/my-applications">
            My applications
          </Link>
        </div>
      </section>

      {missing.length > 0 && (
        <Notice tone="warning" title="Before you can apply">
          Add {missing.map(m => REQUIREMENT_LABELS[m]).join(', ')}. Everything else is optional, but a fuller profile stands out.
        </Notice>
      )}

      <Tabs label="Profile sections" items={TABS} value={tab} onChange={setTab}>
        <div className="profile-sections">
          {tab === 'personal' && (
            <>
              <PersonalSection profile={profile} />
              <AddressSection profile={profile} />
            </>
          )}
          {tab === 'career' && (
            <>
              <CareerSection profile={profile} />
              <SkillsSection profile={profile} />
            </>
          )}
          {tab === 'education' && <EducationSection profile={profile} />}
          {tab === 'documents' && (
            <>
              <PhotoSection profile={profile} />
              <ResumeSection profile={profile} />
            </>
          )}
        </div>
      </Tabs>
    </div>
  );
}

/** A titled section of the profile, with an Edit action. */
function Section({title, icon, onEdit, children}: {title: string; icon: IconName; onEdit?: () => void; children: ReactNode}) {
  return (
    <Card className="profile-section" as="section">
      <div className="profile-section-head">
        <h3>
          <Icon name={icon} size={18} />
          {title}
        </h3>
        {onEdit && (
          <div className="profile-section-actions">
            <Button variant="link" size="sm" icon="pencil" onClick={onEdit}>
              Edit
            </Button>
          </div>
        )}
      </div>
      <div className="profile-section-body">{children}</div>
    </Card>
  );
}

// ------------------------------------------------------------ the editors --

type FieldSpec = {
  name: keyof ProfileDetails;
  label: string;
  hint?: string;
  kind?: 'text' | 'textarea' | 'date' | 'number' | 'gender' | 'url' | 'tel';
  rules?: Rule[];
  placeholder?: string;
};

const toText = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/**
 * A drawer editing some of the details; the rest are sent back unchanged (the route saves all of them).
 * `withName`: the account's name too, saved first by the auth core (`PATCH /site-api/auth/me`).
 */
function EditDrawer({profile, title, fields, withName = false, open, onClose}: {profile: ApplicantProfileView; title: string; fields: FieldSpec[]; withName?: boolean; open: boolean; onClose: () => void}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const initial = {
    ...(withName ? {name: profile.name ?? ''} : {}),
    ...Object.fromEntries(fields.map(f => [f.name, toText(profile[f.name])])),
  } as Record<string, string>;
  const form = useForm(initial, {
    ...(withName ? {name: AUTH_RULES.name} : {}),
    ...Object.fromEntries(fields.map(f => [f.name, f.rules ?? []])),
  });
  const save = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      const name = values.name?.trim() ?? '';
      if (withName && name !== (profile.name ?? '')) {
        await read(api.auth.me.$patch({json: {name}}));
        void queryClient.invalidateQueries({queryKey: meQuery.queryKey});
      }
      const next: Record<string, unknown> = {...details(profile)};
      for (const f of fields) {
        const v = values[f.name]?.trim() ?? '';
        next[f.name] = v === '' ? null : f.kind === 'number' ? Number(v) : v;
      }
      return saveProfileDetails(next as unknown as ProfileDetails);
    },
    onSuccess: answer => {
      storeProfile(queryClient, answer);
      toast.success(`${title} saved.`);
      onClose();
    },
    onError: error => error instanceof ApiError && form.setServerErrors(error.fields),
  });
  const close = () => {
    form.reset(initial);
    save.reset();
    onClose();
  };
  return (
    <Drawer
      open={open}
      onClose={close}
      title={title}
      dismissible={!save.isPending}
      onSubmit={form.submit(values => save.mutate(values as Record<string, string>))}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending} pendingLabel="Saving…">
            Save
          </Button>
        </>
      }>
      <div className="form-stack">
        {/* The general note unless a field shown HERE carries the error (every save sends all the details). */}
        {save.error &&
          !(save.error instanceof ApiError && Object.keys(save.error.fields).some(k => (k === 'name' && withName) || fields.some(f => f.name === k))) && (
            <ErrorNote
              error={save.error instanceof ApiError && Object.keys(save.error.fields).length ? new Error(`Another section needs fixing first: ${Object.values(save.error.fields).join(' ')}`) : save.error}
              title="Not saved"
            />
          )}
        {withName && (
          <Field id="f-name" label="Full name" hint="Employers see it on every application." error={form.error('name')}>
            <input {...form.field('name')} autoComplete="name" placeholder="Your full name" />
          </Field>
        )}
        {fields.map(f => (
          <Field key={f.name} id={`f-${f.name}`} label={f.label} hint={f.hint} error={form.error(f.name)} optional>
            {f.kind === 'textarea' ? (
              <textarea {...form.field(f.name)} rows={5} placeholder={f.placeholder} />
            ) : f.kind === 'gender' ? (
              <Select
                {...form.field(f.name)}
                options={[{value: '', label: 'Prefer not to say'}, ...GENDERS.map(g => ({value: g, label: GENDER_LABELS[g as Gender]}))]}
              />
            ) : (
              <input
                {...form.field(f.name)}
                type={f.kind === 'date' ? 'date' : f.kind === 'number' ? 'text' : f.kind === 'url' ? 'url' : f.kind === 'tel' ? 'tel' : 'text'}
                inputMode={f.kind === 'number' ? 'numeric' : f.kind === 'url' ? 'url' : f.kind === 'tel' ? 'tel' : undefined}
                placeholder={f.placeholder}
              />
            )}
          </Field>
        ))}
      </div>
    </Drawer>
  );
}

const httpsLink: Rule = value => {
  const v = value.trim();
  if (!v) return null;
  try {
    return new URL(v).protocol === 'https:' ? null : 'Enter a link that starts with https://.';
  } catch {
    return 'Enter a link that starts with https://.';
  }
};

const yearRule = (min: number, max: number, message: string): Rule => value => {
  const v = value.trim();
  if (!v) return null;
  return /^\d{1,4}$/.test(v) && Number(v) >= min && Number(v) <= max ? null : message;
};

/** A section's details with its editor. */
function EditableSection({profile, title, icon, fields, withName, children}: {profile: ApplicantProfileView; title: string; icon: IconName; fields: FieldSpec[]; withName?: boolean; children: ReactNode}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Section title={title} icon={icon} onEdit={() => setEditing(true)}>
        {children}
      </Section>
      {/* Mounted while open only, so it starts from the saved values each time. */}
      {editing && <EditDrawer profile={profile} title={title} fields={fields} withName={withName} open onClose={() => setEditing(false)} />}
    </>
  );
}

function PersonalSection({profile}: {profile: ApplicantProfileView}) {
  const [changingEmail, setChangingEmail] = useState(false);
  return (
    <>
      <EditableSection
        profile={profile}
        title="Personal details"
        icon="user"
        withName
        fields={[
          {
            name: 'phone',
            label: 'Phone',
            kind: 'tel',
            placeholder: '+880 1700 000000',
            hint: 'Employers can call you on it.',
            rules: [rules.pattern(PHONE_RE, 'Enter a phone number with digits only.')],
          },
          {name: 'dateOfBirth', label: 'Date of birth', kind: 'date'},
          {name: 'gender', label: 'Gender', kind: 'gender'},
        ]}>
        <DefinitionList
          items={[
            {label: 'Full name', value: dash(profile.name)},
            {
              label: 'Email',
              value: (
                <>
                  {dash(profile.email)}{' '}
                  <Button variant="link" size="sm" onClick={() => setChangingEmail(true)}>
                    Change
                  </Button>
                </>
              ),
            },
            {label: 'Phone', value: dash(profile.phone)},
            {label: 'Date of birth', value: dash(profile.dateOfBirth && new Intl.DateTimeFormat('en-GB', {dateStyle: 'long', timeZone: 'UTC'}).format(new Date(profile.dateOfBirth)))},
            {label: 'Gender', value: dash(profile.gender && GENDER_LABELS[profile.gender])},
          ]}
        />
      </EditableSection>
      {changingEmail && <EmailDrawer email={profile.email} onClose={() => setChangingEmail(false)} />}
    </>
  );
}

/**
 * Changing the sign-in email: the auth core emails a link to the new address and nothing changes
 * until it is opened (`POST /site-api/auth/email`, as on Your account).
 */
function EmailDrawer({email, onClose}: {email: string | null; onClose: () => void}) {
  const needsPassword = useQuery(twoFactorQuery).data?.hasPassword ?? true;
  const form = useForm(
    {email: '', password: ''},
    {email: AUTH_RULES.email, password: needsPassword ? [rules.required('Enter your current password.')] : []}
  );
  const [sent, setSent] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: (values: {email: string; password: string}) => read<{message: string}>(api.auth.email.$post({json: values})),
    onSuccess: data => {
      form.reset();
      setSent(data.message);
    },
    onError: err => err instanceof ApiError && form.setServerErrors(err.fields),
  });
  return (
    <Drawer
      open
      onClose={onClose}
      title="Change email"
      dismissible={!change.isPending}
      onSubmit={form.submit(values => {
        setSent(null);
        change.mutate({email: values.email.trim(), password: values.password});
      })}
      footer={
        sent ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={change.isPending}>
              Cancel
            </Button>
            <Button type="submit" icon="mail" pending={change.isPending} pendingLabel="Sending…">
              Send the link
            </Button>
          </>
        )
      }>
      <div className="form-stack">
        <p className="muted">
          You sign in with <strong>{email ?? 'your email'}</strong>. We send a link to the new address; nothing changes until you open it.
        </p>
        {change.error && !(change.error instanceof ApiError && Object.keys(change.error.fields).length) && <ErrorNote error={change.error} title="Not sent" />}
        {sent ? (
          <Notice tone="success">{sent}</Notice>
        ) : (
          <>
            <Field id="f-newEmail" label="New email address" error={form.error('email')}>
              <input {...form.field('email')} type="email" autoComplete="email" inputMode="email" placeholder="name@example.com" />
            </Field>
            {needsPassword && (
              <Field id="f-emailPassword" label="Current password" error={form.error('password')}>
                <PasswordInput {...form.field('password')} autoComplete="current-password" placeholder="Your current password" />
              </Field>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

function AddressSection({profile}: {profile: ApplicantProfileView}) {
  return (
    <EditableSection
      profile={profile}
      title="Address details"
      icon="map-pin"
      fields={[
        {name: 'presentAddress', label: 'Present address', rules: [rules.maxLength(PROFILE_LIMITS.address)]},
        {name: 'permanentAddress', label: 'Permanent address', rules: [rules.maxLength(PROFILE_LIMITS.address)]},
      ]}>
      <DefinitionList
        items={[
          {label: 'Present address', value: dash(profile.presentAddress)},
          {label: 'Permanent address', value: dash(profile.permanentAddress)},
        ]}
      />
    </EditableSection>
  );
}

function CareerSection({profile}: {profile: ApplicantProfileView}) {
  return (
    <EditableSection
      profile={profile}
      title="Career and application"
      icon="briefcase"
      fields={[
        {name: 'headline', label: 'Career title', placeholder: 'Senior React developer', rules: [rules.maxLength(PROFILE_LIMITS.headline)]},
        {name: 'careerSummary', label: 'Career summary', kind: 'textarea', placeholder: 'What you do best, in a few lines.', rules: [rules.maxLength(PROFILE_LIMITS.careerSummary)]},
        {
          name: 'experienceYears',
          label: 'Years of experience',
          kind: 'number',
          rules: [yearRule(0, PROFILE_LIMITS.experienceYearsMax, `Enter whole years, 0 to ${PROFILE_LIMITS.experienceYearsMax}.`)],
        },
        {name: 'expectedSalary', label: 'Expected salary', placeholder: 'BDT 60,000 a month', rules: [rules.maxLength(PROFILE_LIMITS.expectedSalary)]},
      ]}>
      <DefinitionList
        items={[
          {label: 'Career title', value: dash(profile.headline)},
          {label: 'Career summary', value: dash(profile.careerSummary)},
          {label: 'Experience', value: dash(profile.experienceYears === null ? null : `${profile.experienceYears} ${profile.experienceYears === 1 ? 'year' : 'years'}`)},
          {label: 'Expected salary', value: dash(profile.expectedSalary)},
        ]}
      />
    </EditableSection>
  );
}

function SkillsSection({profile}: {profile: ApplicantProfileView}) {
  const skills = (profile.skills ?? '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  return (
    <EditableSection
      profile={profile}
      title="Skills and links"
      icon="award"
      fields={[
        {name: 'skills', label: 'Skills', kind: 'textarea', hint: 'Separate them with commas: React, SQL, Figma.', rules: [rules.maxLength(PROFILE_LIMITS.skills)]},
        {name: 'profileUrl', label: 'Profile or portfolio link', kind: 'url', placeholder: 'https://www.linkedin.com/in/you', rules: [httpsLink]},
      ]}>
      <DefinitionList
        items={[
          {label: 'Skills', value: skills.length ? <span className="profile-chips">{skills.map(s => <span key={s} className="profile-chip">{s}</span>)}</span> : '—'},
          {
            label: 'Profile link',
            value: profile.profileUrl ? (
              <a href={profile.profileUrl} target="_blank" rel="noopener noreferrer">
                {profile.profileUrl}
              </a>
            ) : (
              '—'
            ),
          },
        ]}
      />
    </EditableSection>
  );
}

function EducationSection({profile}: {profile: ApplicantProfileView}) {
  return (
    <EditableSection
      profile={profile}
      title="Highest education"
      icon="graduation-cap"
      fields={[
        {name: 'degree', label: 'Degree', placeholder: 'BSc in Computer Science', rules: [rules.maxLength(PROFILE_LIMITS.degree)]},
        {name: 'institute', label: 'Institute', placeholder: 'University of Dhaka', rules: [rules.maxLength(PROFILE_LIMITS.institute)]},
        {name: 'passingYear', label: 'Passing year', kind: 'number', placeholder: '2022', rules: [yearRule(PROFILE_LIMITS.passingYearMin, PROFILE_LIMITS.passingYearMax, 'Enter a year like 2020.')]},
      ]}>
      <DefinitionList
        items={[
          {label: 'Degree', value: dash(profile.degree)},
          {label: 'Institute', value: dash(profile.institute)},
          {label: 'Passing year', value: dash(profile.passingYear)},
        ]}
      />
    </EditableSection>
  );
}

// ------------------------------------------------------------- the files --

function useFileUpload(kind: 'photo' | 'resume') {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (file: File) => uploadProfileFile(kind, file),
    onSuccess: answer => {
      storeProfile(queryClient, answer);
      toast.success(kind === 'photo' ? 'Photo updated.' : 'CV updated.');
    },
  });
}

/** A hidden file input behind a button. */
function PickFile({accept, label, pending, onPick}: {accept: string; label: string; pending: boolean; onPick: (file: File) => void}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onPick(file);
        }}
      />
      <Button variant="secondary" icon="upload" pending={pending} pendingLabel="Uploading…" onClick={() => input.current?.click()}>
        {label}
      </Button>
    </>
  );
}

function PhotoSection({profile}: {profile: ApplicantProfileView}) {
  const upload = useFileUpload('photo');
  return (
    <Section title="Photo" icon="camera">
      <div className="profile-file">
        <ProfilePhoto src={ownPhotoUrl(profile.photoVersion)} name={profile.name} size="lg" />
        <div className="profile-file-text">
          <p>{profile.hasPhoto ? 'Employers see this photo with your applications.' : 'Add a clear photo of your face. You need one to apply.'}</p>
          <p className="field-hint">PNG, JPG or WebP, up to {LIMITS.photoMb} MB. A square photo looks best.</p>
          {upload.error && <p className="field-error" role="alert">{upload.error.message}</p>}
          <PickFile accept={PHOTO_ACCEPT} label={profile.hasPhoto ? 'Change photo' : 'Upload photo'} pending={upload.isPending} onPick={file => upload.mutate(file)} />
        </div>
      </div>
    </Section>
  );
}

function ResumeSection({profile}: {profile: ApplicantProfileView}) {
  const upload = useFileUpload('resume');
  return (
    <Section title="CV" icon="file">
      <div className="profile-file">
        <span className="profile-file-icon" aria-hidden="true">
          <Icon name="file" size={32} />
        </span>
        <div className="profile-file-text">
          {profile.resumeFileName ? (
            <p>
              <a href={ownResumeUrl} onClick={openOwnResume}>
                {profile.resumeFileName}
              </a>
              {profile.resumeUpdatedAt && <span className="muted"> · uploaded {when(profile.resumeUpdatedAt)}</span>}
            </p>
          ) : (
            <p>No CV yet. You need one to apply.</p>
          )}
          <p className="field-hint">PDF or DOCX, up to {LIMITS.resumeMb} MB. Every application sends the CV you have here at that moment.</p>
          {upload.error && <p className="field-error" role="alert">{upload.error.message}</p>}
          <PickFile accept={RESUME_ACCEPT} label={profile.resumeFileName ? 'Replace CV' : 'Upload CV'} pending={upload.isPending} onPick={file => upload.mutate(file)} />
        </div>
      </div>
    </Section>
  );
}
