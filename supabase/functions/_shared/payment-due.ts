/**
 * What a tenant owes right after signing a lease. Used by process-signature
 * (the lease-signed email) and deposit-deadline-check (the 24-hour follow-up).
 */

export interface PaymentDue {
  items: { label: string; amount: number }[];
  total: number;
  creditedToRent: boolean;
}

/**
 * A reservation deposit, when set, is the ask (credited toward first month's
 * rent). Otherwise it is the first rent payment plus the security deposit,
 * less a paid application fee.
 *
 * `excludePaid` drops items already marked paid, so a follow-up never asks
 * for money that has come in.
 */
export function computePaymentDueAtSigning(app: any, opts: { excludePaid?: boolean } = {}): PaymentDue {
  const num = (v: any) => Number(v) || 0;
  const skip = (paid: any) => opts.excludePaid && paid === true;
  const reservation = num(app?.reservation_deposit_amount);
  if (reservation > 0) {
    if (skip(app?.reservation_deposit_paid)) return { items: [], total: 0, creditedToRent: true };
    return { items: [{ label: 'Reservation Deposit', amount: reservation }], total: reservation, creditedToRent: true };
  }
  const items: { label: string; amount: number }[] = [];
  const firstRent = num(app?.move_in_deposit_amount);
  const security = num(app?.security_deposit_amount);
  const appFee = app?.application_fee_paid ? num(app?.application_fee_amount) : 0;
  if (firstRent > 0 && !skip(app?.move_in_deposit_paid)) items.push({ label: 'First Rent Payment', amount: firstRent });
  if (security > 0 && !skip(app?.security_deposit_paid)) items.push({ label: 'Security Deposit', amount: security });
  if (appFee > 0 && items.length > 0) items.push({ label: 'Application Fee Credit', amount: -appFee });
  const total = Math.max(0, Math.round(items.reduce((t, i) => t + i.amount, 0) * 100) / 100);
  return { items, total, creditedToRent: false };
}

export function formatChicagoDeadline(d: Date): string {
  return d.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Chicago', timeZoneName: 'short',
  });
}

export function formatMoney(n: number): string {
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
