// User Management - Admin only
import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';
import { emailService } from '../../shared/email-service.js';
import { formatDateAustin, getAustinToday } from '../../shared/timezone.js';

// Timeout configuration
const DB_TIMEOUT_MS = 10000; // 10 seconds for database operations

/**
 * Wrap a promise with a timeout to prevent indefinite hangs
 */
function withTimeout(promise, ms = DB_TIMEOUT_MS, errorMessage = 'Operation timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), ms)
    )
  ]);
}

let authState = null;
let users = [];
let invitations = [];

// DOM elements (set after DOM ready)
let pendingSection, usersSection, pendingCount, usersCount;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize auth and admin page (requires admin role)
  authState = await initAdminPage({
    activeTab: 'users',
    onReady: async (state) => {
      authState = state;

      // Set DOM element references
      pendingSection = document.getElementById('pendingSection');
      usersSection = document.getElementById('usersSection');
      pendingCount = document.getElementById('pendingCount');
      usersCount = document.getElementById('usersCount');

      // Load data
      await loadUsers();
      await loadInvitations();
      render();
      setupEventListeners();
    }
  });
});

function setupEventListeners() {
  // Invite form
  document.getElementById('inviteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('inviteEmail').value.trim().toLowerCase();
    const role = document.getElementById('inviteRole').value;
    await inviteUser(email, role);
  });
}

async function loadUsers() {
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('app_users')
        .select('*')
        .order('created_at', { ascending: false }),
      DB_TIMEOUT_MS,
      'Loading users timed out'
    );

    if (error) {
      console.error('Error loading users:', error);
      showToast('Failed to load users: ' + error.message, 'error');
      return;
    }

    users = data || [];
  } catch (timeoutError) {
    console.error('Users load timeout:', timeoutError.message);
    showToast('Loading users timed out. Please refresh the page.', 'error');
  }
}

async function loadInvitations() {
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('user_invitations')
        .select('*')
        .eq('status', 'pending')
        .order('invited_at', { ascending: false }),
      DB_TIMEOUT_MS,
      'Loading invitations timed out'
    );

    if (error) {
      console.error('Error loading invitations:', error);
      showToast('Failed to load invitations: ' + error.message, 'error');
      return;
    }

    invitations = data || [];
  } catch (timeoutError) {
    console.error('Invitations load timeout:', timeoutError.message);
    showToast('Loading invitations timed out. Please refresh the page.', 'error');
  }
}

async function inviteUser(email, role) {
  // Validate email
  if (!email || !email.includes('@')) {
    showToast('Please enter a valid email address', 'warning');
    return;
  }

  // Check if user already exists
  const existing = users.find(u => u.email.toLowerCase() === email);
  if (existing) {
    showToast('This user already has an account', 'warning');
    return;
  }

  // Check if invitation already pending
  const pendingInvite = invitations.find(i => i.email.toLowerCase() === email);
  if (pendingInvite) {
    showToast('An invitation is already pending for this email', 'warning');
    return;
  }

  try {
    // Create invitation record
    const { data: newInvite, error } = await supabase
      .from('user_invitations')
      .insert({
        email: email,
        role: role,
        invited_by: authState.appUser?.id
      })
      .select()
      .single();

    if (error) throw error;

    document.getElementById('inviteEmail').value = '';

    await loadInvitations();
    render();

    // Show invitation text modal (email not sent yet)
    showInvitationModal(email, role);

  } catch (error) {
    console.error('Error inviting user:', error);
    showToast('Failed to send invitation: ' + error.message, 'error');
  }
}

/**
 * Send or resend invitation email and update tracking
 */
async function sendInvitationEmail(invitationId, email, role) {
  const loginUrl = 'https://alpacaplayhouse.com/login/';
  const emailResult = await emailService.sendStaffInvitation(email, role, loginUrl);

  if (emailResult.success) {
    // Update email tracking in database
    await supabase
      .from('user_invitations')
      .update({
        email_sent_at: new Date().toISOString(),
        email_send_count: supabase.rpc ? undefined : 1 // Will use raw SQL increment below
      })
      .eq('id', invitationId);

    // Increment send count
    await supabase.rpc('increment_invitation_email_count', { invitation_id: invitationId }).catch(() => {
      // Fallback: just set to 1 if RPC doesn't exist
      supabase
        .from('user_invitations')
        .update({ email_send_count: 1 })
        .eq('id', invitationId);
    });

    return true;
  } else {
    console.error('Email send failed:', emailResult.error);
    return false;
  }
}

/**
 * Resend invitation email
 */
