import { computePaymentDueAtSigning } from "./payment-due.ts";

Deno.test("deposit reminders subtract partial receipts and credit the application fee only to rent", () => {
  const app = {
    move_in_deposit_amount: 300, security_deposit_amount: 100,
    application_fee_paid: true, application_fee_amount: 30,
    rental_payments: [{ payment_type: "move_in_deposit", amount_paid: 100 }, { payment_type: "security_deposit", amount_paid: 20 }],
  };
  const due = (fields: Record<string, unknown>) =>
    computePaymentDueAtSigning({ ...app, ...fields }, { excludePaid: true }).total;
  if (due({}) !== 250 || due({ move_in_deposit_paid: true }) !== 80) throw new Error("Incorrect remaining balance");
});
