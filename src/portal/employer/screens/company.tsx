import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { LIMITS } from "../../../lib/board";
import {
  type EmployerCompany,
  SOCIAL_KEYS,
  SOCIAL_LABELS,
} from "../../../lib/types-employer";
import { putFile } from "../../../platform/files-browser";
import { siteFetch } from "../../../platform/browser";
import { api, ApiError, read } from "../../api";
import {
  Button,
  buttonClass,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  initials,
  LoadingBlock,
  Notice,
  PageHeader,
  useConfirm,
  useForm,
  useToast,
} from "../../ui";
import { COMPANY_RULES, SOCIAL_RULE } from "../draft";
import { employerCompanyQuery } from "../queries";

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LOCAL_MAX_BYTES = 44 * 1024;

/** Local fallback: the image shrunk to fit the 64 KB request (a logo needs no more than 256 px). */
async function shrink(
  file: File,
): Promise<{ contentType: string; data: string }> {
  const bitmap = await createImageBitmap(file);
  let side = 256;
  for (;;) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.75, 0.6]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (blob && blob.type === "image/webp" && blob.size <= LOCAL_MAX_BYTES) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return {
          contentType: "image/webp",
          data: btoa(String.fromCharCode(...bytes)),
        };
      }
    }
    if (side <= 64)
      throw new Error("That image is too detailed. Try a simpler one.");
    side = Math.round(side * 0.75);
  }
}

/** `/dashboard/employer/company` (F17): the own company's profile and logo. The name is fixed. */
export function EmployerCompanyScreen() {
  const company = useQuery(employerCompanyQuery);
  if (company.isPending)
    return (
      <div className="app-page">
        <LoadingBlock rows={5} />
      </div>
    );
  if (company.error)
    return (
      <div className="app-page">
        <ErrorNote error={company.error} />
      </div>
    );
  if (!company.data.company) {
    return (
      <div className="app-page">
        <EmptyState
          icon="briefcase"
          title="No company yet"
          action={
            <Link className={buttonClass()} to="/post-a-job">
              Post a job
            </Link>
          }
        >
          Your company profile is created with your first job.
        </EmptyState>
      </div>
    );
  }
  return (
    <CompanyEditor
      company={company.data.company}
      logoUploads={company.data.logoUploads}
    />
  );
}

