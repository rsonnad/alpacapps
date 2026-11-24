import { supabase } from '../shared/supabase.js';
import { getAustinTodayISO } from '../shared/timezone.js';
import { receiptBucket, reimbursementCard, reimbursementList } from '../shared/reimbursements.js';

const receiptExtensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf'
};

function receiptType(file) {
  if (receiptExtensions[file.type]) return file.type;
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'heic' || extension === 'heif') return 'image/' + extension;
  return null;
}

async function uploadReceipt(folder, receipt) {
  const { file, fileName, type } = receipt;
  const path = folder + '/' + fileName;
  const { error } = await receiptBucket.upload(path, file, { contentType: type, upsert: false });
  if (error) {
    // A retry can follow a completed upload whose response was lost.
    const { data, error: listError } = await receiptBucket.list(folder, { search: fileName, limit: 1 });
    if (listError || !data?.some(object => object.name === fileName)) {
      throw new Error('Could not upload ' + file.name + '. Try again.');
    }
  }
  return path;
}

export function initReimbursements(associateId, spaces, showToast) {
  const panel = document.getElementById('reimbursementPanel');
  const form = document.getElementById('reimbursementForm');
  const { amount, purchaseDate, description, space, receipts } = form.elements;
  const submit = form.querySelector('button[type="submit"]');
  const reload = reimbursementList({
    container: document.getElementById('reimbursementHistory'),
    more: document.getElementById('reimbursementHistoryMore'),
    query: () => supabase.from('associate_reimbursements')
      .select('id, amount_cents, purchase_date, description, space:spaces(name), status, paid_date, resolution_note, receipt_paths, payment_held')
      .eq('associate_id', associateId),
    render: request => reimbursementCard(request, 'Reimbursement', showToast),
    emptyText: () => 'No reimbursements submitted yet.'
  });

  for (const [id, name] of Object.entries(spaces).sort((a, b) => a[1].localeCompare(b[1]))) {
    space.add(new Option(name, id));
  }

  purchaseDate.value = purchaseDate.max = getAustinTodayISO();
  let requestId;
  let selectedReceipts;
  let rpcStarted = false;

  function submissionComplete() {
    showToast('Reimbursement submitted.', 'success');
    form.reset();
    requestId = selectedReceipts = null;
    rpcStarted = false;
    purchaseDate.value = getAustinTodayISO();
    reload();
  }

  receipts.addEventListener('change', () => { selectedReceipts = null; });
  panel.addEventListener('toggle', () => {
    if (!panel.open) return;
    purchaseDate.max = getAustinTodayISO();
    reload();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;

    const amountCents = Math.round(Number(amount.value) * 100);
    const purchaseDescription = description.value.trim();
    const files = Array.from(receipts.files);
    if (!purchaseDescription) {
      showToast('Enter a description of what you bought.', 'error');
      description.focus();
      return;
    }
    if (files.length < 1 || files.length > 5 ||
        files.some(file => !receiptType(file) || file.size === 0 || file.size > 10 * 1024 * 1024)) {
      showToast('Attach 1–5 supported photos or PDFs, up to 10 MB each.', 'error');
      receipts.focus();
      return;
    }

    const request = {
      p_amount_cents: amountCents,
      p_purchase_date: purchaseDate.value,
      p_description: purchaseDescription,
      p_space_id: space.value || null
    };
    const controls = [amount, purchaseDate, description, space, receipts];
    controls.forEach(control => { control.disabled = true; });
    submit.disabled = true;
    submit.textContent = 'Submitting…';

    try {
      requestId ||= crypto.randomUUID();
      selectedReceipts ||= files.map(file => {
        const type = receiptType(file);
        return { file, type, fileName: crypto.randomUUID() + '.' + receiptExtensions[type] };
      });
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) throw new Error('Sign in again to submit your reimbursement.');

      // Resolve an ambiguous submit before uploading any changed attachments.
      if (rpcStarted) {
        const { data: existing, error } = await supabase.from('associate_reimbursements')
          .select('id').eq('id', requestId).maybeSingle();
        if (error) throw error;
        if (existing) {
          submissionComplete();
          return;
        }
      }

      const folder = data.session.user.id + '/' + requestId;
      const receiptPaths = [];
      for (const receipt of selectedReceipts) {
        receipt.path ||= await uploadReceipt(folder, receipt);
        receiptPaths.push(receipt.path);
      }
      rpcStarted = true;
      const { error } = await supabase.rpc('submit_associate_reimbursement', {
        ...request, p_id: requestId, p_receipt_paths: receiptPaths
      });
      if (error) throw error;

      submissionComplete();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not submit the reimbursement. Try again.';
      showToast(message, 'error');
    } finally {
      controls.forEach(control => { control.disabled = false; });
      submit.disabled = false;
      submit.textContent = 'Submit reimbursement';
    }
  });

  panel.hidden = false;
}
