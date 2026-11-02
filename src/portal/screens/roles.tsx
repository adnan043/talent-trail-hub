import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';

import {rules} from '../../lib/rules';
import type {PermissionRow, RoleRow} from '../../lib/types';
import {api, ApiError, read} from '../api';
import {permissionsQuery, rolesQuery} from '../queries';
import {useMe} from '../shared';
import {
  Badge,
  Icon,
  Button,
  Card,
  Checkbox,
  Drawer,
  EmptyState,
  ErrorNote,
  Field,
  LoadingBlock,
  Menu,
  SearchInput,
  Notice,
  PageHeader,
  useConfirm,
  useForm,
  useToast,
} from '../ui';

/** The role form's rules: the SAME limits `src/platform/auth/admin.ts` enforces. */
const ROLE_RULES = {
  slug: [
    rules.required('Enter a short id, like "editor".'),
    // The server lower-cases the id before testing it, so "Editor" is accepted.
    (value: string) =>
      !value.trim() || /^[a-z][a-z0-9-]{1,47}$/.test(value.trim().toLowerCase())
        ? null
        : 'Use 2 to 48 lowercase letters, digits or dashes, starting with a letter.',
  ],
  name: [rules.required('Enter a name.'), rules.maxLength(80)],
  description: [rules.maxLength(255)],
};

const OWNER = 'owner';

/**
 * `/roles` (site:role:read): what each role allows. Editing needs
 * site:role:update, and you can only grant permissions you hold yourself.
 * `owner` is fixed; built-in roles cannot be deleted.
 */
