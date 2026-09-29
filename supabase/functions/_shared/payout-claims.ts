/**
 * Server-side payout bookkeeping shared by stripe-payout and paypal-payout.
 * pay-pending-associates follows the same protocol inline.
 *
 * Protocol (the only safe order for a money-moving call):
 *   1. insert a `payouts` row with status 'pending'
 *   2. claimEntries(): insert payout_time_entries rows. UNIQUE(time_entry_id)
 *      means two concurrent payouts can never both own an entry; the loser
 *      gets an error and must stop BEFORE calling the payment provider.
 *   3. call the provider. On failure: releaseClaim() so the entries are
 *      payable again, and return the error.
 *   4. on success: write the ledger row, then markEntriesPaid(). This runs even
 *      if the ledger write failed, because the money has moved and an entry
 *      left unpaid would be paid a second time by the next run.
 *
 * Why this lives server-side: the staff UI used to mark entries paid itself
 * after the edge function returned. The weekly-approval path (approve-email →
 * stripe-payout) has no client, so its entries stayed unpaid and the nightly
 * auto-payout could pay them again. The client call also wrote a second ledger
 * row per payout.
 */

/** Entry ids (from `ids`) already owned by some payout. */
export async function findClaimedEntries(supabase: any, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from('payout_time_entries')
    .select('time_entry_id')
    .in('time_entry_id', ids);
  return (data || []).map((r: { time_entry_id: string }) => r.time_entry_id);
}

/** Atomically claim entries for a payout. Returns an error message on conflict. */
export async function claimEntries(supabase: any, payoutId: string, ids: string[]): Promise<string | null> {
  const { error } = await supabase
    .from('payout_time_entries')
    .insert(ids.map((id) => ({ payout_id: payoutId, time_entry_id: id })));
  return error ? error.message : null;
}

/** Undo a claim and its placeholder payout row. Only call when NO money moved. */
export async function releaseClaim(supabase: any, payoutId: string): Promise<void> {
  await supabase.from('payout_time_entries').delete().eq('payout_id', payoutId);
  await supabase.from('payouts').delete().eq('id', payoutId);
}

/**
 * Mark entries paid. Sets payment_status (the source of truth); the
 * time_entries_payment_status_sync trigger mirrors it to legacy is_paid.
 */
export async function markEntriesPaid(supabase: any, ids: string[], ledgerId: string | null): Promise<string | null> {
  const { error } = await supabase
    .from('time_entries')
    .update({ payment_status: 'paid', payment_id: ledgerId })
    .in('id', ids);
  return error ? error.message : null;
}
