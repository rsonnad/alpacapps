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
  /** Plain display fields for the email (no Stripe IDs). */
  name: string;
  note: string;
  label: string;
};
export type Report = { outgoing: Row[]; pending: Row[]; unpaid?: Row[] };
import { rollupEntries } from "../_shared/payout-breakdown.ts";
export const PAYMENTS_URL = "https://alpacaplayhouse.com/staff/payments.html";
/** Unconfirmed payouts older than this stay off the email (see PAYMENTS_URL). */
export const HISTORY_DAYS = 14;
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
      "id,app_user_id,stripe_connect_account_id,hourly_rate,daily_extra",
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
  const clean = (s: string) =>
    s.replace(/\s*\((?:acct|ba|card|ch|re|po|tr)_[^)]*\)/g, "")
      .replace(/\s*\((?:payout|no source)[^)]*\)/g, "").trim();
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
      const who = isFee ? "Stripe" : await recipient(source);
      const status = source.object === "transfer"
        ? (source.reversed
          ? "Reversed"
          : source.amount_reversed
          ? "Sent to Stripe account; partially reversed"
          : "Sent to Stripe account")
        : source.status || tx.status;
      outgoing.push({
        id: tx.id,
        recipient: who,
        cents: -tx.amount,
        currency: tx.currency,
        status,
        date: new Date(tx.created * 1000).toISOString(),
        kind: `${tx.type} · ${source.id || tx.id}${
          tx.description ? ` · ${tx.description}` : ""
        }`,
        name: clean(who),
        note: isFee
          ? "Stripe fee"
          : source.object === "refund"
          ? "Refund"
          : source.object === "payout"
          ? "Transfer to bank"
          : workNote(tx.description),
        label: source.object === "transfer"
          ? (source.reversed
            ? "Reversed"
            : source.amount_reversed
            ? "Partly reversed"
            : "Paid")
          : source.object === "refund"
          ? "Refunded"
          : isFee
          ? "Fee"
          : source.object === "payout"
          ? payoutLabel(source.status, source.arrival_date)
          : "Paid",
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
        name: "Stripe",
        note: "Processing fee",
        label: "Fee",
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
    const who = await recipient(p);
    pending.push({
      id: p.id,
      recipient: who,
      cents: p.amount,
      currency: p.currency,
      status: p.status,
      date: new Date((p.arrival_date || p.created) * 1000).toISOString(),
      kind: `Bank payout · ${p.id}`,
      name: clean(who),
      note: "Transfer to bank",
      label: payoutLabel(p.status, p.arrival_date),
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
      const bank = await recipient(p);
      pending.push({
        id: p.id,
        recipient: `${accountName} (${account.id}) — ${bank}`,
        cents: p.amount,
        currency: p.currency,
        status: p.status,
        date: new Date((p.arrival_date || p.created) * 1000).toISOString(),
        kind: `Connected-account bank payout · ${p.id}`,
        name: clean(accountName),
        note: "Stripe → their bank",
        label: payoutLabel(p.status, p.arrival_date),
      });
    }
  }
  for (const p of queued) {
    if (pending.some((row) => row.id === p.external_payout_id)) continue;
    // A processing Connect transfer already debited the platform balance.
    // Keep its pending bank delivery visible, but do not imply another debit.
    const who = p.person_name || byProfile.get(p.associate_id) ||
      `Recipient name unavailable (payout ${p.id})`;
    pending.push({
      id: p.id,
      recipient: who,
      cents: Math.round(Number(p.amount) * 100),
      currency: "usd",
      status: p.external_payout_id
        ? `${p.status}; app record unconfirmed; already transferred (bank delivery not verified)`
        : `${p.status}; not yet sent`,
      date: p.created_at,
      kind: `Associate payout · ${p.external_payout_id || p.id}`,
      name: clean(who) || "Name unavailable",
      note: "Associate pay",
      label: p.external_payout_id ? "Sent, unconfirmed" : "Not sent yet",
    });
  }
  const unpaid = await collectUnpaid(sb, profiles, names);
  return { outgoing, pending, unpaid };
}
/** Finished shifts not yet paid or claimed by a payout, one row per person. */
export async function collectUnpaid(
  sb: any,
  profiles: Obj[],
  names: Map<string, string>,
): Promise<Row[]> {
  const entries = await allDb(() =>
    sb.from("time_entries")
      .select("id,associate_id,clock_in,clock_out,hourly_rate")
      .eq("is_paid", false).not("clock_out", "is", null).order("id")
  );
  const claimed = new Set<string>();
  const ids = entries.map((e) => e.id);
  for (let i = 0; i < ids.length; i += 100) {
    const rows = await allDb(() =>
      sb.from("payout_time_entries").select("time_entry_id")
        .in("time_entry_id", ids.slice(i, i + 100)).order("time_entry_id")
    );
    rows.forEach((r) => claimed.add(r.time_entry_id));
  }
  const byPerson = new Map<string, Obj[]>();
  for (const e of entries.filter((e) => !claimed.has(e.id))) {
    byPerson.set(e.associate_id, [...(byPerson.get(e.associate_id) || []), e]);
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const rows: Row[] = [];
  for (const [associateId, list] of byPerson) {
    const profile = profileById.get(associateId) || {};
    const money = rollupEntries(
      list as any,
      parseFloat(profile.hourly_rate) || 0,
      undefined,
      parseFloat(profile.daily_extra) || 0,
    );
    if (money.totalHours <= 0) continue;
    list.sort((a, b) => Date.parse(a.clock_in) - Date.parse(b.clock_in));
    const first = list[0].clock_in, last = list.at(-1)!.clock_out;
    const span = shortDate(first) === shortDate(last)
      ? shortDate(last)
      : `${shortDate(first)} – ${shortDate(last)}`;
    const name = names.get(profile.app_user_id) || "Name unavailable";
    rows.push({
      id: `unpaid:${associateId}`,
      recipient: name,
      cents: Math.round(money.totalAmount * 100),
      currency: "usd",
      status: "unpaid",
      date: last,
      kind: `Unpaid hours · ${list.length} shifts`,
      name,
      note: `${money.totalHours.toFixed(2)} hrs · ${span}`,
      label: "Not paid yet",
    });
  }
  return rows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
const shortDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
/** "Auto payout: X — 3.42 hrs 2026-11-05 to 2026-11-05" → "3.42 hrs · Nov 5". */
export function workNote(description?: string | null): string {
  const m = String(description || "").match(
    /([\d.]+)\s*hrs?\b(?:\s+(\d{4}-\d{2}-\d{2})(?:\s+to\s+(\d{4}-\d{2}-\d{2}))?)?/i,
  );
  if (!m) return "";
  const [, hrs, from, to] = m;
  if (!from) return `${hrs} hrs`;
  const range = to && to !== from
    ? `${shortDay(from)} – ${shortDay(to)}`
    : shortDay(from);
  return `${hrs} hrs · ${range}`;
}
function payoutLabel(status: string, arrival?: number): string {
  if (status === "paid") return "Arrived";
  if (status === "failed" || status === "canceled") {
    return status === "failed" ? "Failed" : "Canceled";
  }
  return arrival
    ? `Arrives ${
      new Date(arrival * 1000).toLocaleDateString("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
      })
    }`
    : "On the way";
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
const usd = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
const money = (r: Row) => usd(r.cents, r.currency);
/** "Nov 5, 8:30 PM" in Central time. */
const when = (s: string) =>
  new Date(s).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const byDate = (a: Row, b: Row) => Date.parse(a.date) - Date.parse(b.date);
const isUnconfirmed = (r: Row) => r.status.includes("app record unconfirmed");
const C = {
  ink: "#1c1618",
  muted: "#7a7072",
  line: "#ece7e2",
  head: "#f5f1ec",
  bad: "#b5340c",
};
const transferRef = (kind: string) => kind.match(/\btr_[A-Za-z0-9]+/)?.[0];
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  });
/** One line per person, newest first; skips transfers already in "Paid out". */
export function unconfirmedByPerson(
  report: Report,
  asOf = new Date().toISOString(),
): Row[] {
  const shown = new Set(
    report.outgoing.map((r) => transferRef(r.kind)).filter(Boolean),
  );
  const groups = new Map<string, Row[]>();
  const cutoff = Date.parse(asOf) - HISTORY_DAYS * 86400000;
  for (const r of report.pending.filter(isUnconfirmed)) {
    if (Date.parse(r.date) < cutoff) continue;
    const ref = transferRef(r.kind);
    if (ref && shown.has(ref)) continue;
    groups.set(r.name, [...(groups.get(r.name) || []), r]);
  }
  return [...groups.entries()].map(([name, rows]) => {
    rows.sort(byDate);
    const first = rows[0].date, last = rows.at(-1)!.date;
    const span = shortDate(first) === shortDate(last)
      ? shortDate(last)
      : `${shortDate(first)} – ${shortDate(last)}`;
    return {
      ...rows.at(-1)!,
      id: `unconfirmed:${name}`,
      cents: rows.reduce((t, r) => t + r.cents, 0),
      name,
      note: rows.length === 1 ? "1 payment" : `${rows.length} payments · ${span}`,
      label: "Sent",
    };
  }).sort((a, b) => byDate(b, a));
}
type Section = {
  title: string;
  blurb: string;
  rows: Row[];
  empty: string;
  more?: boolean;
};
export function sections(
  report: Report,
  asOf = new Date().toISOString(),
): Section[] {
  // Fees are folded into one line so people stay the focus.
  const fees = report.outgoing.filter((r) => r.name === "Stripe");
  const paid = report.outgoing.filter((r) => r.name !== "Stripe").sort(byDate);
  if (fees.length) {
    const cents = fees.reduce((s, r) => s + r.cents, 0);
    const last = fees.map((r) => r.date).sort().at(-1)!;
    paid.push({
      ...fees[0],
      id: "fees",
      cents,
      date: last,
      name: "Stripe fees",
      note: fees.length > 1 ? `${fees.length} charges` : fees[0].note,
      label: "Fee",
      recipient: "Stripe",
    });
  }
  return [
    {
      title: "Paid out",
      blurb: "",
      rows: paid,
      empty: "No money went out.",
    },
    {
      title: "Waiting to go out",
      blurb: "",
      rows: report.pending.filter((r) => !isUnconfirmed(r)).sort(byDate),
      empty: "Nothing waiting.",
    },
    {
      title: "Hours worked, not paid yet",
      blurb: "Finished shifts with no payout yet. Amounts are estimates.",
      rows: report.unpaid || [],
      empty: "None.",
    },
    {
      title: `Sent in the last ${HISTORY_DAYS} days, awaiting confirmation`,
      blurb:
        "Already paid. Listed so nobody gets paid twice; not money still owed.",
      rows: unconfirmedByPerson(report, asOf),
      empty: "",
      more: true,
    },
  ];
}
export function renderOutgoing(
  report: Report,
  since: string,
  until: string,
): { html: string; text: string } {
  const td = `padding:10px 8px;border-bottom:1px solid ${C.line};vertical-align:top;`;
  const th =
    `padding:8px;font-size:11px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:0.5px;background:${C.head};`;
  let html = `<p style="margin:0 0 20px;color:${C.muted};font-size:13px;">${
    escapeHtml(when(since))
  } – ${escapeHtml(when(until))} (Central time)</p>`;
  let text = `${when(since)} – ${when(until)} (Central time)\n`;
  for (const s of sections(report, until)) {
    if (!s.rows.length && !s.empty) continue;
    const total = s.rows.reduce((t, r) => t + r.cents, 0);
    html += `<h3 style="margin:24px 0 6px;font-size:16px;color:${C.ink};">${
      escapeHtml(s.title)
    }${
      s.rows.length
        ? ` <span style="font-weight:400;color:${C.muted};">· ${
          escapeHtml(usd(total))
        }</span>`
        : ""
    }</h3>`;
    text += `\n${s.title}${s.rows.length ? ` — ${usd(total)}` : ""}\n`;
    if (s.blurb) {
      html += `<p style="margin:0 0 8px;color:${C.muted};font-size:12px;">${
        escapeHtml(s.blurb)
      }</p>`;
      text += `${s.blurb}\n`;
    }
    if (!s.rows.length) {
      html += `<p style="margin:0;color:${C.muted};font-size:14px;">${
        escapeHtml(s.empty)
      }</p>`;
      text += `${s.empty}\n`;
      continue;
    }
    html +=
      `<table role="presentation" style="border-collapse:collapse;width:100%;font-size:14px;color:${C.ink};"><tr><th align="left" style="${th}width:96px;">When</th><th align="left" style="${th}">Who</th><th align="right" style="${th}">Amount</th></tr>`;
    for (const r of s.rows) {
      const flag = /reversed|failed|canceled/i.test(r.label);
      html += `<tr><td style="${td}white-space:nowrap;color:${C.muted};font-size:13px;">${
        escapeHtml(when(r.date)).replace(", ", ",<br>")
      }</td><td style="${td}"><strong>${escapeHtml(r.name)}</strong>${
        r.note
          ? `<br><span style="color:${C.muted};font-size:12px;">${
            escapeHtml(r.note)
          }</span>`
          : ""
      }</td><td style="${td}text-align:right;white-space:nowrap;"><strong>${
        escapeHtml(money(r))
      }</strong><br><span style="font-size:12px;color:${
        flag ? C.bad : C.muted
      };">${escapeHtml(r.label)}</span></td></tr>`;
      text += `  ${when(r.date).padEnd(18)} ${r.name}${
        r.note ? ` (${r.note})` : ""
      } — ${money(r)} · ${r.label}\n`;
    }
    html += "</table>";
    if (s.more) {
      html += `<p style="margin:8px 0 0;font-size:13px;"><a href="${PAYMENTS_URL}" style="color:${C.ink};">See older payouts on the Payments page →</a></p>`;
      text += `Older payouts: ${PAYMENTS_URL}\n`;
    }
  }
  return { html, text };
}
