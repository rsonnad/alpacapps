import { collectOutgoing, listStripe, renderOutgoing } from "./outgoing.ts";
const assert = (value: unknown, msg = "Assertion failed") => {
  if (!value) throw new Error(msg);
};
Deno.test("Stripe pagination includes every recipient beyond the first 100", async () => {
  const calls: string[] = [];
  const rows = await listStripe(async (path) => {
    calls.push(path);
    return path.includes("starting_after=")
      ? { data: [{ id: "last" }], has_more: false }
      : {
        data: Array.from({ length: 100 }, (_, i) => ({ id: `tx_${i}` })),
        has_more: true,
      };
  }, "balance_transactions");
  assert(rows.length === 101);
  assert(calls[1].includes("starting_after=tx_99"));
});
function database(tables: Record<string, any[]>) {
  return {
    from(name: string) {
      let rows = tables[name] || [];
      const q: any = {
        select: () => q,
        order: () => q,
        eq: (k: string, v: any) => {
          rows = rows.filter((r) => r[k] === v);
          return q;
        },
        in: (k: string, vs: any[]) => {
          rows = rows.filter((r) => vs.includes(r[k]));
          return q;
        },
        range: (start: number, end: number) => ({
          data: rows.slice(start, end + 1),
          error: null,
        }),
      };
      return q;
    },
  };
}
Deno.test("report resolves multiple recipients, fees, refund, and old pending; excludes tests and non-Stripe", async () => {
  const db = database({
    associate_profiles: [{
      id: "ap_a",
      app_user_id: "user_a",
      stripe_connect_account_id: "acct_a",
    }],
    app_users: [{ id: "user_a", display_name: "Alice & Co" }],
    payouts: [
      {
        id: "queued",
        associate_id: "ap_a",
        amount: 25,
        payment_method: "stripe",
        is_test: false,
        status: "pending",
        created_at: "2020-01-01",
        external_payout_id: null,
      },
      {
        id: "test",
        amount: 999,
        payment_method: "stripe",
        is_test: true,
        status: "pending",
      },
      {
        id: "paypal",
        amount: 999,
        payment_method: "paypal",
        is_test: false,
        status: "pending",
      },
    ],
  });
  const fetcher = (async (input: any, init?: RequestInit) => {
    const url = new URL(input);
    let data: any;
    if (url.pathname.endsWith("/accounts")) {
      data = { has_more: false, data: [{ id: "acct_a" }] };
    } else if (url.pathname.endsWith("/balance_transactions")) {
      data = {
        has_more: false,
        data: [
          {
            id: "tx1",
            amount: -7194,
            fee: 0,
            currency: "usd",
            created: 1700000000,
            type: "transfer",
            source: { id: "tr_1", object: "transfer", destination: "acct_a" },
          },
          {
            id: "tx2",
            amount: -2000,
            fee: 0,
            currency: "usd",
            created: 1700000000,
            type: "transfer",
            source: { id: "tr_2", object: "transfer", destination: "acct_b" },
          },
          {
            id: "tx3",
            amount: 10000,
            fee: 321,
            currency: "usd",
            created: 1700000000,
            type: "charge",
            source: { id: "ch_1" },
          },
          {
            id: "tx4",
            amount: -500,
            fee: 0,
            currency: "usd",
            created: 1700000000,
            type: "refund",
            source: {
              id: "re_1",
              object: "refund",
              charge: "ch_refund",
              status: "succeeded",
            },
          },
        ],
      };
    } else if (url.pathname.endsWith("/accounts/acct_b")) {
      data = { id: "acct_b", business_profile: { name: "Bob <LLC>" } };
    } else if (url.pathname.endsWith("/charges/ch_refund")) {
      data = { billing_details: { name: "Refund Customer" } };
    } else if (url.pathname.endsWith("/payouts")) {
      data = {
        has_more: false,
        data: [{
          id: new Headers(init?.headers).get("Stripe-Account")
            ? "po_connected"
            : "po_1",
          amount: 1100,
          currency: "usd",
          status: "in_transit",
          created: 1700000000,
          destination: {
            id: "ba_1",
            account_holder_name: "Owner",
            bank_name: "Bank",
            last4: "1234",
          },
        }],
      };
    } else throw new Error(`Unexpected request: ${url.pathname}`);
    return new Response(JSON.stringify(data));
  }) as typeof fetch;
  const report = await collectOutgoing(
    db,
    "fake",
    "2023-11-01",
    "2023-12-01",
    false,
    fetcher,
  );
  assert(report.outgoing.length === 4);
  assert(report.outgoing[0].recipient === "Alice & Co (acct_a)");
  assert(report.outgoing[1].recipient === "Bob <LLC> (acct_b)");
  assert(report.outgoing[2].recipient === "Stripe");
  assert(report.outgoing[3].recipient === "Refund Customer");
  assert(report.pending.length === 3);
  assert(report.pending[1].recipient.includes("Alice & Co"));
  assert(report.pending[0].recipient.includes("Owner"));
  assert(report.pending[2].cents === 2500);
  const rendered = renderOutgoing(report, "2023-11-01", "2023-12-01");
  assert(rendered.html.includes("Alice &amp; Co"));
  assert(rendered.html.includes("Bob &lt;LLC&gt;"));
  assert(rendered.text.includes("$71.94"));
  assert(rendered.text.includes("Refund Customer"));
});
Deno.test("partial API failure fails the report rather than silently omitting recipients", async () => {
  let failed = false;
  try {
    await collectOutgoing(
      database({}),
      "fake",
      "2023-11-01",
      "2023-12-01",
      false,
      (async () => new Response("denied", { status: 403 })) as typeof fetch,
    );
  } catch {
    failed = true;
  }
  assert(failed);
});
