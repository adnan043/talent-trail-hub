import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate, useParams} from '@tanstack/react-router';

import {JOB_STATUS_LABELS} from '../../../lib/board';
import type {JobValues} from '../../../lib/job-input';
import type {EmployerJobDetail} from '../../../lib/types-employer';
import {api, ApiError, read} from '../../api';
import {JobForm} from '../../board/JobForm';
import {buttonClass, Card, EmptyState, ErrorNote, LoadingBlock, Notice, PageHeader, StatusBadge, useToast} from '../../ui';
import {employerOptionsQuery, myJobQuery} from '../queries';
import {STATUS_TONES} from '../status';

/** `/dashboard/employer/jobs/$id/edit` (F15): edit; a live job may go back to review. */
export function EditEmployerJob() {
  const {id} = useParams({strict: false}) as {id: string};
  const jobId = Number(id);
  const job = useQuery(myJobQuery(jobId));
  const options = useQuery(employerOptionsQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (values: JobValues) =>
      read<{job: EmployerJobDetail; reReview: boolean}>(api.employer.jobs[':id'].$put({param: {id}, json: {job: values}})),
    onSuccess: answer => {
      toast.success(answer.reReview ? 'Saved. Your job is back in review and returns once approved.' : 'Job saved.');
      // The list and this job (both under ['employer', 'jobs']); company, options and orders did not change.
      void queryClient.invalidateQueries({queryKey: ['employer', 'jobs']});
      void navigate({to: '/employer/jobs'});
    },
  });

  if (job.isPending || options.isPending) return <div className="app-page"><LoadingBlock rows={6} /></div>;
  if (job.error instanceof ApiError && job.error.status === 404) {
    return (
      <div className="app-page">
        <EmptyState icon="search" title="This job does not exist" action={<Link className={buttonClass({variant: 'secondary'})} to="/employer/jobs">Back to my jobs</Link>}>
          It may have been removed, or the link is old.
        </EmptyState>
      </div>
    );
  }
  if (job.error || options.error) return <div className="app-page"><ErrorNote error={(job.error ?? options.error)!} /></div>;
  const detail = job.data.job;
  const fieldErrors = save.error instanceof ApiError && Object.keys(save.error.fields).length ? save.error.fields : undefined;
  return (
    <div className="app-page screen-edit-job">
      <PageHeader
        title={detail.values.title}
        description="Changes show on the board once saved. The job's address stays the same."
        actions={<StatusBadge tone={STATUS_TONES[detail.status]}>{JOB_STATUS_LABELS[detail.status]}</StatusBadge>}
      />
      {!detail.actions.edit ? (
        <Notice tone="info">This job can no longer be edited.</Notice>
      ) : (
        <Card>
          {detail.status === 'published' && <Notice tone="info">On this board, edits to a live job may be reviewed again before they show.</Notice>}
          <JobForm
            initial={detail.values}
            categories={options.data.categories}
            currency={options.data.currency}
            onSubmit={values => save.mutate(values)}
            pending={save.isPending}
            serverErrors={fieldErrors}
            submitLabel="Save changes"
            secondary={<Link className={buttonClass({variant: 'secondary'})} to="/employer/jobs" disabled={save.isPending}>Cancel</Link>}
            status={save.error && !fieldErrors ? <Notice tone="danger">{save.error.message}</Notice> : null}
          />
        </Card>
      )}
    </div>
  );
}
