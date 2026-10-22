(() => {
 const buttons = document.querySelectorAll('[data-copy-message]');
 buttons.forEach(button => {
  button.hidden = false;
  button.addEventListener('click', async () => {
   const message = document.getElementById(button.dataset.copyMessage);
   const status = button.parentElement.querySelector('[role="status"]');
   const polish = button.dataset.lang === 'pl';
   try {
    await navigator.clipboard.writeText(message.textContent.trim());
    status.textContent = polish ? 'Skopiowano temat i wiadomość.' : 'Subject and message copied.';
   } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(message); selection.removeAllRanges(); selection.addRange(range);
    status.textContent = polish ? 'Zaznaczono wiadomość. Skopiuj zaznaczony tekst.' : 'Message selected. Copy the selected text.';
   }
  });
 });
 function revealTarget() {
  let id;
  try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
  const target = document.getElementById(id);
  if (target && target.matches('details.prospect')) target.open = true;
 }
 window.addEventListener('hashchange', revealTarget);
 revealTarget();
 let closedForPrint = [];
 window.addEventListener('beforeprint', () => {
  closedForPrint = [...document.querySelectorAll('details.prospect:not([open])')];
  closedForPrint.forEach(detail => detail.open = true);
 });
 window.addEventListener('afterprint', () => {
  closedForPrint.forEach(detail => detail.open = false);
  closedForPrint = [];
 });
})();