async function resendInvitation(invitationId) {
  const invitation = invitations.find(i => i.id === invitationId);
  if (!invitation) {
    showToast('Invitation not found', 'error');
    return;
  }

  // Check if expired
  if (new Date(invitation.expires_at) < new Date()) {
    // Extend expiration by 7 days
    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + 7);

    await supabase
      .from('user_invitations')
      .update({ expires_at: newExpiry.toISOString() })
      .eq('id', invitationId);
  }

  const emailSent = await sendInvitationEmail(invitationId, invitation.email, invitation.role);

  if (emailSent) {
    showToast('Invitation resent to ' + invitation.email, 'success');
    await loadInvitations();
    render();
  } else {
    showToast('Failed to send email. Try copying the invite text manually.', 'error');
    showInvitationModal(invitation.email, invitation.role);
  }
}

// Store current invitation details for sending email
let currentInviteEmail = null;
let currentInviteRole = null;

function showInvitationModal(email, role) {
  currentInviteEmail = email;
  currentInviteRole = role;

  const roleDescription = role === 'admin'
    ? 'full admin access (view all spaces, occupant details, edit spaces, manage photos, and invite users)'
    : 'staff access (view all spaces and occupant details)';

  const inviteText = `Hi,

You've been invited to access AlpacApp as ${role === 'admin' ? 'an admin' : 'a staff member'}.

You will have ${roleDescription}.

To get started:
1. Go to: https://alpacaplayhouse.com/login/
2. Sign in with Google, or use your email and password

If you don't have a password yet, click "Forgot password?" on the login page to set one up.

Your access has already been pre-approved for ${email}, so you'll have immediate access once you sign in.

If there are any problems or suggestions for improvements, please email them to alpacaplayhouse@gmail.com as soon as you can and they will be rapidly addressed.`;

  // Show modal
  const modal = document.getElementById('inviteTextModal');
  document.getElementById('inviteTextContent').value = inviteText;
  modal.classList.remove('hidden');
}

function copyInviteText() {
  const textarea = document.getElementById('inviteTextContent');
  textarea.select();
  document.execCommand('copy');
  showToast('Invitation text copied to clipboard', 'success');
}

function closeInviteModal() {
  document.getElementById('inviteTextModal').classList.add('hidden');
  currentInviteEmail = null;
  currentInviteRole = null;
}

