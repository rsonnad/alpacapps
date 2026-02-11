import { initResidentPage } from '../shared/resident-shell.js';

document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'askpai',
    requiredRole: 'resident',
    requiredPermission: 'view_profile',
    onReady: () => {
      // Open PAI automatically so this page behaves like a dedicated chat destination.
      setTimeout(() => {
        const bubble = document.getElementById('paiBubble');
        const panel = document.getElementById('paiPanel');
        if (bubble && panel && panel.classList.contains('hidden')) {
          bubble.click();
        }
      }, 50);
    },
  });
});
