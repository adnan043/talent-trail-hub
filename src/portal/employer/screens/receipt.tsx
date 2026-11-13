import {useQuery} from '@tanstack/react-query';
import {Link, useParams} from '@tanstack/react-router';

import {formatDate, formatMoney} from '../../../lib/format';
import {ApiError} from '../../api';
import {Button, buttonClass, DefinitionList, EmptyState, ErrorNote, initials, LoadingBlock, PageHeader} from '../../ui';
import {useSite} from '../../shared';
import {receiptQuery} from '../queries';

/** `/dashboard/employer/billing/$id/receipt` (F18): a printable receipt for a paid order. */
export function EmployerReceipt() {
  const {id} = useParams({strict: false}) as {id: string};
  const receipt = useQuery(receiptQuery(Number(id)));
  if (receipt.isPending) return <div className="app-page"><LoadingBlock rows={5} /></div>;
  if (receipt.error instanceof ApiError && receipt.error.status === 404) {
    return (
      <div className="app-page">
        <EmptyState icon="search" title="No such receipt" action={<Link className={buttonClass({variant: 'secondary'})} to="/employer/billing">Back to billing</Link>}>
          Receipts exist for paid orders only.
        </EmptyState>
      </div>
    );
  }
  if (receipt.error) return <div className="app-page"><ErrorNote error={receipt.error} /></div>;
  const r = receipt.data.receipt;
  const o = r.order;
  const site = useSite().data?.site;
  const logo = site?.logo;
  const rows = [
    {label: 'Order', value: o.number},
    {label: 'Paid on', value: formatDate(o.paidAt)},
    {label: 'Billed to', value: [r.company.name, r.company.location].filter(Boolean).join(', ')},
    ...(r.buyer.email ? [{label: 'Buyer', value: [r.buyer.name, r.buyer.email].filter(Boolean).join(' · ')}] : []),
    {label: 'Item', value: `${o.tierName}${o.kind === 'renew' ? ' (renewal)' : ''}: ${o.jobTitle ?? 'Job listing'}`},
    {label: 'Listing', value: `${o.durationDays} days${o.includesFeatured ? ', featured' : ''}`},
  ];
  return (
    <div className="app-page screen-receipt">
      <PageHeader
        title="Receipt"
        description={`Order ${o.number}`}
        actions={<Button variant="secondary" icon="file" onClick={() => window.print()}>Print</Button>}
      />
      <article className="receipt-sheet">
        <header className="receipt-head">
          <div className="receipt-brand">
            <span className="receipt-logo">{logo ? <img src={logo} alt="" width={52} height={52} decoding="async" /> : initials(r.boardName) || '·'}</span>
            <div>
              <p className="receipt-brand-name">{r.boardName}</p>
              <p className="receipt-meta">Payment receipt</p>
            </div>
          </div>
          <div className="receipt-status">
            <span className={`receipt-badge${r.refundedAt ? ' is-refunded' : ''}`}>{r.refundedAt ? 'Refunded' : 'Paid'}</span>
            <p className="receipt-meta">{formatDate(o.paidAt ?? o.createdAt)}</p>
          </div>
        </header>
        <div className="receipt-amount">
          <span className="receipt-meta">Amount {r.refundedAt ? 'refunded' : 'paid'}</span>
          <strong>{o.amountCents ? formatMoney(o.amountCents, o.currency) : 'Free'}</strong>
        </div>
        <DefinitionList items={[...rows, ...(r.refundedAt ? [{label: 'Refunded on', value: formatDate(r.refundedAt)}] : [])]} />
        <footer className="receipt-foot">Thank you for hiring with {r.boardName}.</footer>
      </article>
    </div>
  );
}
