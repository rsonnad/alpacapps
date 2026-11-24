import { supabase } from './supabase.js';

export const receiptBucket = supabase.storage.from('reimbursement-receipts');

const statusLabels = { pending: 'Pending review', paid: 'Paid', declined: 'Declined' };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

export function reimbursementElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function reimbursementCard(request, title, showToast) {
  const card = reimbursementElement('article', null, 'reimbursement-card');
  const date = dateFormat.format(new Date(request.purchase_date + 'T00:00:00Z'));
  const status = request.status === 'pending' && request.payment_held ? 'Payment on hold' : statusLabels[request.status];
  card.append(
    reimbursementElement('strong', title + ' · ' + money.format(request.amount_cents / 100)),
    reimbursementElement('div', [status, date, request.space?.name].filter(Boolean).join(' · ')),
    reimbursementElement('div', request.description)
  );
  if (request.paid_date) {
    const paidDate = dateFormat.format(new Date(request.paid_date + 'T00:00:00Z'));
    card.append(reimbursementElement('small', 'Paid ' + paidDate));
  }
  if (request.status === 'declined' && request.resolution_note) {
    card.append(reimbursementElement('small', 'Reason: ' + request.resolution_note));
  }

  const receipts = reimbursementElement('div', null, 'reimbursement-actions');
  request.receipt_paths.forEach((path, index) => {
    const button = reimbursementElement('button', 'Download receipt ' + (index + 1), 'btn-secondary btn-small');
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const { data, error } = await receiptBucket.download(path);
        if (error) throw error;

        const url = URL.createObjectURL(data);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'receipt-' + (index + 1) + '.' + path.split('.').pop();
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        showToast('Could not download the receipt. Try again.', 'error');
      } finally {
        button.disabled = false;
      }
    });
    receipts.append(button);
  });
  card.append(receipts);
  return card;
}

export function reimbursementList({ container, more, query, render, emptyText }) {
  const pageSize = 20;
  let generation = 0;
  let offset = 0;

  async function load(reset = false) {
    const run = ++generation;
    if (reset) {
      offset = 0;
      container.textContent = 'Loading reimbursements…';
    }
    more.disabled = true;

    try {
      const { data, error } = await query()
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + pageSize);
      if (run !== generation) return;
      if (error) throw error;

      if (offset === 0) container.replaceChildren();
      const page = data.slice(0, pageSize);
      container.append(...page.map(render));
      offset += page.length;
      if (offset === 0) container.textContent = emptyText();
      more.textContent = 'Load more';
      more.hidden = data.length <= pageSize;
    } catch {
      if (run !== generation) return;
      if (offset === 0) container.textContent = 'Could not load reimbursements.';
      more.textContent = 'Retry';
      more.hidden = false;
    } finally {
      if (run === generation) more.disabled = false;
    }
  }

  more.addEventListener('click', () => load());
  return () => load(true);
}