async function sendInviteEmail() {
  if (!currentInviteEmail || !currentInviteRole) {
    showToast('No invitation to send', 'error');
    return;
  }

  const btn = document.getElementById('sendInviteEmailBtn');
  const originalText = btn.textContent;
  btn.textContent = 'Sending...';
  btn.disabled = true;

  try {
    const invitation = invitations.find(i => i.email.toLowerCase() === currentInviteEmail.toLowerCase());
    if (!invitation) {
      showToast('Invitation not found', 'error');
      return;
    }

    const emailSent = await sendInvitationEmail(invitation.id, currentInviteEmail, currentInviteRole);

    if (emailSent) {
      showToast('Email sent to ' + currentInviteEmail, 'success');
      closeInviteModal();
      await loadInvitations();
      render();
    } else {
      showToast('Failed to send email. Try copying the invite text manually.', 'error');
    }
  } catch (error) {
    console.error('Error sending invitation email:', error);
    showToast('Failed to send email: ' + error.message, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function revokeInvitation(invitationId) {
  try {
    const { error } = await supabase
      .from('user_invitations')
      .update({ status: 'revoked' })
      .eq('id', invitationId);

    if (error) throw error;

    await loadInvitations();
    render();
    showToast('Invitation revoked', 'success');

  } catch (error) {
    console.error('Error revoking invitation:', error);
    showToast('Failed to revoke: ' + error.message, 'error');
  }
}

async function updateUserRole(userId, newRole) {
  try {
    const { error } = await supabase
      .from('app_users')
      .update({ role: newRole })
      .eq('id', userId);

    if (error) throw error;

    await loadUsers();
    render();
    showToast('Role updated', 'success');

  } catch (error) {
    console.error('Error updating role:', error);
    showToast('Failed to update role: ' + error.message, 'error');
  }
}

async function removeUser(userId) {
  if (!confirm('Remove this user? They will no longer be able to access admin features.')) return;

  try {
    const { error } = await supabase
      .from('app_users')
      .delete()
      .eq('id', userId);

    if (error) throw error;

    await loadUsers();
    render();
    showToast('User removed', 'success');

  } catch (error) {
    console.error('Error removing user:', error);
    showToast('Failed to remove user: ' + error.message, 'error');
  }
}

function render() {
  renderInvitations();
  renderUsers();
}

function renderInvitations() {
  // Deduplicate invitations by email, keeping only the most recent one per email
  // (invitations are already sorted by invited_at desc, so first occurrence is most recent)
  const seenEmails = new Set();
  const uniqueInvitations = invitations.filter(inv => {
    const emailLower = inv.email.toLowerCase();
    if (seenEmails.has(emailLower)) {
      return false;
    }
    seenEmails.add(emailLower);
    return true;
  });

  pendingCount.textContent = uniqueInvitations.length;

  if (uniqueInvitations.length === 0) {
    pendingSection.innerHTML = `
      <div class="empty-state">
        No pending invitations
      </div>
    `;
    return;
  }

  pendingSection.innerHTML = `
    <table class="users-table">
      <thead>
        <tr>
          <th>Email</th>
          <th>Role</th>
          <th>Email Status</th>
          <th>Expires</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${uniqueInvitations.map(inv => {
          const isExpired = new Date(inv.expires_at) < getAustinToday();
          const emailStatus = getEmailStatus(inv);
          return `
            <tr class="${isExpired ? 'expired-row' : ''}">
              <td>${inv.email}</td>
              <td><span class="role-badge ${inv.role}">${inv.role}</span></td>
              <td>
                <span class="email-status ${emailStatus.class}">${emailStatus.text}</span>
                ${inv.email_send_count > 1 ? `<span class="send-count">(${inv.email_send_count}x)</span>` : ''}
              </td>
              <td>
                <span class="${isExpired ? 'expired-text' : ''}">${formatDateAustin(inv.expires_at, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                ${isExpired ? '<span class="expired-badge">Expired</span>' : ''}
              </td>
              <td class="actions-cell">
                <button class="btn-secondary btn-small" onclick="resendInvitation('${inv.id}')" title="Resend invitation email">
                  ${isExpired ? 'Resend & Extend' : 'Resend'}
                </button>
                <button class="btn-text" onclick="showInvitationModal('${inv.email}', '${inv.role}')" title="Copy invite text">
                  Copy
                </button>
                <button class="btn-danger btn-small" onclick="revokeInvitation('${inv.id}')">Revoke</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function getEmailStatus(invitation) {
  if (!invitation.email_sent_at) {
    return { text: 'Not sent', class: 'status-not-sent' };
  }

  const sentDate = new Date(invitation.email_sent_at);
  const now = new Date();
  const hoursSince = (now - sentDate) / (1000 * 60 * 60);

  if (hoursSince < 1) {
    const minsSince = Math.floor((now - sentDate) / (1000 * 60));
    return { text: `Sent ${minsSince}m ago`, class: 'status-sent-recent' };
  } else if (hoursSince < 24) {
    return { text: `Sent ${Math.floor(hoursSince)}h ago`, class: 'status-sent-recent' };
  } else {
    const daysSince = Math.floor(hoursSince / 24);
    return { text: `Sent ${daysSince}d ago`, class: 'status-sent' };
  }
}

function renderUsers() {
  usersCount.textContent = users.length;

  if (users.length === 0) {
    usersSection.innerHTML = `
      <div class="empty-state">
        No users yet
      </div>
    `;
    return;
  }

  const currentUserId = authState.appUser?.id;

  usersSection.innerHTML = `
    <table class="users-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
          <th>Last Login</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${users.map(u => {
          const isCurrentUser = u.id === currentUserId;
          return `
            <tr>
              <td>
                ${u.display_name || '-'}
                ${isCurrentUser ? '<span class="you-tag">You</span>' : ''}
              </td>
              <td>${u.email}</td>
              <td>
                <select
                  class="role-select"
                  data-user-id="${u.id}"
                  ${isCurrentUser ? 'disabled' : ''}
                  onchange="updateUserRole('${u.id}', this.value)"
                >
                  <option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Staff</option>
                  <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
              </td>
              <td>${u.last_login_at ? formatDateAustin(u.last_login_at, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never'}</td>
              <td>
                ${isCurrentUser
                  ? '-'
                  : `<button class="btn-danger" onclick="removeUser('${u.id}')">Remove</button>`
                }
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// Make functions globally accessible
window.revokeInvitation = revokeInvitation;
window.resendInvitation = resendInvitation;
window.updateUserRole = updateUserRole;
window.removeUser = removeUser;
window.copyInviteText = copyInviteText;
window.closeInviteModal = closeInviteModal;
window.showInvitationModal = showInvitationModal;
window.sendInviteEmail = sendInviteEmail;
