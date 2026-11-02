import {CheckoutError, openCheckout} from '../../lib/checkout-session';
import {siteCheckoutTransport} from '../../lib/checkout-transport';
import type {StartedCheckout} from '../../lib/types-employer';

/**
 * Opens a listing checkout the SERVER started (post-a-job, renew), without leaving the site
 * (docs/agent/payments.md): the provider's popup or payment window over the dashboard. A form
 * that must sit in the page (`element`, Stripe) opens on the site's checkout page, which loads
 * the provider's script under its own CSP; it comes back to `/dashboard/employer/jobs` paid.
 *
 * Resolves when the checkout is open; `onDismiss` when the buyer closed it without paying.
 */
export async function openListingCheckout(checkout: StartedCheckout, onDismiss: () => void): Promise<void> {
  if (checkout.embedded.kind === 'element') {
    window.location.assign(`/checkout/?id=${encodeURIComponent(checkout.id)}`);
    return;
  }
  try {
    await openCheckout(checkout, {
      onDismiss: () => onDismiss(),
      getStatus: () => siteCheckoutTransport.getStatus(checkout.id),
    });
  } catch (err) {
    throw err instanceof CheckoutError ? err : new Error('The payment window could not be opened. Try again.');
  }
}

/** After paying: confirm with the platform (this also records the order, in the Preview too). */
export async function confirmCheckout(id: string): Promise<'paid' | 'open' | 'failed'> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const status = await siteCheckoutTransport.getStatus(id).catch(() => null);
    if (status === 'paid') return 'paid';
    if (status === 'failed' || status === 'expired') return 'failed';
    await new Promise(resolve => window.setTimeout(resolve, 2000));
  }
  return 'open';
}
