import {
  applyConfirmations,
  checkProcessingStripePayouts,
} from "./stripe-payout-confirm.ts";

const assertEq = (a: unknown, b: unknown, msg = "") => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
};

const DAY = 86400;
const NOW = 1_790_000_000; // seconds

function fakeDb(tables: Record<string, any[]>) {
  const updates: { table: string; id: string; patch: any }[] = [];
  return {
    updates,
    tables,
    from(table: string) {
      let rows = tables[table];
      let patch: any = null;
      const q: any = {
        select: () => q,
        order: () => q,
        like: (k: string, v: string) => {
          rows = rows.filter((r) => String(r[k]).startsWith(v.replace("%", "")));
          return q;
        },
        eq: (k: string, v: unknown) => {
          rows = rows.filter((r) => r[k] === v);
          return q;
        },
        update: (p: any) => {
          patch = p;
          return q;
        },
        then: (resolve: any) => {
          if (patch) {
            for (const r of rows) {
              Object.assign(r, patch);
              updates.push({ table, id: r.id, patch });
            }
          }
          resolve({ data: rows.map((r) => ({ ...r })), error: null });
        },
      };
      return q;
    },
  };
}

function fakeStripe() {
  const transfers: Record<string, any> = {
    tr_paid: { id: "tr_paid", amount: 10000, amount_reversed: 0, destination: "acct_A", destination_payment: "py_1", created: NOW - 30 * DAY },
    tr_transit: { id: "tr_transit", amount: 5000, amount_reversed: 0, destination: "acct_A", destination_payment: "py_2", created: NOW - 1 * DAY },
    tr_rev: { id: "tr_rev", amount: 2000, amount_reversed: 2000, destination: "acct_B", destination_payment: "py_3", created: NOW - 20 * DAY },
    tr_lost: { id: "tr_lost", amount: 3000, amount_reversed: 0, destination: "acct_B", destination_payment: "py_4", created: NOW - 40 * DAY },
    tr_new: { id: "tr_new", amount: 1500, amount_reversed: 0, destination: "acct_B", destination_payment: "py_5", created: NOW - 1 * DAY },
  };
  const payouts: Record<string, any[]> = {
    acct_A: [
      { id: "po_A1", status: "paid", arrival_date: NOW - 27 * DAY },
      { id: "po_A2", status: "in_transit", arrival_date: NOW + DAY },
    ],
    acct_B: [{ id: "po_Bmanual", status: "paid", arrival_date: NOW - 10 * DAY }],
  };
  const txns: Record<string, any[]> = {
    po_A1: [{ source: "py_1" }, { source: "po_A1" }],
    po_A2: [{ source: "py_2" }],
  };
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/v1/", "");
    const account = (init?.headers as Record<string, string>)["Stripe-Account"];
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status });
    if (path.startsWith("transfers/")) return json(transfers[path.slice(10)]);
    if (path === "payouts") return json({ data: payouts[account] ?? [], has_more: false });
    if (path === "balance_transactions") {
      const po = url.searchParams.get("payout")!;
      if (!txns[po]) return json({ error: { message: "manual payout" } }, 400);
      return json({ data: txns[po], has_more: false });
    }
    throw new Error(`unexpected ${path}`);
  }) as typeof fetch;
}

const row = (id: string, tr: string, amount: number, extra: any = {}) => ({
  id, ledger_id: `led_${id}`, associate_id: "ap", amount: String(amount),
  external_payout_id: tr, created_at: "2026-05-01", payment_method: "stripe",
  is_test: false, status: "processing", ...extra,
});

Deno.test("classifies each stuck payout from Stripe and writes only confirmed ones", async () => {
  const db = fakeDb({
    payouts: [
      row("p1", "tr_paid", 100),
      row("p2", "tr_transit", 50),
      row("p3", "tr_rev", 20),
      row("p4", "tr_lost", 30),
      row("p5", "tr_new", 15),
      row("p6", "tr_paid", 99), // amount mismatch with Stripe
      row("p7", "tr_paid", 100, { is_test: true }), // other mode: ignored
      row("p8", "tr_paid", 100, { status: "completed" }), // already done: ignored
    ],
    ledger: ["p1", "p3"].map((id) => ({ id: `led_${id}`, status: "pending" })),
  });
  const list = await checkProcessingStripePayouts(db, "sk", false, fakeStripe(), NOW * 1000);
  assertEq(
    list.map((c) => [c.payout_id, c.decision]),
    [["p1", "complete"], ["p2", "wait"], ["p3", "returned"], ["p4", "review"], ["p5", "wait"], ["p6", "review"]],
  );
  assertEq(list[0].bank_payout_id, "po_A1");

  const result = await applyConfirmations(db, list);
  assertEq(result, { completed: 1, returned: 1 });
  const status = Object.fromEntries(db.tables.payouts.map((r) => [r.id, r.status]));
  assertEq([status.p1, status.p2, status.p3, status.p4], ["completed", "processing", "returned", "processing"]);
  const ledger = Object.fromEntries(db.tables.ledger.map((r) => [r.id, r.status]));
  assertEq([ledger.led_p1, ledger.led_p3], ["completed", "failed"]);

  // Running again changes nothing.
  assertEq(await applyConfirmations(db, list), { completed: 0, returned: 0 });
});
