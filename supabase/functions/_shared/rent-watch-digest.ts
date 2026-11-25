/**
 * Rent watch digest (owner only), run as a mode of payment-overdue-check (the project is at the
 * edge-function limit, so it cannot be a function of its own).
 *
 * pg_cron job 'rent-watch-digest-daily' calls payment-overdue-check with {"mode":"rent_watch"}.
 * For each active row in public.rent_watch it checks the ledger for this month's rent (and last
 * month's, if still unpaid). It emails the owner on the 1st and 2nd of every month, and after that
 * every day while any rent is still missing. It never emails tenants.
 *
 * Tenant names and amounts live in the rent_watch table, never in this repo.
 * Test without sending: POST {"mode":"rent_watch","dry_run":true,"today":"2026-12-02"}
 */

import { SENDER_MAP } from "./template-engine.ts";
import { checkPeriod, shouldSendDigest, type LedgerRow, type PeriodResult, type RentWatch } from "./rent-watch.ts";

const OWNER_EMAIL = Deno.env.get("RENT_WATCH_TO") || "alpacaplayhouse@gmail.com";

function chicagoToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function monthName(month: string): string {
  return new Date(month + "-01T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function days(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

function describe(r: PeriodResult): string {
  switch (r.state) {
    case "paid": return `Received ${money(r.received)}`;
    case "waiting": return "Not due yet";
    case "due_today": return `Due today, not received yet (${money(r.expected)})`;
    case "partial": return `Part paid: ${money(r.received)} received, ${money(r.owed)} still missing, ${days(r.daysLate)} after the due date`;
    case "late": return `Not received, ${money(r.owed)}, ${days(r.daysLate)} after the due date`;
    default: return "Not active";
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const FOOTER =
  "This counts what is recorded in the accounting ledger. If you can see the money in your bank or app but it shows here as not received, record it in accounting and it will drop off this list. " +
  "US Bank Zelle emails do not name the payer, so Zelle payments often need to be recorded by hand. " +
  "This is an owner-only note; tenants are not emailed.";

export async function runRentWatchDigest(supabase: any, body: any): Promise<Response> {
  try {
    const today: string = /^\d{4}-\d{2}-\d{2}$/.test(body.today || "") ? body.today : chicagoToday();
    const dryRun = body.dry_run === true;
    const month = today.slice(0, 7);
    const prev = prevMonth(month);

    const { data: watches, error: wErr } = await supabase.from("rent_watch").select("*").eq("is_active", true).order("label");
    if (wErr) throw wErr;
    if (!watches?.length) return json({ ok: true, note: "no active rent_watch rows", today });

    const since = new Date(Date.parse(`${prev}-01T12:00:00Z`) - 20 * 86400000).toISOString().slice(0, 10);
    const { data: ledger, error: lErr } = await supabase
      .from("ledger")
      .select("person_name, amount, transaction_date, period_start, period_end, status, is_test, direction")
      .eq("direction", "income")
      .gte("transaction_date", since);
    if (lErr) throw lErr;
    const rows = (ledger || []) as LedgerRow[];

    const results: PeriodResult[] = [];
    for (const w of watches as RentWatch[]) {
      results.push(checkPeriod(w, rows, month, today));
      const p = checkPeriod(w, rows, prev, today);
      if (p.state === "late" || p.state === "partial") results.push(p);
    }
    const active = results.filter((r) => r.state !== "inactive");
    const unpaid = active.filter((r) => r.state === "late" || r.state === "partial");
    const thisMonth = active.filter((r) => r.month === month);
    const received = thisMonth.filter((r) => r.state === "paid").length;
    const send = shouldSendDigest(today, unpaid.length > 0);

    const lines = active.map((r) => `${r.label} (${monthName(r.month)}): ${describe(r)}`);
    const subject = unpaid.length
      ? `Rent check ${today}: ${unpaid.length} not received`
      : `Rent check ${today}: ${received} of ${thisMonth.length} received`;
    const text = [`Rent check for ${today}`, "", ...lines, "", FOOTER].join("\n");
    const html = `<div style="font-family:-apple-system,sans-serif;max-width:600px;"><h2 style="margin:0 0 12px;">Rent check ${today}</h2><ul style="padding-left:18px;line-height:1.6;">${
      active.map((r) => `<li><strong>${esc(r.label)}</strong> (${monthName(r.month)}): ${esc(describe(r))}</li>`).join("")
    }</ul><p style="color:#555;font-size:13px;">${esc(FOOTER)}</p></div>`;

    if (dryRun || !send) {
      return json({ ok: true, today, would_send: send, sent: false, dry_run: dryRun, subject, lines });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY not configured" }, 500);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: SENDER_MAP.pai.from, reply_to: SENDER_MAP.pai.reply_to, to: [OWNER_EMAIL], subject, html, text }),
    });
    if (!res.ok) return json({ error: "email failed", detail: await res.text() }, 502);
    return json({ ok: true, today, sent: true, subject, lines });
  } catch (err) {
    console.error("rent-watch-digest error:", err);
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
}
