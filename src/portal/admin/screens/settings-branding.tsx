import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {type ChangeEvent, useEffect, useRef, useState} from 'react';

import {FONT_PRESETS, type FontPreset, LIMITS} from '../../../lib/board';
import type {AdminBranding, FooterLink} from '../../../lib/types-manage';
import {sidebarTokens} from '../../../lib/sidebar-colours';
import {HEX_COLOR, isFooterHref, MANAGE_LIMITS} from '../../../lib/types-manage';
import {putFile} from '../../../platform/files-browser';
import {type UploadGrant} from '../../../platform/files-browser';
import {api, ApiError, read} from '../../api';
import {Button, Card, ErrorNote, Field, IconButton, LoadingBlock, Notice, PageHeader, rules, Select, useConfirm, useForm, useToast} from '../../ui';
import {brandingQuery} from '../queries';

const FONT_LABELS: Record<FontPreset, string> = {inter: 'Sans (Inter)', serif: 'Serif', mono: 'Monospace'};
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** `/manage/settings/branding` (site:board:settings): name, logo, colour, font, home page text, footer links (F30). */
export function Branding() {
  const branding = useQuery(brandingQuery);
  return (
    <div className="app-page screen-branding">
      <PageHeader title="Branding" description="How the public board looks: its logo, colour, font and home page." />
      {branding.isPending ? <LoadingBlock rows={6} /> : branding.error ? <ErrorNote error={branding.error} /> : <BrandingForm data={branding.data} />}
    </div>
  );
}

