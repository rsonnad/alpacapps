/**
 * Profile Page - User profile editing
 */
import { initResidentPage, showToast } from '../shared/resident-shell.js';
import { supabase } from '../shared/supabase.js';
import { getAuthState } from '../shared/auth.js';

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB after compression
const AVATAR_MAX_DIM = 512;

let currentUser = null;
let profileData = null;

document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'profile',
    requiredRole: 'resident',
    onReady: async (authState) => {
      currentUser = authState.appUser;
      await loadProfile();
      bindEvents();
    },
  });
});

// =============================================
// LOAD PROFILE
// =============================================

async function loadProfile() {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, display_name, email, role, avatar_url, bio, phone, pronouns, birthday, instagram, links')
    .eq('id', currentUser.id)
    .single();

  if (error) {
    showToast('Failed to load profile', 'error');
    return;
  }

  profileData = data;
  renderProfile();
}

function renderProfile() {
  const d = profileData;

  // Header section
  renderAvatar(d.avatar_url, d.display_name || d.email);
  document.getElementById('profileName').textContent = d.display_name || d.email;
  const roleEl = document.getElementById('profileRole');
  roleEl.textContent = (d.role || 'resident').charAt(0).toUpperCase() + (d.role || 'resident').slice(1);
  roleEl.className = 'role-badge ' + (d.role || 'resident');

  const pronounsEl = document.getElementById('profilePronouns');
  if (d.pronouns) {
    pronounsEl.textContent = d.pronouns;
    pronounsEl.style.display = '';
  } else {
    pronounsEl.style.display = 'none';
  }

  // Form fields
  document.getElementById('fieldDisplayName').value = d.display_name || '';
  document.getElementById('fieldPronouns').value = d.pronouns || '';
  document.getElementById('fieldBio').value = d.bio || '';
  document.getElementById('fieldBirthday').value = d.birthday || '';
  document.getElementById('fieldPhone').value = d.phone || '';
  document.getElementById('fieldInstagram').value = d.instagram || '';

  // Bio counter
  updateBioCount();

  // Links
  renderLinks(d.links || []);
}

function renderAvatar(avatarUrl, name) {
  const container = document.getElementById('profileAvatar');
  const initialsEl = document.getElementById('avatarInitials');

  if (avatarUrl) {
    container.style.backgroundImage = `url(${avatarUrl})`;
    container.style.backgroundSize = 'cover';
    container.style.backgroundPosition = 'center';
    initialsEl.style.display = 'none';
  } else {
    container.style.backgroundImage = '';
    initialsEl.style.display = '';
    initialsEl.textContent = getInitials(name);
  }
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name[0].toUpperCase();
}

// =============================================
// LINKS
// =============================================

function renderLinks(links) {
  const container = document.getElementById('linksContainer');
  container.innerHTML = '';

  links.forEach((link, i) => {
    const row = document.createElement('div');
    row.className = 'profile-link-row';
    row.innerHTML = `
      <input type="text" class="link-label" placeholder="Label" value="${escapeAttr(link.label || '')}" maxlength="30">
      <input type="url" class="link-url" placeholder="https://..." value="${escapeAttr(link.url || '')}" maxlength="200">
      <button class="btn-icon profile-link-remove" data-index="${i}" title="Remove link">&times;</button>
    `;
    container.appendChild(row);
  });

  // Bind remove buttons
  container.querySelectorAll('.profile-link-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.profile-link-row').remove();
    });
  });
}

