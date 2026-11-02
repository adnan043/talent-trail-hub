import {useInfiniteQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';

import {formatMoney} from '../../../lib/format';
import type {EmployerOrderRow} from '../../../lib/types-employer';
import {ago} from '../../shared';
import {Card, type Column, DataTable, EmptyState, LoadMore, PageHeader, StatusBadge, type Tone} from '../../ui';
import {myOrdersQuery} from '../queries';

const ORDER_TONES: Record<string, Tone> = {paid: 'success', refunded: 'neutral', pending: 'warning', failed: 'danger'};
const ORDER_LABELS: Record<string, string> = {paid: 'Paid', refunded: 'Refunded', pending: 'Not paid', failed: 'Failed'};

/** `/dashboard/employer/billing` (F18): the company's orders, newest first. */
export function EmployerBilling() {
  const orders = useInfiniteQuery(myOrdersQuery);
  const rows = orders.data?.pages.flatMap(page => page.items);
  const columns: Column<EmployerOrderRow>[] = [
    {key: 'date', header: 'Date', width: 'shrink', cell: o => ago(o.paidAt ?? o.createdAt)},
    {
      key: 'job',
      header: 'Job',
      cell: o => (
        <>
          <span className="cell-title">{o.jobTitle ?? 'Job listing'}</span>
          <span className="cell-sub">
            {o.number} · {o.tierName}
            {o.kind === 'renew' ? ' (renewal)' : ''}
          </span>
        </>
      ),
    },
    {key: 'amount', header: 'Amount', width: 'shrink', align: 'end', cell: o => (o.amountCents ? formatMoney(o.amountCents, o.currency) : 'Free')},
    {key: 'status', header: 'Status', width: 'shrink', cell: o => <StatusBadge tone={ORDER_TONES[o.status] ?? 'neutral'}>{ORDER_LABELS[o.status] ?? o.status}</StatusBadge>},
    {
      key: 'receipt',
      header: 'Receipt',
      actions: true,
      cell: o =>
        o.receiptUrl ? (
          <a href={o.receiptUrl} target="_blank" rel="noopener noreferrer">
            Receipt
          </a>
        ) : (
          <Link to="/employer/billing/$id/receipt" params={{id: String(o.id)}} aria-label={`Receipt for order ${o.number}`}>
            Receipt
          </Link>
        ),
    },
  ];
  return (
    <div className="app-page screen-employer-billing">
      <PageHeader title="Billing" description="Your orders and receipts, newest first." />
      <Card flush>
        <DataTable
          caption="Orders"
          columns={columns}
          rows={rows}
          rowKey={o => o.id}
          loading={orders.isPending}
          error={orders.error}
          empty={<EmptyState icon="inbox" title="No orders yet">Orders show here once you post or renew a job.</EmptyState>}
        />
      </Card>
      <LoadMore query={orders} />
    </div>
  );
}
