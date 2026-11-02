import {jobColumns, type JobValues} from '../../lib/job-input';
import {employmentLabel, formatSalary, SALARY_NOT_DISCLOSED, workplaceAndPlace} from '../../lib/job-display';
import {renderMarkdown} from '../../lib/markdown';
import {Avatar, Card} from '../ui';

/**
 * The wizard's step 4: the job as its public page (`/jobs/<slug>/`) will show it, built from the
 * same pieces: `jobColumns` (what the server stores), `renderMarkdown` (the same sanitized HTML)
 * and the public page's formatters (src/lib/job-display.ts).
 */
export function JobPreview({
  values,
  company,
  categoryName,
  currency,
}: {
  values: JobValues;
  company: {name: string; logoUrl: string | null; location: string | null};
  categoryName: string;
  currency: string;
}) {
  const job = jobColumns(values);
  const salary =
    job.salaryPeriod && (job.salaryMinCents !== null || job.salaryMaxCents !== null)
      ? formatSalary({minCents: job.salaryMinCents, maxCents: job.salaryMaxCents, currency, period: job.salaryPeriod}, 'full')
      : null;
  const place = workplaceAndPlace({...job, applicantCountries: job.applicantCountries ?? []}, 'full');
  // Sanitized by the board's allow-list (src/lib/rich-text.ts), exactly as the server stores it.
  const html = {__html: renderMarkdown(job.descriptionMd)};
  return (
    <Card title="Preview" description="This is how your job will look on the board.">
      <article className="job-preview">
        <header className="job-head">
          <Avatar name={company.name} src={company.logoUrl} size="lg" />
          <div>
            <h3>{job.title || 'Job title'}</h3>
            <p className="muted">{company.name}</p>
          </div>
        </header>
        <dl className="definition-list job-facts">
          <div>
            <dt>Location</dt>
            <dd>{place}</dd>
          </div>
          <div>
            <dt>Job type</dt>
            <dd>{employmentLabel(job.employmentType)}</dd>
          </div>
          <div>
            <dt>Salary</dt>
            <dd>{salary ?? SALARY_NOT_DISCLOSED}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{categoryName}</dd>
          </div>
        </dl>
        <h4 className="job-section-title">About the job</h4>
        <div className="prose job-description" dangerouslySetInnerHTML={html} />
        {job.tags.length > 0 && (
          <ul className="job-tags-list chips" aria-label="Tags">
            {job.tags.map(tag => (
              <li key={tag} className="chip chip-tag">
                {tag}
              </li>
            ))}
          </ul>
        )}
      </article>
    </Card>
  );
}