const OPTIONAL_HEX = /^(#[0-9a-f]{6})?$/i;

/** Re-scopes the sidebar's tokens to the picked colours; a half-typed value counts as empty. */
function applySidebar(bg: string, text: string) {
  const el = document.querySelector<HTMLElement>('.app-sidebar');
  if (!el) return;
  const tokens = sidebarTokens(HEX_COLOR.test(bg) ? bg : null, HEX_COLOR.test(text) ? text : null);
  for (const [name, value] of Object.entries(tokens)) el.style.setProperty(name, value);
  el.style.background = tokens['--card'];
}

function BrandingForm({data}: {data: AdminBranding}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const form = useForm(
    {name: data.name, primaryColor: data.primaryColor, sidebarBg: data.sidebarBg, sidebarText: data.sidebarText, fontPreset: data.fontPreset as string, heroTitle: data.heroTitle, heroSubtitle: data.heroSubtitle},
    {
      name: [rules.required('Give the board a name.'), rules.maxLength(MANAGE_LIMITS.boardName)],
      primaryColor: [rules.required('Pick a colour.'), rules.pattern(HEX_COLOR, 'Use a colour like #4f46e5.')],
      sidebarBg: [rules.pattern(OPTIONAL_HEX, 'Use a colour like #1f1a16, or leave it empty.')],
      sidebarText: [rules.pattern(OPTIONAL_HEX, 'Use a colour like #f3eee6, or leave it empty.')],
      heroTitle: [rules.required('Write the home page title.'), rules.maxLength(MANAGE_LIMITS.heroTitle)],
      heroSubtitle: [rules.maxLength(MANAGE_LIMITS.heroSubtitle)],
    }
  );
  // The sidebar follows the pickers live (set through the CSSOM: the CSP blocks `style=""`); it is
  // saved only with the form. Leaving the screen puts back the last SAVED colours.
  const saved = useRef(data);
  saved.current = data;
  useEffect(() => applySidebar(form.values.sidebarBg, form.values.sidebarText), [form.values.sidebarBg, form.values.sidebarText]);
  useEffect(() => () => applySidebar(saved.current.sidebarBg, saved.current.sidebarText), []);
  const [links, setLinks] = useState<FooterLink[]>(data.footerLinks);
  const [linkErrors, setLinkErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => read<AdminBranding>(api.manage.settings.branding.$put({json: {...form.values, footerLinks: links}})),
    onSuccess: () => {
      toast.success('Branding saved. The public site shows it on the next page load.');
      void queryClient.invalidateQueries({queryKey: ['manage', 'settings', 'branding']});
      void queryClient.invalidateQueries({queryKey: ['site']});
    },
    onError: err => {
      if (!(err instanceof ApiError)) return;
      form.setServerErrors(err.fields);
      setLinkErrors(Object.fromEntries(Object.entries(err.fields).filter(([k]) => k.startsWith('footerLinks'))));
    },
  });
  const checkLinks = () => {
    const errors: Record<string, string> = {};
    links.forEach((l, i) => {
      if (!l.label.trim() || l.label.trim().length > MANAGE_LIMITS.footerLabel) errors[`footerLinks.${i}.label`] = `A label needs 1 to ${MANAGE_LIMITS.footerLabel} characters.`;
      if (!isFooterHref(l.href.trim())) errors[`footerLinks.${i}.href`] = 'Use a path on this site (/about/) or an https:// link.';
    });
    setLinkErrors(errors);
    return Object.keys(errors).length === 0;
  };
  const setLink = (i: number, key: keyof FooterLink) => (e: ChangeEvent<HTMLInputElement>) =>
    setLinks(current => current.map((l, j) => (j === i ? {...l, [key]: e.target.value} : l)));
  const submit = form.submit(() => checkLinks() && save.mutate());

  return (
    <>
      <div className="grid-2 grid-equal">
        <LogoCard logoUrl={data.logoUrl} />
        <FaviconCard faviconUrl={data.faviconUrl} />
      </div>
      <form noValidate onSubmit={submit}>
        <Card title="Colour and home page" footer={<Button type="submit" pending={save.isPending} pendingLabel="Saving…">Save branding</Button>}>
          <div className="form-stack">
            <Field label="Main colour" id="f-primaryColor" error={form.error('primaryColor')} hint="Buttons and links. A hex colour like #4f46e5.">
              <span className="color-field">
                <input {...form.field('primaryColor')} placeholder="#4f46e5" />
                <input
                  type="color"
                  aria-label="Pick the main colour"
                  value={HEX_COLOR.test(form.values.primaryColor) ? form.values.primaryColor : '#4f46e5'}
                  onChange={e => form.set('primaryColor', e.target.value)}
                />
              </span>
            </Field>
            <Field label="Sidebar background" id="f-sidebarBg" error={form.error('sidebarBg')} hint="The dashboard sidebar. Empty keeps the default dark panel." optional>
              <span className="color-field">
                <input {...form.field('sidebarBg')} placeholder="#1f1a16" />
                <input
                  type="color"
                  aria-label="Pick the sidebar background"
                  value={HEX_COLOR.test(form.values.sidebarBg) ? form.values.sidebarBg : '#1f1a16'}
                  onChange={e => form.set('sidebarBg', e.target.value)}
                />
              </span>
            </Field>
            <Field label="Sidebar text colour" id="f-sidebarText" error={form.error('sidebarText')} hint="Sidebar links and labels. Made readable on the background." optional>
              <span className="color-field">
                <input {...form.field('sidebarText')} placeholder="#f3eee6" />
                <input
                  type="color"
                  aria-label="Pick the sidebar text colour"
                  value={HEX_COLOR.test(form.values.sidebarText) ? form.values.sidebarText : '#f3eee6'}
                  onChange={e => form.set('sidebarText', e.target.value)}
                />
              </span>
            </Field>
            <Field label="Font" id="f-fontPreset">
              <Select {...form.field('fontPreset')} options={FONT_PRESETS.map(f => ({value: f, label: FONT_LABELS[f]}))} />
            </Field>
            <Field label="Home page title" id="f-heroTitle" error={form.error('heroTitle')}>
              <input {...form.field('heroTitle')} placeholder="Find your next role" />
            </Field>
            <Field label="Home page subtitle" id="f-heroSubtitle" error={form.error('heroSubtitle')} optional>
              <textarea {...form.field('heroSubtitle')} rows={2} placeholder="Hand-picked jobs from companies that are hiring now." />
            </Field>
            <fieldset className="link-list">
              <legend>Footer links</legend>
              <p className="link-list-hint">Shown in the footer of the public site, in this order.</p>
              {links.length === 0 && <p className="link-list-empty">No footer links yet.</p>}
              {links.map((link, i) => (
                <div className="link-row" key={i}>
                  <span className="link-row-num" aria-hidden="true">{i + 1}</span>
                  <Field label="Label" id={`f-link-${i}-label`} error={linkErrors[`footerLinks.${i}.label`]}>
                    <input id={`f-link-${i}-label`} value={link.label} placeholder="About us" onChange={setLink(i, 'label')} aria-invalid={linkErrors[`footerLinks.${i}.label`] ? true : undefined} aria-describedby={linkErrors[`footerLinks.${i}.label`] ? `f-link-${i}-label-error` : undefined} />
                  </Field>
                  <Field label="Address" id={`f-link-${i}-href`} error={linkErrors[`footerLinks.${i}.href`]}>
                    <input id={`f-link-${i}-href`} value={link.href} placeholder="/about/" onChange={setLink(i, 'href')} aria-invalid={linkErrors[`footerLinks.${i}.href`] ? true : undefined} aria-describedby={linkErrors[`footerLinks.${i}.href`] ? `f-link-${i}-href-error` : undefined} />
                  </Field>
                  <span className="link-row-remove">
                    <IconButton icon="trash" label={`Remove link ${i + 1}`} onClick={() => setLinks(current => current.filter((_, j) => j !== i))} />
                  </span>
                </div>
              ))}
              <div>
                <Button variant="secondary" icon="plus" disabled={links.length >= MANAGE_LIMITS.footerLinks} onClick={() => setLinks(current => [...current, {label: '', href: ''}])}>
                  Add a link
                </Button>
              </div>
            </fieldset>
            {save.error && !(save.error instanceof ApiError && Object.keys(save.error.fields).length) && <ErrorNote error={save.error} />}
          </div>
        </Card>
      </form>
    </>
  );
}

