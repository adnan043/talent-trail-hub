import type {BoardEmailTemplate} from '../email';

/**
 * The board's email templates, ported from the old app's `src/emails/*.md`.
 *
 * `{{name}}` is a value from the caller (`BoardEmail.vars`; `boardName` is filled in from the
 * board settings when missing). The body is a tiny, TRUSTED markup: paragraphs split by a blank
 * line, `**bold**`, `[label](url)`. Values are never parsed as markup: the renderer
 * (./render.ts) turns the template into HTML first and only then inserts each value, escaped.
 * A paragraph that is empty once its values are in (an optional `{{refundMessage}}`) is dropped.
 *
 * Links: a value named `…Url` that starts with `/` is made absolute with the site's origin.
 */
export interface EmailTemplate {
  subject: string;
  body: string;
}

export const TEMPLATES: Record<BoardEmailTemplate, EmailTemplate> = {
  'job-submitted': {
    subject: 'We received your job: {{jobTitle}}',
    body: `Hi,

Thanks for posting **{{jobTitle}}** on {{boardName}}.

{{statusMessage}}

You can follow its status in your [dashboard]({{dashboardUrl}}).`,
  },
  'job-approved': {
    subject: 'Your job is live: {{jobTitle}}',
    body: `Good news! **{{jobTitle}}** is now live on {{boardName}}.

[View your listing]({{jobUrl}})

It stays up until {{expiresOn}}. We'll remind you before it expires.`,
  },
  'job-rejected': {
    subject: 'Your job was not approved: {{jobTitle}}',
    body: `Hi,

We're sorry, but **{{jobTitle}}** was not approved for {{boardName}}.

**Reason:** {{rejectionReason}}

{{refundMessage}}

If you have questions, reply to this email or visit your [dashboard]({{dashboardUrl}}).`,
  },
  'job-expiring': {
    subject: '{{jobTitle}} expires on {{expiresOn}}',
    body: `Hi,

Your listing **{{jobTitle}}** on {{boardName}} expires on {{expiresOn}}.

Want to keep it up? [Renew it now]({{renewUrl}}).`,
  },
  'job-expired': {
    subject: 'Your listing has expired: {{jobTitle}}',
    body: `Hi,

Your listing **{{jobTitle}}** on {{boardName}} has expired and is no longer visible to candidates.

Still hiring? [Renew it]({{renewUrl}}).`,
  },
  'new-applicant': {
    subject: 'New applicant for {{jobTitle}}',
    body: `Hi,

**{{applicantName}}** just applied for **{{jobTitle}}** on {{boardName}}.

[Review applicants]({{applicantsUrl}})`,
  },
  'application-confirmation': {
    subject: 'Your application to {{companyName}}',
    // No {{applicantName}}: the address is typed by the visitor, so the text they typed never
    // reaches someone else's inbox from the board's sender.
    body: `Hi,

Your application for **{{jobTitle}}** at {{companyName}} has been sent through {{boardName}}. The employer will contact you directly if they'd like to move forward.

[View the job]({{jobUrl}})

Good luck!`,
  },
  'application-shortlisted': {
    subject: 'Update on your application to {{companyName}}',
    body: `Hi {{applicantName}},

Good news: {{companyName}} has shortlisted your application for **{{jobTitle}}** on {{boardName}}. They will contact you directly about next steps.

Good luck!`,
  },
  'application-rejected': {
    subject: 'Update on your application to {{companyName}}',
    body: `Hi {{applicantName}},

Thank you for applying for **{{jobTitle}}** at {{companyName}} through {{boardName}}. They have decided not to move forward with your application.

We wish you the best with your search.`,
  },
  'admin-job-review': {
    subject: 'A job is waiting for review: {{jobTitle}}',
    body: `Hi,

**{{jobTitle}}** from {{companyName}} is waiting for review on {{boardName}}.

[Review the job]({{reviewUrl}})`,
  },
  'order-receipt': {
    subject: 'Your {{boardName}} receipt ({{orderTotal}})',
    body: `Hi,

Thanks for your order on {{boardName}}.

**Order:** {{orderNumber}}
**Items:** {{orderItems}}
**Total:** {{orderTotal}}

[View receipt]({{receiptUrl}})

All your orders and receipts are on your [billing page]({{billingUrl}}).`,
  },
};