export function Roles() {
  const me = useMe();
  const canEdit = Boolean(me.data?.abilities.editRoles);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);

  const roles = useQuery(rolesQuery);
  const catalogue = useQuery(permissionsQuery);
  const remove = useMutation({
    mutationFn: (slug: string) => read(api.admin.roles[':slug'].$delete({param: {slug}})),
    onSuccess: () => queryClient.invalidateQueries({queryKey: ['roles']}),
  });
  const titles = new Map(catalogue.data?.permissions.map(p => [p.codename, p.title]));

  const askDelete = async (role: RoleRow) => {
    const done = await confirm({
      title: `Delete the “${role.name}” role?`,
      body: 'People who have it lose what it allowed. This cannot be undone.',
      confirmLabel: 'Delete role',
      pendingLabel: 'Deleting…',
      action: () => remove.mutateAsync(role.slug),
    });
    if (done) toast.success(`The “${role.name}” role is deleted.`);
  };

  return (
    <div className="app-page screen-roles">
      <PageHeader
        title="Roles"
        description="A role is a set of permissions. Give roles to people on the Users screen."
        actions={
          canEdit && (
            <Button icon="plus" onClick={() => setEditing('new')}>
              New role
            </Button>
          )
        }
      />

      {roles.error ? (
        <ErrorNote error={roles.error} />
      ) : roles.isPending ? (
        <div className="roles-grid">
          <Card>
            <LoadingBlock rows={3} />
          </Card>
          <Card>
            <LoadingBlock rows={3} />
          </Card>
        </div>
      ) : roles.data.roles.length === 0 ? (
        <Card>
          <EmptyState
            icon="shield"
            title="No roles yet"
            action={
              canEdit && <Button onClick={() => setEditing('new')}>New role</Button>
            }>
            A role groups permissions you can give to people.
          </EmptyState>
        </Card>
      ) : (
        <div className="roles-grid">
          {roles.data.roles.map(role => (
            <RoleCard
              key={role.slug}
              role={role}
              titles={titles}
              canEdit={canEdit}
              busy={remove.isPending && remove.variables === role.slug}
              onEdit={() => setEditing(role)}
              onDelete={() => void askDelete(role)}
            />
          ))}
        </div>
      )}

      {editing !== null && (
        <RoleForm
          key={editing === 'new' ? 'new' : editing.slug}
          role={editing === 'new' ? null : editing}
          catalogue={catalogue.data?.permissions ?? []}
          catalogueError={catalogue.error}
          catalogueLoading={catalogue.isPending}
          onClose={() => setEditing(null)}
          onSaved={name => {
            toast.success(
              editing === 'new'
                ? `The “${name}” role is created.`
                : `The “${name}” role is saved.`
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

const PREVIEW = 6;

function RoleCard({
  role,
  titles,
  canEdit,
  busy,
  onEdit,
  onDelete,
}: {
  role: RoleRow;
  titles: Map<string, string>;
  canEdit: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const fixed = role.slug === OWNER;
  const shown = open ? role.permissions : role.permissions.slice(0, PREVIEW);
  const hidden = role.permissions.length - shown.length;
  const count = role.members?.count ?? 0;
  return (
    <Card
      className="roles-card"
      title={
        <span className="roles-title">
          {role.name}
          {fixed ? (
            <Badge tone="brand" icon="lock">
              Fixed
            </Badge>
          ) : (
            role.isSystem && <Badge>Built-in</Badge>
          )}
        </span>
      }
      description={<code>{role.slug}</code>}
      actions={
        canEdit &&
        !fixed && (
          <Menu
            label={`Actions for the ${role.name} role`}
            disabled={busy}
            items={[
              {label: 'Edit', icon: 'pencil', onSelect: onEdit},
              ...(role.isSystem
                ? []
                : [
                    'separator' as const,
                    {label: 'Delete', icon: 'trash' as const, danger: true, onSelect: onDelete},
                  ]),
            ]}
          />
        )
      }>
      <div className="roles-body" aria-busy={busy || undefined}>
        {role.description && <p className="roles-description">{role.description}</p>}
        <p className="roles-meta">
          {role.members && (
            <span className="roles-meta-item">
              <Icon name="users" size={14} />
              {count === 0
                ? 'Nobody yet'
                : `${count}${role.members.more ? '+' : ''} ${count === 1 && !role.members.more ? 'person' : 'people'}`}
            </span>
          )}
          <span className="roles-meta-item">
            <Icon name="shield" size={14} />
            {fixed
              ? 'All permissions'
              : role.permissions.length === 0
                ? 'No extra permissions'
                : `${role.permissions.length} ${role.permissions.length === 1 ? 'permission' : 'permissions'}`}
          </span>
        </p>
        {fixed ? (
          <p className="muted">Everything, always. The owner role cannot be changed.</p>
        ) : role.permissions.length ? (
          <div className="roles-perms">
            <span className="badges">
              {shown.map(codename => (
                <span key={codename} title={codename}>
                  <Badge>{titles.get(codename) ?? codename}</Badge>
                </span>
              ))}
            </span>
            {role.permissions.length > PREVIEW && (
              <Button
                variant="link"
                size="sm"
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}>
                {open ? 'Show less' : `Show ${hidden} more`}
              </Button>
            )}
          </div>
        ) : (
          <p className="muted">Signed in, nothing more.</p>
        )}
      </div>
      {canEdit && !fixed && (
        <div className="roles-foot">
          <Button variant="secondary" size="sm" icon="pencil" onClick={onEdit} disabled={busy}>
            Edit role
          </Button>
        </div>
      )}
    </Card>
  );
}

function RoleForm({
  role,
  catalogue,
  catalogueError,
  catalogueLoading,
  onClose,
  onSaved,
}: {
  role: RoleRow | null;
  catalogue: PermissionRow[];
  catalogueError: Error | null;
  catalogueLoading: boolean;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm(
    {
      slug: role?.slug ?? '',
      name: role?.name ?? '',
      description: role?.description ?? '',
    },
    role ? {name: ROLE_RULES.name, description: ROLE_RULES.description} : ROLE_RULES
  );
  const [picked, setPicked] = useState<string[]>(role?.permissions ?? []);
  const save = useMutation({
    mutationFn: (values: {slug: string; name: string; description: string}) =>
      role
        ? read(
            api.admin.roles[':slug'].$patch({
              param: {slug: role.slug},
              json: {
                name: values.name,
                description: values.description,
                permissions: picked,
              },
            })
          )
        : read(api.admin.roles.$post({json: {...values, permissions: picked}})),
    onSuccess: async (_data, values) => {
      await queryClient.invalidateQueries({queryKey: ['roles']});
      onSaved(values.name.trim());
    },
    onError: err => err instanceof ApiError && form.setServerErrors(err.fields),
  });
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? catalogue.filter(p =>
        `${p.title} ${p.description ?? ''} ${p.group}`.toLowerCase().includes(needle)
      )
    : catalogue;
  const groups = [...new Set(visible.map(p => p.group))];
  const setGroup = (group: string, on: boolean) =>
    setPicked(current => {
      const codenames = catalogue.filter(p => p.group === group).map(p => p.codename);
      const rest = current.filter(codename => !codenames.includes(codename));
      return on ? [...rest, ...codenames] : rest;
    });
  const fieldErrors = save.error instanceof ApiError ? save.error.fields : {};
  const onField = ['slug', 'name', 'description'].some(name => fieldErrors[name]);

  return (
    <Drawer
      open
      onClose={onClose}
      dismissible={!save.isPending}
      title={role ? `Edit ${role.name}` : 'New role'}
      description="You can only give a role permissions you hold yourself."
      onSubmit={form.submit(values => save.mutate(values))}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending} pendingLabel="Saving…">
            {role ? 'Save changes' : 'Create role'}
          </Button>
        </>
      }>
      <div className="form-stack">
        {!role && (
          <Field
            id="f-slug"
            label="Id"
            hint="Lowercase, used in code, like “editor”. It cannot change later."
            error={form.error('slug')}>
            <input {...form.field('slug')} autoComplete="off" maxLength={48} placeholder="editor" />
          </Field>
        )}
        <Field id="f-name" label="Name" error={form.error('name')}>
          <input {...form.field('name')} autoComplete="off" maxLength={80} placeholder="Editor" />
        </Field>
        <Field
          id="f-description"
          label="Description"
          optional
          error={form.error('description')}>
          <textarea {...form.field('description')} rows={2} maxLength={255} placeholder="What people with this role can do." />
        </Field>

        {catalogueError && <ErrorNote error={catalogueError} />}
        {catalogueLoading ? (
          <LoadingBlock rows={3} />
        ) : (
          <div className="perm-picker">
            <div className="perm-picker-head">
              <h3>Permissions</h3>
              <span className="perm-count" aria-live="polite">
                {picked.length} of {catalogue.length} selected
              </span>
            </div>
            <SearchInput
              label="Search permissions"
              placeholder="Search permissions"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
            {groups.length === 0 && <p className="muted">No permission matches “{query.trim()}”.</p>}
            {groups.map(group => {
              const all = catalogue.filter(p => p.group === group);
              const on = all.filter(p => picked.includes(p.codename)).length;
              return (
                <fieldset className="checkbox-group perm-group" key={group}>
                  <legend>
                    <span>{group}</span>
                    <span className="perm-group-tools">
                      <span>
                        {on}/{all.length}
                      </span>
                      <Button
                        variant="link"
                        size="sm"
                        disabled={save.isPending}
                        onClick={() => setGroup(group, on !== all.length)}>
                        {on === all.length ? 'Clear' : 'Select all'}
                      </Button>
                    </span>
                  </legend>
                  {visible
                    .filter(p => p.group === group)
                    .map(permission => (
                      <Checkbox
                        key={permission.codename}
                        label={permission.title}
                        description={permission.description ?? undefined}
                        checked={picked.includes(permission.codename)}
                        disabled={save.isPending}
                        onChange={checked =>
                          setPicked(current =>
                            checked
                              ? [...current, permission.codename]
                              : current.filter(codename => codename !== permission.codename)
                          )
                        }
                      />
                    ))}
                </fieldset>
              );
            })}
          </div>
        )}
        {fieldErrors.permissions && (
          <Notice tone="danger">{fieldErrors.permissions}</Notice>
        )}
        {save.error && !onField && !fieldErrors.permissions && (
          <ErrorNote error={save.error} />
        )}
      </div>
    </Drawer>
  );
}