function collectLinks() {
  const rows = document.querySelectorAll('#linksContainer .profile-link-row');
  const links = [];
  rows.forEach(row => {
    const label = row.querySelector('.link-label').value.trim();
    const url = row.querySelector('.link-url').value.trim();
    if (label || url) {
      links.push({ label, url });
    }
  });
  return links;
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// =============================================
// AVATAR UPLOAD
// =============================================

async function handleAvatarUpload(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('Please select an image file', 'error');
    return;
  }

  showToast('Uploading avatar...', 'info', 10000);

  try {
    // Compress image
    const compressed = await compressAvatar(file);

    // Upload to Supabase Storage
    const ext = 'webp';
    const path = `avatars/${currentUser.id}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('housephotos')
      .upload(path, compressed, {
        contentType: 'image/webp',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('housephotos')
      .getPublicUrl(path);

    const avatarUrl = urlData.publicUrl + '?t=' + Date.now(); // cache bust

    // Save to database
    const { error: dbError } = await supabase
      .from('app_users')
      .update({ avatar_url: avatarUrl })
      .eq('id', currentUser.id);

    if (dbError) throw dbError;

    profileData.avatar_url = avatarUrl;
    renderAvatar(avatarUrl, profileData.display_name || profileData.email);

    // Update cached auth state
    updateCachedAuth({ avatar_url: avatarUrl });

    showToast('Avatar updated', 'success');
  } catch (err) {
    console.error('Avatar upload failed:', err);
    showToast('Failed to upload avatar: ' + err.message, 'error');
  }
}

function compressAvatar(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;

      // Scale down if needed
      if (w > AVATAR_MAX_DIM || h > AVATAR_MAX_DIM) {
        const ratio = Math.min(AVATAR_MAX_DIM / w, AVATAR_MAX_DIM / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Compression failed')),
        'image/webp',
        0.85
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

// =============================================
// SAVE PROFILE
// =============================================

async function saveProfile() {
  const btn = document.getElementById('saveProfileBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const updates = {
      display_name: document.getElementById('fieldDisplayName').value.trim() || null,
      pronouns: document.getElementById('fieldPronouns').value.trim() || null,
      bio: document.getElementById('fieldBio').value.trim() || null,
      birthday: document.getElementById('fieldBirthday').value || null,
      phone: document.getElementById('fieldPhone').value.trim() || null,
      instagram: document.getElementById('fieldInstagram').value.trim().replace(/^@/, '') || null,
      links: collectLinks(),
    };

    const { error } = await supabase
      .from('app_users')
      .update(updates)
      .eq('id', currentUser.id);

    if (error) throw error;

    // Update local state
    Object.assign(profileData, updates);

    // Update header name
    const displayName = updates.display_name || profileData.email;
    document.getElementById('profileName').textContent = displayName;

    // Update pronouns display
    const pronounsEl = document.getElementById('profilePronouns');
    if (updates.pronouns) {
      pronounsEl.textContent = updates.pronouns;
      pronounsEl.style.display = '';
    } else {
      pronounsEl.style.display = 'none';
    }

    // Update cached auth state so header updates on other pages
    updateCachedAuth({ display_name: updates.display_name });

    // Update this page's header
    const userInfoEl = document.getElementById('userInfo');
    if (userInfoEl) {
      const nameSpan = userInfoEl.querySelector('.user-profile-name');
      if (nameSpan) nameSpan.textContent = displayName;
    }

    showToast('Profile saved', 'success');
  } catch (err) {
    console.error('Save failed:', err);
    showToast('Failed to save: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Profile';
  }
}

// =============================================
// CACHED AUTH UPDATE
// =============================================

function updateCachedAuth(fields) {
  try {
    const cached = localStorage.getItem('genalpaca-cached-auth');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.appUser) {
        Object.assign(parsed.appUser, fields);
        localStorage.setItem('genalpaca-cached-auth', JSON.stringify(parsed));
      }
    }
  } catch (e) {
    // Ignore cache update failures
  }
}

// =============================================
// BIO COUNT
// =============================================

function updateBioCount() {
  const bio = document.getElementById('fieldBio');
  document.getElementById('bioCount').textContent = (bio.value || '').length;
}

// =============================================
// EVENT BINDINGS
// =============================================

function bindEvents() {
  // Avatar upload
  document.getElementById('avatarEditBtn').addEventListener('click', () => {
    document.getElementById('avatarInput').click();
  });
  document.getElementById('profileAvatar').addEventListener('click', () => {
    document.getElementById('avatarInput').click();
  });
  document.getElementById('avatarInput').addEventListener('change', (e) => {
    if (e.target.files[0]) handleAvatarUpload(e.target.files[0]);
  });

  // Save
  document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);

  // Add link
  document.getElementById('addLinkBtn').addEventListener('click', () => {
    const links = collectLinks();
    links.push({ label: '', url: '' });
    renderLinks(links);
  });

  // Bio character counter
  document.getElementById('fieldBio').addEventListener('input', updateBioCount);
}
