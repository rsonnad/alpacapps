// Stripe balance.pending is incoming settlement, not a queue of outgoing payments.
// All list endpoints are paginated; no recipient or transaction is silently truncated.
type Obj = Record<string, any>;
export type Row = {
  id: string;
  recipient: string;
  cents: number;
  currency: string;
  status: string;
  date: string;
  kind: string;
};
export type Report = { outgoing: Row[]; pending: Row[] };
export async function listStripe(
  get: (path: string) => Promise<Obj>,
  path: string,
  params: Record<string, string> = {},
): Promise<Obj[]> {
  const rows: Obj[] = [];
  const query = new URLSearchParams({ ...params, limit: "100" });
  while (true) {
    const page = await get(`${path}?${query}`);
    rows.push(...page.data);
    if (!page.has_more) return rows;
    if (!page.data.length) {
      throw new Error(`Empty Stripe page with has_more: ${path}`);
    }
    query.set("starting_after", page.data.at(-1).id);
  }
}
async function allDb(build: () => any): Promise<Obj[]> {
  const rows: Obj[] = [];
  for (let offset = 0;; offset += 500) {
    const { data, error } = await build().range(offset, offset + 499);
    if (error) {
      throw new Error(`Outgoing report database query: ${error.message}`);
    }
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
const objectId = (o: any): string => typeof o === "string" ? o : o?.id || "";
export async function collectOutgoing(
  sb: any,
  key: string,
  since: string,
  until: string,
  testMode: boolean,
  fetcher: typeof fetch = fetch,
): Promise<Report> {
  const getForAccount = async (
    path: string,
    account?: string,
  ): Promise<Obj> => {
    const response = await fetcher(`https://api.stripe.com/v1/${path}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        ...(account ? { "Stripe-Account": account } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(
        `Outgoing report Stripe ${
          path.split("?")[0]
        } failed (${response.status})`,
      );
    }
    return await response.json();
  };
  const get = (path: string) => getForAccount(path);
  const profiles = await allDb(() =>
    sb.from("associate_profiles").select(
      "id,app_user_id,stripe_connect_account_id",
    ).order("id")
  );
  const users = await allDb(() =>
    sb.from("app_users").select("id,display_name,email").order("id")
  );
  const names = new Map(users.map((u) => [u.id, u.display_name || u.email]));
  const byProfile = new Map(
    profiles.map((p) => [p.id, names.get(p.app_user_id)]),
  );
  const byAccount = new Map(
    profiles.filter((p) => p.stripe_connect_account_id).map(
      (p) => [p.stripe_connect_account_id, names.get(p.app_user_id)],
    ),
  );
  const queued = await allDb(() =>
    sb.from("payouts")
      .select(
        "id,associate_id,person_name,amount,external_payout_id,status,created_at",
      )
      .eq("payment_method", "stripe").eq("is_test", testMode).in("status", [
        "pending",
        "processing",
      ]).order("id")
  );
  const cache = new Map<string, Obj>();
  const load = async (id: string, path: string) => {
    if (!cache.has(id)) cache.set(id, await get(path));
    return cache.get(id)!;
  };
  const recipient = async (source: Obj): Promise<string> => {
    const destination = source.destination;
    const id = objectId(destination);
    if (id.startsWith("acct_")) {
      const known = byAccount.get(id);
      if (known) return `${known} (${id})`;
      const account = typeof destination === "object"
        ? destination
        : await load(id, `accounts/${id}`);
      const name = account.business_profile?.name || account.company?.name ||
        [account.individual?.first_name, account.individual?.last_name].filter(
          Boolean,
        ).join(" ") || account.email;
      return name ? `${name} (${id})` : `Recipient name unavailable (${id})`;
    }
    if (destination) {
      const bank = typeof destination === "object" ? destination : null;
      return bank
        ? `${
          bank.account_holder_name || bank.name || "Platform bank account"
        } — ${bank.bank_name || bank.brand || "bank/card"} ending ${
          bank.last4 || "?"
        } (${id})`
        : `Bank/card recipient name unavailable (${id})`;
    }
    if (source.object === "refund") {
      const chargeId = objectId(source.charge);
      const charge = typeof source.charge === "object"
        ? source.charge
        : chargeId
        ? await load(chargeId, `charges/${chargeId}?expand[]=customer`)
        : null;
      const customer = charge?.customer;
      return charge?.billing_details?.name || customer?.name ||
        charge?.billing_details?.email || customer?.email ||
        `Refund recipient name unavailable (${chargeId || source.id})`;
    }
    return source.object === "fee"
      ? "Stripe"
      : `Recipient name unavailable (${source.id || "no source"})`;
  };
  const bounds = {
    "created[gt]": String(Math.floor(Date.parse(since) / 1000)),
    "created[lte]": String(Math.floor(Date.parse(until) / 1000)),
  };
  const transactions = await listStripe(get, "balance_transactions", {
    ...bounds,
    "expand[]": "data.source",
  });
  const outgoing: Row[] = [];
  for (const tx of transactions) {
    // Include fees as well as principal debits. Fees deducted from incoming
    // payments also explain why the net movement differs from outgoing totals.
    if (tx.amount < 0) {
      let source = typeof tx.source === "object" && tx.source
        ? tx.source
        : { id: tx.source };
      if (source.object === "payout") {
        source = await load(
          source.id,
          `payouts/${source.id}?expand[]=destination`,
        );
      }
      const isFee = ["stripe_fee", "stripe_fx_fee", "tax_fee"].includes(
        tx.type,
      );
      outgoing.push({
        id: tx.id,
        recipient: isFee ? "Stripe" : await recipient(source),
        cents: -tx.amount,
        currency: tx.currency,
        status: source.object === "transfer"
          ? (source.reversed
            ? "Reversed"
            : source.amount_reversed
            ? "Sent to Stripe account; partially reversed"
            : "Sent to Stripe account")
          : source.status || tx.status,
        date: new Date(tx.created * 1000).toISOString(),
        kind: `${tx.type} · ${source.id || tx.id}${
          tx.description ? ` · ${tx.description}` : ""
        }`,
      });
    }
    if (tx.fee > 0) {
      outgoing.push({
        id: `${tx.id}:fee`,
        recipient: "Stripe",
        cents: tx.fee,
        currency: tx.currency,
        status: "Fee charged",
        date: new Date(tx.created * 1000).toISOString(),
        kind: `Processing fee · ${tx.id}`,
      });
    }
  }
  const pending: Row[] = [];
  // Stripe supports pending filtering; in_transit is filtered client-side from
  // the complete list because it isn't a documented list status parameter.
  const payouts = await listStripe(get, "payouts", {
    "expand[]": "data.destination",
  });
  for (
    const p of payouts.filter((p) =>
      ["pending", "in_transit"].includes(p.status)
    )
  ) {
    pending.push({
      id: p.id,
      recipient: await recipient(p),
      cents: p.amount,
      currency: p.currency,
      status: p.status,
      date: new Date((p.arrival_date || p.created) * 1000).toISOString(),
      kind: `Bank payout · ${p.id}`,
    });
  }
  // Connect bank delivery is separate from the platform's transfer. Include
  // pending/in-transit bank payouts for every connected account, not just workers.
  const accounts = await listStripe(get, "accounts");
  for (const account of accounts) {
    const accountName = byAccount.get(account.id) ||
      account.business_profile?.name ||
      account.company?.name ||
      [account.individual?.first_name, account.individual?.last_name].filter(
        Boolean,
      ).join(" ") || account.email || account.id;
    const bankPayouts = await listStripe(
      (path) => getForAccount(path, account.id),
      "payouts",
      { "expand[]": "data.destination" },
    );
    for (
      const p of bankPayouts.filter((p) =>
        ["pending", "in_transit"].includes(p.status)
      )
    ) {
      pending.push({
        id: p.id,
        recipient: `${accountName} (${account.id}) — ${await recipient(p)}`,
        cents: p.amount,
        currency: p.currency,
        status: p.status,
        date: new Date((p.arrival_date || p.created) * 1000).toISOString(),
        kind: `Connected-account bank payout · ${p.id}`,
      });
    }
  }
  for (const p of queued) {
    if (pending.some((row) => row.id === p.external_payout_id)) continue;
    // A processing Connect transfer already debited the platform balance.
    // Keep its pending bank delivery visible, but do not imply another debit.
    pending.push({
      id: p.id,
      recipient: p.person_name || byProfile.get(p.associate_id) ||
        `Recipient name unavailable (payout ${p.id})`,
      cents: Math.round(Number(p.amount) * 100),
      currency: "usd",
      status: p.external_payout_id
        ? `${p.status}; app record unconfirmed; already transferred (bank delivery not verified)`
        : `${p.status}; not yet sent`,
      date: p.created_at,
      kind: `Associate payout · ${p.external_payout_id || p.id}`,
    });
  }
  return { outgoing, pending };
}
export const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]!),
  );
const money = (r: Row) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: r.currency.toUpperCase(),
  }).format(r.cents / 100);
const date = (s: string) =>
  new Date(s).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " Central";
export function renderOutgoing(
  report: Report,
  since: string,
  until: string,
): { html: string; text: string } {
  let html = `<p>Activity: ${escapeHtml(date(since))} – ${
    escapeHtml(date(until))
  }.</p><p>Pending balance above is incoming money awaiting settlement. Pending money out below includes all outstanding Stripe payout records, even those created before this activity period. App records awaiting confirmation are listed separately: these funds were already transferred and may already have arrived at the bank. They are not additional unpaid obligations; do not add them to money out.</p>`;
  let text = `Activity: ${date(since)} – ${
    date(until)
  }.\nPending balance is incoming settlement, not pending money out. App confirmations are listed separately; these funds were already transferred and may already have arrived. Do not add them to money out.\n`;
  for (
    const [title, rows] of [["Money out", report.outgoing], [
      "Pending money out",
      report.pending.filter((r) =>
        !r.status.includes("app record unconfirmed")
      ),
    ], [
      "Transferred — app confirmation outstanding",
      report.pending.filter((r) => r.status.includes("app record unconfirmed")),
    ]] as const
  ) {
    html += `<h3>${title}</h3>`;
    text += `\n${title}\n`;
    if (!rows.length) {
      html += "<p>None.</p>";
      text += "None.\n";
      continue;
    }
    html +=
      '<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr><th align="left">Recipient / payment</th><th align="right">Amount</th><th align="left">Status / date</th></tr></thead><tbody>';
    for (const r of rows) {
      html += `<tr><td style="padding:10px 4px;border-bottom:1px solid #eee">${
        escapeHtml(r.recipient)
      }<br><small>${
        escapeHtml(r.kind)
      }</small></td><td style="padding:10px 4px;border-bottom:1px solid #eee;text-align:right">${
        escapeHtml(money(r))
      }</td><td style="padding:10px 4px;border-bottom:1px solid #eee">${
        escapeHtml(r.status)
      }<br><small>${escapeHtml(date(r.date))}</small></td></tr>`;
      text += `${r.recipient} | ${money(r)} | ${r.status} | ${
        date(r.date)
      } | ${r.kind}\n`;
    }
    html += "</tbody></table>";
  }
  return { html, text };
}
