import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseCashAppPayment } from "./cashapp-parse.ts";

const FROM = "Cash App <cash@square.com>";
const RECEIPT = "https://cash.app/launch/activity/receipt/AbC123_xyz=";

Deno.test("whole-dollar amount (no cents), as Cash App now writes it", () => {
  const r = parseCashAppPayment(`You were sent $495 by Test Person. To view your receipt, visit: ${RECEIPT}`, FROM);
  assertEquals(r?.amount, 495);
  assertEquals(r?.senderName, "Test Person");
  assertEquals(r?.transactionId, "AbC123_xyz=");
});

Deno.test("amount with cents still parses", () => {
  const r = parseCashAppPayment(`You were sent $601.29 by Test Person. To view your receipt, visit: ${RECEIPT}`, FROM);
  assertEquals(r?.amount, 601.29);
  assertEquals(r?.senderName, "Test Person");
});

Deno.test("thousands separator, no cents", () => {
  const r = parseCashAppPayment(`You were sent $1,250 by Test Person. To view your receipt, visit: ${RECEIPT}`, FROM);
  assertEquals(r?.amount, 1250);
});

Deno.test("'X sent you' form without cents", () => {
  const r = parseCashAppPayment("Test Person sent you $495", FROM);
  assertEquals(r?.amount, 495);
  assertEquals(r?.senderName, "Test Person");
});

Deno.test("money you sent is not income", () => {
  assertEquals(parseCashAppPayment(`You sent $495 to Test Person. ${RECEIPT}`, FROM), null);
});

Deno.test("a pending-style email with no amount returns null", () => {
  assertEquals(parseCashAppPayment("Your Cash App code is 123456", FROM), null);
});
