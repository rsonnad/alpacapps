import { supabase } from '../shared/supabase.js';
import { PAYMENT_METHOD_LABELS } from '../shared/accounting-service.js';
import { getAustinTodayISO } from '../shared/timezone.js';
import { reimbursementCard, reimbursementElement, reimbursementList } from '../shared/reimbursements.js';

function resolutionForm(request, onResolved, showToast) {
  const form = reimbursementElement('form', null, 'reimbursement-form');
  const outcome = document.createElement('select');
  if (!request.automatic_payment || request.payment_held) {
    outcome.add(new Option('Record completed payment', 'paid'));
  }
  outcome.add(new Option('Decline request', 'declined'));

  const paidDate = document.createElement('input');
  paidDate.type = 'date';
  paidDate.min = request.purchase_date;
  paidDate.value = paidDate.max = getAustinTodayISO();

  const method = document.createElement('select');
  method.add(new Option('Choose a method', ''));
  for (const [value, label] of Object.entries(PAYMENT_METHOD_LABELS)) {
    method.add(new Option(label, value));
  }

  const note = document.createElement('textarea');
  note.maxLength = 500;
  note.rows = 2;

  function labelled(label, control) {
    const wrapper = reimbursementElement('label', label);
    wrapper.append(control);
    return wrapper;
  }

  const paymentFields = reimbursementElement('div', null, 'reimbursement-fields');
  paymentFields.append(labelled('Date paid', paidDate), labelled('Payment method', method));
  const noteLabel = labelled('', note);
  const noteText = reimbursementElement('span');
  noteLabel.prepend(noteText);
  const submit = reimbursementElement('button', '', 'btn-primary btn-small');
  submit.type = 'submit';
  const paymentHelp = reimbursementElement('small', 'Send the reimbursement separately before recording it here.');

  function syncOutcome() {
    const paid = outcome.value === 'paid';
    paidDate.required = method.required = paid;
    paymentFields.hidden = paymentHelp.hidden = !paid;
    note.required = !paid;
    noteText.textContent = paid ? 'Payment reference (optional)' : 'Reason for declining';
    submit.textContent = paid ? 'Record as paid' : 'Decline reimbursement';
  }

  outcome.addEventListener('change', syncOutcome);
  form.append(labelled('Action', outcome), paymentFields, paymentHelp, noteLabel, submit);
  syncOutcome();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const status = outcome.value;
    const paid = status === 'paid';
    const resolutionNote = note.value.trim();
    if (!paid && !resolutionNote) {
      showToast('Enter a reason for declining.', 'error');
      note.focus();
      return;
    }
    const params = {
      p_id: request.id,
      p_status: status,
      p_paid_date: paid ? paidDate.value : null,
      p_payment_method: paid ? method.value : null,
      p_note: resolutionNote || null
    };
    const controls = [outcome, paidDate, method, note, submit];
    controls.forEach(control => { control.disabled = true; });
    submit.textContent = 'Saving…';

    try {
      const { error } = await supabase.rpc('resolve_associate_reimbursement', params);
      if (error) {
        const changed = [
          'This reimbursement has already been resolved',
          'A Stripe transfer is in progress or needs reconciliation',
          'Hold automatic payment before recording an external payment'
        ].includes(error.message);
        showToast(changed ? error.message : 'Could not save the reimbursement. Try again.', 'error');
        if (changed) onResolved(false);
        return;
      }

      showToast(paid ? 'Reimbursement recorded in the ledger.' : 'Reimbursement declined.', 'success');
      onResolved(paid);
    } catch {
      showToast('Could not save the reimbursement. Try again.', 'error');
    } finally {
      controls.forEach(control => { control.disabled = false; });
      syncOutcome();
    }
  });

  return form;
}

function paymentHoldButton(request, reload, showToast) {
  const shouldHold = !request.payment_held;
  const button = reimbursementElement('button',
    shouldHold ? 'Delay payment' : 'Release payment hold', 'btn-secondary btn-small');
  button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const { error } = await supabase.rpc('set_reimbursement_payment_hold', {
        p_id: request.id, p_held: shouldHold
      });
      if (error) {
        showToast(error.message === 'This reimbursement is resolved or its transfer has already started'
          ? error.message : 'Could not update the payment hold. Try again.', 'error');
      } else {
        showToast(shouldHold ? 'Automatic payment held until you release it.'
          : 'Released. Payment can run at the next eligible payroll window.', 'success');
      }
      reload();
    } catch {
      showToast('Could not update the payment hold. Try again.', 'error');
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

export function initReimbursementQueue(linkedId, showToast, refreshLedger) {
  const panel = document.getElementById('reimbursements');
  const status = document.getElementById('reimbursementStatus');
  const dateTime = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago'
  });

  const reload = reimbursementList({
    container: document.getElementById('reimbursementQueue'),
    more: document.getElementById('reimbursementQueueMore'),
    query: () => {
      const query = supabase.from('associate_reimbursements')
        .select('id, amount_cents, purchase_date, description, space:spaces(name), status, paid_date, resolution_note, receipt_paths, automatic_payment, created_at, review_email_sent_at, payment_held, transfer_started_at, transfer_retry_after, transfer_error, associate:associate_profiles(is_active, payment_method, stripe_connect_account_id, identity_verification_status, w9_status, instant_payout, payout_frequency, payout_day_of_week, user:app_users(display_name))');
      return linkedId ? query.eq('id', linkedId) : query.eq('status', status.value);
    },
    render: request => {
      const card = reimbursementCard(request, request.associate?.user?.display_name || 'Associate', showToast, request.associate);
      if (request.status !== 'pending') return card;
      if (request.transfer_error) card.append(reimbursementElement('small', request.transfer_error));
      if (request.transfer_started_at) {
        card.append(reimbursementElement('small', 'Stripe transfer started. Review the transfer before taking further action.'));
        return card;
      }

      if (request.automatic_payment) {
        let timing = 'Waiting for the review email to be sent.';
        if (request.payment_held) {
          timing = 'Automatic payment is on hold until released.';
        } else if (request.review_email_sent_at) {
          const after = new Date(Date.parse(request.review_email_sent_at) + 24 * 60 * 60 * 1000);
          timing = 'Automatic payment can run on an eligible payroll run after ' + dateTime.format(after) + ' Central.';
        }
        const controls = reimbursementElement('div', null, 'reimbursement-actions');
        controls.append(paymentHoldButton(request, reload, showToast), reimbursementElement('small', timing));
        card.append(controls);
      }

      const review = document.createElement('details');
      review.append(reimbursementElement('summary', 'Review request'));
      review.append(resolutionForm(request, paid => {
        reload();
        if (paid) refreshLedger();
      }, showToast));
      card.append(review);
      return card;
    },
    emptyText: () => linkedId ? 'Reimbursement not found.' : 'No ' + status.value + ' reimbursements.'
  });

  if (linkedId) {
    status.closest('label').hidden = true;
    document.getElementById('reimbursementQueueBack').hidden = false;
  }
  status.addEventListener('change', reload);
  panel.hidden = false;
  reload();
  if (linkedId || location.hash === '#reimbursements') panel.scrollIntoView();
}