function CompanyEditor({
  company,
  logoUploads,
}: {
  company: EmployerCompany;
  logoUploads: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const form = useForm(
    {
      website: company.website,
      location: company.location,
      about: company.about,
      ...Object.fromEntries(SOCIAL_KEYS.map((k) => [k, company.socials[k]])),
    } as Record<string, string>,
    {
      website: COMPANY_RULES.website,
      location: COMPANY_RULES.location,
      about: COMPANY_RULES.about,
      ...Object.fromEntries(SOCIAL_KEYS.map((k) => [k, SOCIAL_RULE])),
    },
  );
  const done = (next: { company: EmployerCompany }) => {
    queryClient.setQueryData(employerCompanyQuery.queryKey, (old) => ({
      logoUploads,
      ...old,
      ...next,
    }));
    void queryClient.invalidateQueries({ queryKey: ["employer", "options"] });
  };
  const save = useMutation({
    mutationFn: (v: Record<string, string>) =>
      read<{ company: EmployerCompany }>(
        api.employer.company.$put({
          json: {
            website: v.website,
            location: v.location,
            about: v.about,
            socials: Object.fromEntries(
              SOCIAL_KEYS.map((k) => [k, v[k] ?? ""]),
            ),
          },
        }),
      ),
    onSuccess: (next) => {
      done(next);
      toast.success("Company profile saved.");
    },
    onError: (err) => {
      if (err instanceof ApiError)
        form.setServerErrors(
          Object.fromEntries(
            Object.entries(err.fields).map(([k, m]) => [
              k.replace(/^socials\./, ""),
              m,
            ]),
          ),
        );
    },
  });
  return (
    <div className="app-page screen-employer-company">
      <PageHeader
        title={company.name}
        description="Shown on every job you post and on your company page. The name is your company's address and stays as it is."
      />
      <LogoCard company={company} enabled={logoUploads} onChange={done} />
      <Card title="Profile">
        <form
          className="form-stack"
          noValidate
          onSubmit={form.submit((values) => save.mutate(values))}
        >
          <div className="form-grid">
            <Field
              id="f-website"
              label="Website"
              optional
              error={form.error("website")}
              hint="The full link, starting with https://"
            >
              <input
                {...form.field("website")}
                type="url"
                autoComplete="url"
                placeholder="https://example.com"
              />
            </Field>
            <Field
              id="f-location"
              label="Location"
              optional
              error={form.error("location")}
              hint="Like Berlin, Germany."
            >
              <input
                {...form.field("location")}
                autoComplete="off"
                placeholder="Berlin, Germany"
              />
            </Field>
          </div>
          <Field
            id="f-about"
            label="About the company"
            optional
            error={form.error("about")}
            hint={`Up to ${LIMITS.companyAbout.toLocaleString("en-US")} characters, in simple Markdown.`}
          >
            <textarea
              {...form.field("about")}
              rows={8}
              placeholder="What your company does and what it is like to work there."
            />
          </Field>
          <div className="form-grid">
            {SOCIAL_KEYS.map((key) => (
              <Field
                key={key}
                id={`f-${key}`}
                label={SOCIAL_LABELS[key]}
                optional
                error={form.error(key)}
              >
                <input
                  {...form.field(key)}
                  type="url"
                  autoComplete="off"
                  placeholder="https://…"
                />
              </Field>
            ))}
          </div>
          {save.error &&
            !(
              save.error instanceof ApiError &&
              Object.keys(save.error.fields).length
            ) && <Notice tone="danger">{save.error.message}</Notice>}
          <div className="form-actions">
            <Button
              type="submit"
              pending={save.isPending}
              pendingLabel="Saving…"
            >
              Save profile
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

/** The logo: checked here first (type, size), then uploaded, then checked again by the server. */
function LogoCard({
  company,
  enabled,
  onChange,
}: {
  company: EmployerCompany;
  enabled: boolean;
  onChange: (next: { company: EmployerCompany }) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  const upload = async (file: File) => {
    setError(null);
    if (
      !LOGO_TYPES.includes(file.type) ||
      file.size > LIMITS.logoMb * 1024 * 1024
    ) {
      setError(`Use a PNG, JPG or WebP image up to ${LIMITS.logoMb} MB.`);
      return;
    }
    setBusy(true);
    try {
      if (!enabled) {
        const next = await read<{ company: EmployerCompany }>(
          api.employer.company.logo.local.$post({ json: await shrink(file) }),
        );
        onChange(next);
        toast.success("Logo updated.");
        return;
      }
      const grant = await read<{
        fileId: string;
        token: string;
        upload: Parameters<typeof putFile>[0];
      }>(
        api.employer.company.logo.$post({
          json: { name: file.name, contentType: file.type, size: file.size },
        }),
      );
      const put = await putFile(grant.upload, file);
      if (!put.ok) throw new Error(put.message);
      const next = await read<{ company: EmployerCompany }>(
        api.employer.company.logo.complete.$post({
          json: { fileId: grant.fileId, token: grant.token },
        }),
      );
      onChange(next);
      toast.success("Logo updated.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The upload did not work. Try again.",
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = () =>
    confirm({
      title: "Remove the logo?",
      body: "Your jobs show your company initials instead.",
      confirmLabel: "Remove logo",
      action: async () => {
        const res = await siteFetch("/site-api/employer/company/logo", {
          method: "DELETE",
        });
        const body = (await res.json().catch(() => null)) as {
          company?: EmployerCompany;
          message?: string;
        } | null;
        if (!res.ok || !body?.company)
          throw new Error(body?.message ?? "That did not work. Try again.");
        onChange({ company: body.company });
      },
    });
  const pick = (files: FileList | null | undefined) =>
    files?.[0] && void upload(files[0]);
  return (
    <Card title="Logo">
      <div className="logo-editor">
        <div className="logo-preview" aria-hidden="true">
          {company.logoUrl ? (
            <img src={company.logoUrl} alt="" width={112} height={112} decoding="async" />
          ) : (
            <span>{initials(company.name) || "?"}</span>
          )}
        </div>
        <div
          className={`logo-drop${dragging ? " is-dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) pick(e.dataTransfer.files);
          }}
        >
          <input
            ref={input}
            id="f-logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="visually-hidden"
            onChange={(e) => pick(e.target.files)}
          />
          <p className="logo-drop-title">
            {dragging
              ? "Drop to upload"
              : "Drag an image here, or choose a file"}
          </p>
          <p className="logo-drop-hint">
            PNG, JPG or WebP, up to {LIMITS.logoMb} MB. A square image looks
            best.
          </p>
          <div className="logo-drop-actions">
            <Button
              variant="secondary"
              pending={busy}
              pendingLabel="Uploading…"
              onClick={() => input.current?.click()}
            >
              {company.logoUrl ? "Replace logo" : "Upload logo"}
            </Button>
            {company.logoUrl && (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
      {error && (
        <div className="logo-error" role="alert">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
    </Card>
  );
}