/** A PNG or JPEG of the picked image, shrunk until it fits the local fallback's 48 KB. */
async function shrink(file: File): Promise<{contentType: string; data: string}> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  for (const edge of [256, 192, 128, 96, 64]) {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const [contentType, quality] of [['image/png', undefined], ['image/jpeg', 0.85]] as const) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, contentType, quality));
      if (blob && blob.size <= 48 * 1024) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return {contentType, data: btoa(String.fromCharCode(...bytes))};
      }
    }
  }
  throw new Error('That image is too detailed to keep here. Try a simpler one.');
}

async function uploadLocal(file: File) {
  const image = await shrink(file);
  return read<{logoUrl: string}>(api.manage.settings.branding.logo.local.$post({json: image}));
}

/** The logo: a PUBLIC file. 1. ask the route for an upload, 2. PUT the bytes, 3. confirm. */
function LogoCard({logoUrl}: {logoUrl: string | null}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const done = (message: string) => {
    toast.success(message);
    void queryClient.invalidateQueries({queryKey: ['manage', 'settings', 'branding']});
    void queryClient.invalidateQueries({queryKey: ['site']});
  };
  const upload = useMutation({
    mutationFn: async (file: File) => {
      let grant: {fileId: string; token: string; upload: UploadGrant['upload']};
      try {
        grant = await read(api.manage.settings.branding.logo.$post({json: {name: file.name, contentType: file.type, size: file.size}}));
      } catch (err) {
        // No file storage on this site (local, demo): keep a small copy in the Site Database.
        if (err instanceof ApiError && err.status === 503) return uploadLocal(file);
        throw err;
      }
      const put = await putFile(grant.upload, file);
      if (!put.ok) throw new Error(put.message);
      return read<{logoUrl: string}>(api.manage.settings.branding.logo[':fileId'].complete.$post({param: {fileId: grant.fileId}, json: {token: grant.token}}));
    },
    onSuccess: () => done('Logo saved.'),
    onError: err => setError(err.message),
  });
  const remove = useMutation({mutationFn: () => read(api.manage.settings.branding.logo.$delete())});
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type) || file.size > LIMITS.logoMb * 1024 * 1024) {
      setError(`Pick a PNG, JPG or WebP image up to ${LIMITS.logoMb} MB.`);
      return;
    }
    setError(null);
    upload.mutate(file);
  };
  const askRemove = async () => {
    if (await confirm({title: 'Remove the logo?', body: 'The board shows its name instead.', confirmLabel: 'Remove logo', pendingLabel: 'Removing…', action: () => remove.mutateAsync()})) done('Logo removed.');
  };
  return (
    <Card title="Logo" className="asset-card">
      <div className="logo-row">
        <div className="setting-row-text">
          <h4>{logoUrl ? <img src={logoUrl} alt="The current logo" height={40} /> : 'No logo yet'}</h4>
          <p>{`PNG, JPG or WebP, up to ${LIMITS.logoMb} MB. Shown in the header.`}</p>
        </div>
        <span className="toolbar-group">
          <input ref={input} id="f-logo" type="file" className="visually-hidden" accept={LOGO_TYPES.join(',')} onChange={pick} disabled={upload.isPending} />
          <Button variant="secondary" pending={upload.isPending} pendingLabel="Uploading…" onClick={() => input.current?.click()}>
            {logoUrl ? 'Replace logo' : 'Upload logo'}
          </Button>
          {logoUrl && <Button variant="danger" onClick={() => void askRemove()} disabled={upload.isPending}>Remove</Button>}
        </span>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </Card>
  );
}

