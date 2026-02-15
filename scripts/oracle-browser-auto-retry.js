/**
 * Oracle Cloud Always Free ARM - Browser Auto-Retry Script
 *
 * INSTRUCTIONS:
 * 1. In Oracle Cloud Console, start creating an instance (go through all the steps up to the Review page)
 * 2. On the Review page (where you see the capacity error), open browser DevTools (F12)
 * 3. Go to Console tab
 * 4. Paste this entire script and press Enter
 * 5. The script will automatically retry creating the instance every 2 minutes
 * 6. When successful, you'll get a browser notification + the script will stop
 *
 * The script rotates through all 3 availability domains (AD-1, AD-2, AD-3)
 */

(function() {
  'use strict';

  console.log('%c🚀 Oracle ARM Auto-Retry Started!', 'color: #00ff00; font-size: 20px; font-weight: bold');
  console.log('Monitoring for capacity in US West (Phoenix)...');
  console.log('This will retry every 2 minutes across all 3 availability domains.');
  console.log('');
  console.log('To stop: Close this tab or run: clearInterval(window.oracleRetryInterval)');
  console.log('━'.repeat(80));

  const RETRY_INTERVAL = 120000; // 2 minutes
  let attemptCount = 0;
  let currentAD = 1; // Start with AD-1

  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body: body,
        icon: 'https://www.oracle.com/asset/web/favicons/favicon-192.png',
        requireInteraction: true
      });
    }

    // Also play a sound
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZUR8QV67k8K9g');
    audio.play().catch(() => {}); // Ignore if autoplay is blocked
  }

  function getCreateButton() {
    // Try to find the "Create" button
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find(btn => btn.textContent.trim() === 'Create');
  }

  function getEditButton() {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find(btn => btn.textContent.trim() === 'Edit');
  }

  function findADDropdown() {
    // Find the availability domain dropdown
    const labels = Array.from(document.querySelectorAll('label'));
    const adLabel = labels.find(l => l.textContent.includes('Availability domain'));
    if (adLabel) {
      const select = adLabel.closest('div').querySelector('select');
      return select;
    }
    return null;
  }

  function changeAD() {
    const editBtn = getEditButton();
    if (!editBtn) {
      console.log('⚠️  Could not find Edit button');
      return false;
    }

    editBtn.click();

    setTimeout(() => {
      const adDropdown = findADDropdown();
      if (adDropdown) {
        // Set to the current AD
        const adValue = `AD-${currentAD}`;
        const option = Array.from(adDropdown.options).find(o => o.textContent.includes(adValue));
        if (option) {
          adDropdown.value = option.value;
          adDropdown.dispatchEvent(new Event('change', { bubbles: true }));
          console.log(`   → Switched to ${adValue}`);

          // Click through to review page
          setTimeout(() => {
            const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Next');
            if (nextBtn) {
              nextBtn.click();

              // Navigate through remaining steps to review
              let clickCount = 0;
              const navInterval = setInterval(() => {
                const nextBtn2 = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Next');
                if (nextBtn2) {
                  nextBtn2.click();
                  clickCount++;
                  if (clickCount >= 3) clearInterval(navInterval);
                } else {
                  clearInterval(navInterval);
                }
              }, 1000);
            }
          }, 1000);
        }
      }
    }, 1000);

    return true;
  }

  function checkForError() {
    // Check if there's a capacity error on the page
    const errorText = document.body.textContent;
    return errorText.includes('Out of capacity') || errorText.includes('Out of host capacity');
  }

  function attemptCreate() {
    attemptCount++;
    const timestamp = new Date().toLocaleTimeString();

    console.log(`\n[${timestamp}] Attempt #${attemptCount} - AD-${currentAD}`);

    const createBtn = getCreateButton();
    if (!createBtn) {
      console.log('⚠️  Create button not found - are you on the Review page?');
      return;
    }

    // Click create
    createBtn.click();

    // Wait a bit and check for error
    setTimeout(() => {
      if (checkForError()) {
        console.log(`   ❌ Out of capacity in AD-${currentAD}`);

        // Rotate to next AD
        currentAD = (currentAD % 3) + 1;

        // Change AD and retry
        setTimeout(() => changeAD(), 2000);
      } else {
        // Success!
        console.log('   ✅ SUCCESS! Instance is being created!');
        console.log('%c🎉 INSTANCE CREATED SUCCESSFULLY!', 'color: #00ff00; font-size: 24px; font-weight: bold');
        console.log('');
        console.log('Next steps:');
        console.log('1. Wait for instance to reach "Running" state');
        console.log('2. Note the public IP address');
        console.log('3. SSH in: ssh -i ~/.ssh/oracle_key ubuntu@<PUBLIC_IP>');
        console.log('4. Run migration script');

        showNotification(
          '🎉 Oracle Instance Created!',
          'Your Always Free ARM instance is being provisioned. Check the console for the public IP.'
        );

        // Stop retrying
        if (window.oracleRetryInterval) {
          clearInterval(window.oracleRetryInterval);
          console.log('Auto-retry stopped.');
        }
      }
    }, 5000);
  }

  // Start the retry loop
  console.log('Starting in 5 seconds...\n');
  setTimeout(() => {
    attemptCreate(); // First attempt immediately
    window.oracleRetryInterval = setInterval(attemptCreate, RETRY_INTERVAL);
  }, 5000);

  // Log reminder
  setTimeout(() => {
    console.log('\n💡 TIP: Leave this tab open and the script will keep trying!');
    console.log('You can minimize the browser but don\'t close the tab.');
  }, 10000);

})();
