import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkPeriod, shouldSendDigest, type LedgerRow, type RentWatch } from "./rent-watch.ts";

const watch: RentWatch = {
  label: "Tenant A", match_names: ["tenant a"], expected_amount: 495, due_day: 1, prepay_days: 14,
  starts_on: "2026-01-01", ends_on: null,
};
const row = (o: Partial<LedgerRow>): LedgerRow => ({
  person_name: "TENANT A", amount: 495, transaction_date: "2026-11-03", period_start: null, period_end: null,
  status: "completed", is_test: false, direction: "income", ...o,
});

Deno.test("paid in the month, no period set", () => {
  const r = checkPeriod(watch, [row({})], "2026-11", "2026-11-10");
  assertEquals(r.state, "paid");
  assertEquals(r.received, 495);
});

Deno.test("paid early (within prepay window) counts for next month", () => {
  const r = checkPeriod(watch, [row({ transaction_date: "2026-11-20" })], "2026-12", "2026-12-02");
  assertEquals(r.state, "paid");
});

Deno.test("paid too early (outside window) does not count", () => {
  const r = checkPeriod(watch, [row({ transaction_date: "2026-11-10" })], "2026-12", "2026-12-02");
  assertEquals(r.state, "late");
});

Deno.test("row with an explicit period counts only for that period", () => {
  const dec = row({ transaction_date: "2026-11-20", period_start: "2026-12-01", period_end: "2026-12-31" });
  assertEquals(checkPeriod(watch, [dec], "2026-11", "2026-11-25").state, "late");
  assertEquals(checkPeriod(watch, [dec], "2026-12", "2026-12-01").state, "paid");
});

Deno.test("name match is case-insensitive and by substring", () => {
  const r = checkPeriod(watch, [row({ person_name: "Tenant A (Cash App)" })], "2026-11", "2026-11-10");
  assertEquals(r.state, "paid");
});

Deno.test("other people's rows, test rows, voided rows and expenses do not count", () => {
  const rows = [
    row({ person_name: "Someone Else" }),
    row({ is_test: true }),
    row({ status: "voided" }),
    row({ status: "failed" }),
    row({ direction: "expense" }),
  ];
  assertEquals(checkPeriod(watch, rows, "2026-11", "2026-11-10").state, "late");
});

Deno.test("pending rows count as received", () => {
  assertEquals(checkPeriod(watch, [row({ status: "pending" })], "2026-11", "2026-11-10").state, "paid");
});

Deno.test("partial payment is reported with the amount still owed", () => {
  const r = checkPeriod(watch, [row({ amount: 200 })], "2026-11", "2026-11-10");
  assertEquals(r.state, "partial");
  assertEquals(r.owed, 295);
});

Deno.test("not yet due before the due day", () => {
  const w = { ...watch, due_day: 5 };
  assertEquals(checkPeriod(w, [], "2026-11", "2026-11-03").state, "waiting");
  const late = checkPeriod(w, [], "2026-11", "2026-11-07");
  assertEquals(late.state, "late");
  assertEquals(late.daysLate, 2);
});

Deno.test("due today on the 1st, one day late on the 2nd", () => {
  assertEquals(checkPeriod(watch, [], "2026-11", "2026-11-01").state, "due_today");
  const r = checkPeriod(watch, [], "2026-11", "2026-11-02");
  assertEquals(r.state, "late");
  assertEquals(r.daysLate, 1);
});

Deno.test("a tenancy that has not started or has ended is inactive", () => {
  assertEquals(checkPeriod({ ...watch, starts_on: "2026-12-05" }, [], "2026-11", "2026-11-20").state, "inactive");
  assertEquals(checkPeriod({ ...watch, ends_on: "2026-10-31" }, [], "2026-11", "2026-11-20").state, "inactive");
});

Deno.test("digest is sent on the 1st and 2nd always, later only when something is unpaid", () => {
  assertEquals(shouldSendDigest("2026-11-01", false), true);
  assertEquals(shouldSendDigest("2026-11-02", false), true);
  assertEquals(shouldSendDigest("2026-11-03", false), false);
  assertEquals(shouldSendDigest("2026-11-03", true), true);
  assertEquals(shouldSendDigest("2026-11-28", true), true);
});
