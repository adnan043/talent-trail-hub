import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useRef, useState} from 'react';

import type {AdminTier, AdminTiers, CataloguePrice} from '../../../lib/types-manage';
import {MANAGE_LIMITS} from '../../../lib/types-manage';
import {api, ApiError, read} from '../../api';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  rules,
  Select,
  StatusBadge,
  Switch,
  useForm,
  useToast,
} from '../../ui';
import {money} from '../format';
import {tiersQuery} from '../queries';

/**
 * `/manage/tiers` (site:board:settings): listing tiers (F25). 1 to 3 active, never deleted. The
 * price is a platform catalogue key (prices are made in the editor: `npm run platform -- prices add`);
 * its amount is copied here for display. Free posting makes every tier cost nothing.
 */
export function Tiers() {
  const tiers = useQuery(tiersQuery);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<AdminTier | 'new' | null>(null);
  const data = tiers.data;
  const refresh = () => queryClient.invalidateQueries({queryKey: ['manage', 'tiers']});

  const free = useMutation({
    mutationFn: (enabled: boolean) => read<{freePostingEnabled: boolean}>(api.manage.tiers['free-posting'].$put({json: {enabled}})),
    onSuccess: r => {
      toast.success(r.freePostingEnabled ? 'Free posting is on.' : 'Free posting is off.');
      void refresh();
    },
  });
  const active = data?.tiers.filter(t => t.isActive).length ?? 0;

  const columns: Column<AdminTier>[] = [
    {key: 'name', header: 'Tier', cell: t => <span className="cell-title">{t.name}</span>},
    {key: 'price', header: 'Price', width: 'shrink', cell: t => (t.priceKey ? money(t.priceCents, t.currency) : <span className="muted">No price</span>)},
    {key: 'days', header: 'Days', width: 'shrink', cell: t => t.durationDays},
    {key: 'featured', header: 'Featured', width: 'shrink', hideOnMobile: true, cell: t => (t.includesFeatured ? <Badge tone="brand">Included</Badge> : '—')},
    {key: 'state', header: 'State', width: 'shrink', cell: t => <StatusBadge tone={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Active' : 'Inactive'}</StatusBadge>},
    {key: 'actions', header: 'Actions', actions: true, cell: t => <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Edit</Button>},
  ];

  return (
    <div className="app-page screen-tiers">
      <PageHeader
        title="Listing tiers"
        description={`What a job post costs and gives. ${data?.maxActive ?? 3} tiers can be active at once; tiers are never deleted.`}
        actions={<Button icon="plus" onClick={() => setEditing('new')} disabled={!data || active >= data.maxActive}>New tier</Button>}
      />
      <Card flush>
        <DataTable
          caption="Listing tiers"
          columns={columns}
          rows={data?.tiers}
          rowKey={t => t.id}
          loading={tiers.isPending}
          error={tiers.error}
          empty={<EmptyState icon="layers" title="No tiers yet" action={<Button icon="plus" onClick={() => setEditing('new')}>New tier</Button>}>Employers pick a tier when they post a job.</EmptyState>}
        />
      </Card>
      {data && (
        <Card
          title="Free posting"
          description="Waive the price of every tier, for example during a launch or promotion."
          actions={<StatusBadge tone={data.freePostingEnabled ? 'success' : 'neutral'}>{data.freePostingEnabled ? 'On' : 'Off'}</StatusBadge>}
        >
          <Switch
            label="Let employers post for free"
            description={
              data.freePostingEnabled
                ? 'Employers skip checkout and pay nothing on every tier. Days and featured still apply. Turn off to charge the tier prices again.'
                : `Employers are charged the tier price at checkout. Turn on to make all ${active} active tiers free.`
            }
            checked={data.freePostingEnabled}
            pending={free.isPending}
            onChange={v => free.mutate(v)}
          />
          {free.error && <ErrorNote error={free.error} />}
        </Card>
      )}
      {editing && data && (
        <TierDrawer
          key={editing === 'new' ? 'new' : editing.id}
          tier={editing === 'new' ? null : editing}
          data={data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success('Tier saved.');
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function TierDrawer({tier, data, onClose, onSaved}: {tier: AdminTier | null; data: AdminTiers; onClose: () => void; onSaved: () => void}) {
  const prices: CataloguePrice[] = data.prices ?? [];
  // The price rule reads the CURRENT "Active" box (a tier without a price may be inactive).
  const activeNow = useRef(tier?.isActive ?? true);
  const form = useForm(
    {name: tier?.name ?? '', priceKey: tier?.priceKey ?? '', durationDays: String(tier?.durationDays ?? 30), includesFeatured: tier?.includesFeatured ?? false, isActive: tier?.isActive ?? true},
    {
      name: [rules.required('Give the tier a name, like "Standard".'), rules.maxLength(MANAGE_LIMITS.tierName)],
      durationDays: [rules.required('Enter a number of days.'), rules.wholeNumber(), v => (Number(v) >= 1 && Number(v) <= data.daysMax ? null : `Pick 1 to ${data.daysMax} days.`)],
      priceKey: [(v: string) => (v || data.freePostingEnabled || !activeNow.current ? null : 'Pick a price. A tier without one only works while free posting is on.')],
    }
  );
  const save = useMutation({
    mutationFn: () => {
      const v = form.values;
      const json = {name: v.name.trim(), priceKey: v.priceKey || null, durationDays: Number(v.durationDays), includesFeatured: v.includesFeatured, isActive: v.isActive};
      return tier ? read(api.manage.tiers[':id'].$put({param: {id: String(tier.id)}, json})) : read(api.manage.tiers.$post({json}));
    },
    onSuccess: onSaved,
    onError: err => err instanceof ApiError && form.setServerErrors(err.fields),
  });
  // A key no longer in the catalogue (or the catalogue down) still shows as the current choice.
  const options = [{value: '', label: 'No price (free posting only)'}, ...prices.map(p => ({value: p.key, label: `${p.name} · ${money(p.amountCents, p.currency)} (${p.key})`}))];
  if (tier?.priceKey && !prices.some(p => p.key === tier.priceKey)) options.push({value: tier.priceKey, label: `${tier.priceKey} (current)`});
  const fieldErrors = save.error instanceof ApiError ? Object.keys(save.error.fields).length : 0;

  return (
    <Drawer
      open
      onClose={onClose}
      dismissible={!save.isPending}
      title={tier ? `Edit “${tier.name}”` : 'New tier'}
      description="Changes apply to new orders only: paid orders keep what they bought."
      onSubmit={form.submit(() => save.mutate())}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" pending={save.isPending} pendingLabel="Saving…">Save tier</Button>
        </>
      }>
      <div className="form-stack">
        <Field label="Name" id="f-name" error={form.error('name')}>
          <input {...form.field('name')} maxLength={MANAGE_LIMITS.tierName + 10} placeholder="Standard listing" />
        </Field>
        <Field label="Price" id="f-priceKey" error={form.error('priceKey')} hint="From the platform's price catalogue. New prices are added in the editor.">
          <Select {...form.field('priceKey')} options={options} />
        </Field>
        <Field label="Days live" id="f-durationDays" error={form.error('durationDays')} hint={`1 to ${data.daysMax}.`}>
          <input {...form.field('durationDays')} inputMode="numeric" placeholder="30" />
        </Field>
        <Checkbox label="Featured for the whole listing" checked={form.values.includesFeatured} onChange={v => form.set('includesFeatured', v)} disabled={save.isPending} />
        <Checkbox label="Active" description="Employers can pick it. Keep 1 to 3 active." checked={form.values.isActive} onChange={v => { activeNow.current = v; form.set('isActive', v); }} disabled={save.isPending} />
        {save.error && (fieldErrors === 0 || (save.error instanceof ApiError && save.error.fields.isActive)) && <ErrorNote error={save.error} />}
      </div>
    </Drawer>
  );
}
