// Confirms Stripe Connect payouts that the app still marks "processing".
//
// Why this exists: stripe-payout writes a row as "processing" when it creates a
// Connect transfer (tr_...). The webhook used to wait for `transfer.paid`, but
// Stripe stopped sending that event in API 2017-04-06; modern Connect
// transfers have no status and land in the connected account at once. So
// nothing ever marked these rows paid.
//
// A row is "completed" only when Stripe shows the money reached the person's
// bank: the transfer is not reversed, its amount matches, and the connected
// account's automatic bank payout that carried it is `paid`.
type Obj = Record<string, any>;

export type Decision =
  | "complete" // bank payout paid
  | "returned" // transfer fully reversed
  | "wait" // bank payout on its way, or too early to tell
  | "review"; // something a person should look at

export type Confirmation = {
  payout_id: string;
  ledger_id: string | null;
  associate_id: string | null;
  amount: number;
  transfer_id: string;
  created_at: string;
  decision: Decision;
  reason: string;
  bank_payout_id?: string;
  bank_arrival?: string;
};

/** Days without any bank payout before a row is flagged for review. */
export const NO_BANK_PAYOUT_REVIEW_DAYS = 14;

export async function checkProcessingStripePayouts(
  sb: any,
  key: string,
  testMode: boolean,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<Confirmation[]> {
  const get = async (path: string, account?: string): Promise<Obj> => {
    const res = await fetcher(`https://api.stripe.com/v1/${path}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        ...(account ? { "Stripe-Account": account } : {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        `Stripe ${path.split("?")[0]} ${res.status}: ${body?.error?.message ?? ""}`,
      );
      (err as any).status = res.status;
      throw err;
    }
    return body;
  };
  const listAll = async (path: string, params: Record<string, string>, account?: string) => {
    const out: Obj[] = [];
    const q = new URLSearchParams({ ...params, limit: "100" });
    while (true) {
      const page = await get(`${path}?${q}`, account);
      out.push(...page.data);
      if (!page.has_more || !page.data.length) return out;
      q.set("starting_after", page.data.at(-1).id);
    }
  };

  const { data: rows, error } = await sb.from("payouts")
    .select("id,ledger_id,associate_id,amount,external_payout_id,created_at")
    .eq("payment_method", "stripe").eq("is_test", testMode)
    .eq("status", "processing").like("external_payout_id", "tr_%")
    .order("created_at");
  if (error) throw new Error(`processing payouts query: ${error.message}`);
  if (!rows?.length) return [];

  const transfers = new Map<string, Obj>();
  for (const r of rows) {
    if (!transfers.has(r.external_payout_id)) {
      transfers.set(r.external_payout_id, await get(`transfers/${r.external_payout_id}`));
    }
  }

  // For each connected account, map the incoming payment (py_...) to the bank
  // payout that carried it. Only automatic payouts can be traced this way.
  const byAccount = new Map<string, number>();
  for (const t of transfers.values()) {
    const prev = byAccount.get(t.destination);
    byAccount.set(t.destination, prev === undefined ? t.created : Math.min(prev, t.created));
  }
  const bankPayoutFor = new Map<string, Obj>();
  for (const [account, earliest] of byAccount) {
    const payouts = await listAll("payouts", {
      "arrival_date[gte]": String(earliest - 86400),
    }, account);
    for (const po of payouts) {
      if (po.status === "canceled") continue;
      let txns: Obj[];
      try {
        txns = await listAll("balance_transactions", { payout: po.id }, account);
      } catch (e) {
        if ((e as any).status === 400) continue; // manual payout: not traceable
        throw e;
      }
      for (const bt of txns) {
        const src = typeof bt.source === "string" ? bt.source : bt.source?.id;
        if (src) bankPayoutFor.set(src, po);
      }
    }
  }

  return rows.map((r: Obj): Confirmation => {
    const t = transfers.get(r.external_payout_id)!;
    const base = {
      payout_id: r.id,
      ledger_id: r.ledger_id ?? null,
      associate_id: r.associate_id ?? null,
      amount: Number(r.amount),
      transfer_id: r.external_payout_id,
      created_at: r.created_at,
    };
    const cents = Math.round(Number(r.amount) * 100);
    if (t.amount_reversed >= t.amount && t.amount > 0) {
      return { ...base, decision: "returned", reason: "transfer fully reversed" };
    }
    if (t.amount_reversed > 0) {
      return { ...base, decision: "review", reason: `partly reversed (${t.amount_reversed}¢)` };
    }
    if (t.amount !== cents) {
      return { ...base, decision: "review", reason: `amount mismatch: Stripe ${t.amount}¢, app ${cents}¢` };
    }
    const po = bankPayoutFor.get(t.destination_payment);
    if (po) {
      const extra = {
        bank_payout_id: po.id,
        bank_arrival: new Date(po.arrival_date * 1000).toISOString().slice(0, 10),
      };
      if (po.status === "paid") {
        return { ...base, ...extra, decision: "complete", reason: "bank payout paid" };
      }
      if (po.status === "pending" || po.status === "in_transit") {
        return { ...base, ...extra, decision: "wait", reason: `bank payout ${po.status}` };
      }
      return { ...base, ...extra, decision: "review", reason: `bank payout ${po.status}` };
    }
    const ageDays = (now / 1000 - t.created) / 86400;
    return ageDays < NO_BANK_PAYOUT_REVIEW_DAYS
      ? { ...base, decision: "wait", reason: "no bank payout yet" }
      : { ...base, decision: "review", reason: `no bank payout after ${Math.floor(ageDays)} days` };
  });
}

/** Writes "complete" and "returned" decisions; mirrors the webhook's updates. */
export async function applyConfirmations(sb: any, list: Confirmation[]) {
  let completed = 0, returned = 0;
  const now = new Date().toISOString();
  for (const c of list) {
    if (c.decision !== "complete" && c.decision !== "returned") continue;
    const done = c.decision === "complete";
    const { data, error } = await sb.from("payouts").update({
      status: done ? "completed" : "returned",
      updated_at: now,
      ...(done ? {} : { error_message: "transfer.reversed" }),
    }).eq("id", c.payout_id).eq("status", "processing").select("id");
    if (error) throw new Error(`payout ${c.payout_id} update: ${error.message}`);
    if (!data?.length) continue; // changed by someone else meanwhile
    if (c.ledger_id) {
      const { error: lErr } = await sb.from("ledger").update({
        status: done ? "completed" : "failed",
        updated_at: now,
      }).eq("id", c.ledger_id);
      if (lErr) throw new Error(`ledger ${c.ledger_id} update: ${lErr.message}`);
    }
    if (done) completed++;
    else returned++;
  }
  return { completed, returned };
}
