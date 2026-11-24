import { supabase } from '../shared/supabase.js';
import { PAYMENT_METHOD_LABELS } from '../shared/accounting-service.js';
import { getAustinTodayISO } from '../shared/timezone.js';
import { reimbursementCard, reimbursementElement, reimbursementList } from '../shared/reimbursements.js';

function resolutionForm(request, onResolved, showToast) {
  const form = reimbursementElement('form', null, 'reimbursement-form');
  const outcome = document.createElement('select');
  outcome.add(new Option('Record completed payment', 'paid'));
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
        showToast(error.message === 'This reimbursement has already been resolved'
          ? error.message : 'Could not save the reimbursement. Try again.', 'error');
        if (error.message === 'This reimbursement has already been resolved') onResolved(false);
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

export function initReimbursementQueue(showToast, refreshLedger) {
  const panel = document.getElementById('reimbursements');
  const status = document.getElementById('reimbursementStatus');

  const reload = reimbursementList({
    container: document.getElementById('reimbursementQueue'),
    more: document.getElementById('reimbursementQueueMore'),
    query: () => supabase.from('associate_reimbursements')
      .select('id, amount_cents, purchase_date, description, space:spaces(name), status, paid_date, resolution_note, receipt_paths, associate:associate_profiles(user:app_users(display_name))')
      .eq('status', status.value),
    render: request => {
      const card = reimbursementCard(request, request.associate?.user?.display_name || 'Associate', showToast);
      if (request.status === 'pending') {
        const review = document.createElement('details');
        review.append(reimbursementElement('summary', 'Review request'));
        review.append(resolutionForm(request, paid => {
          reload();
          if (paid) refreshLedger();
        }, showToast));
        card.append(review);
      }
      return card;
    },
    emptyText: () => 'No ' + status.value + ' reimbursements.'
  });

  status.addEventListener('change', reload);
  panel.hidden = false;
  reload();
}