/** The favicon (browser tab icon): a PUBLIC file, uploaded like the logo. */
function FaviconCard({faviconUrl}: {faviconUrl: string | null}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const done = (message: string) => {
    toast.success(message);
    void queryClient.invalidateQueries({queryKey: ['manage', 'settings', 'branding']});
    void queryClient.invalidateQueries({queryKey: ['site']});
  };
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const grant = await read<{fileId: string; token: string; upload: UploadGrant['upload']}>(
        api.manage.settings.branding.favicon.$post({json: {name: file.name, contentType: file.type, size: file.size}})
      );
      const put = await putFile(grant.upload, file);
      if (!put.ok) throw new Error(put.message);
      return read<{faviconUrl: string}>(api.manage.settings.branding.favicon[':fileId'].complete.$post({param: {fileId: grant.fileId}, json: {token: grant.token}}));
    },
    onSuccess: () => done('Favicon saved.'),
    onError: err => setError(err instanceof ApiError && err.status === 503 ? 'File storage is not available on this site yet.' : err.message),
  });
  const remove = useMutation({mutationFn: () => read(api.manage.settings.branding.favicon.$delete())});
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type) || file.size > LIMITS.logoMb * 1024 * 1024) {
      setError(`Pick a PNG, JPG or WebP image up to ${LIMITS.logoMb} MB.`);
      return;
    }
    setError(null);
    upload.mutate(file);
  };
  const askRemove = async () => {
    if (await confirm({title: 'Remove the favicon?', body: 'The browser tab goes back to the default icon.', confirmLabel: 'Remove favicon', pendingLabel: 'Removing…', action: () => remove.mutateAsync()})) done('Favicon removed.');
  };
  return (
    <Card title="Favicon" className="asset-card">
      <div className="logo-row">
        <div className="setting-row-text">
          <h4>{faviconUrl ? <img src={faviconUrl} alt="The current favicon" height={32} /> : 'No favicon yet'}</h4>
          <p>A square PNG, JPG or WebP image. Shown in the browser tab.</p>
        </div>
        <span className="toolbar-group">
          <input ref={input} id="f-favicon" type="file" className="visually-hidden" accept={LOGO_TYPES.join(',')} onChange={pick} disabled={upload.isPending} />
          <Button variant="secondary" pending={upload.isPending} pendingLabel="Uploading…" onClick={() => input.current?.click()}>
            {faviconUrl ? 'Replace favicon' : 'Upload favicon'}
          </Button>
          {faviconUrl && <Button variant="danger" onClick={() => void askRemove()} disabled={upload.isPending}>Remove</Button>}
        </span>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </Card>
  );
}
