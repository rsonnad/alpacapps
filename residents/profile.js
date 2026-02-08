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
let savedSnapshot = null; // snapshot of form values after load/save

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
    .select('id, display_name, email, role, avatar_url, bio, phone, pronouns, birthday, instagram, links, nationality, location_base')
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
  document.getElementById('fieldNationality').value = d.nationality || '';
  document.getElementById('fieldLocationBase').value = d.location_base || '';
  document.getElementById('fieldBirthday').value = d.birthday || '';
  document.getElementById('fieldPhone').value = d.phone || '';
  document.getElementById('fieldInstagram').value = d.instagram || '';

  // Bio counter
  updateBioCount();

  // Flags
  updateNationalityFlag();
  updateLocationFlag();

  // Links
  renderLinks(d.links || []);

  // Snapshot for dirty tracking (after all fields are set)
  savedSnapshot = getFormSnapshot();
  updateSaveButton();
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
      updateSaveButton();
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
      nationality: document.getElementById('fieldNationality').value.trim() || null,
      location_base: document.getElementById('fieldLocationBase').value.trim() || null,
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

    // Re-snapshot so button becomes disabled again
    savedSnapshot = getFormSnapshot();
    updateSaveButton();
  } catch (err) {
    console.error('Save failed:', err);
    showToast('Failed to save: ' + err.message, 'error');
  } finally {
    if (btn.textContent === 'Saving...') {
      btn.textContent = 'Save Profile';
    }
    updateSaveButton();
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
// COUNTRY FLAG LOOKUP
// =============================================

const COUNTRY_FLAGS = {
  'afghan':'🇦🇫','albanian':'🇦🇱','algerian':'🇩🇿','american':'🇺🇸','andorran':'🇦🇩',
  'angolan':'🇦🇴','argentine':'🇦🇷','argentinian':'🇦🇷','armenian':'🇦🇲','australian':'🇦🇺',
  'austrian':'🇦🇹','azerbaijani':'🇦🇿','bahamian':'🇧🇸','bahraini':'🇧🇭','bangladeshi':'🇧🇩',
  'barbadian':'🇧🇧','belarusian':'🇧🇾','belgian':'🇧🇪','belizean':'🇧🇿','beninese':'🇧🇯',
  'bhutanese':'🇧🇹','bolivian':'🇧🇴','bosnian':'🇧🇦','brazilian':'🇧🇷','british':'🇬🇧',
  'bruneian':'🇧🇳','bulgarian':'🇧🇬','burkinabe':'🇧🇫','burmese':'🇲🇲','burundian':'🇧🇮',
  'cambodian':'🇰🇭','cameroonian':'🇨🇲','canadian':'🇨🇦','cape verdean':'🇨🇻','chadian':'🇹🇩',
  'chilean':'🇨🇱','chinese':'🇨🇳','colombian':'🇨🇴','comorian':'🇰🇲','congolese':'🇨🇬',
  'costa rican':'🇨🇷','croatian':'🇭🇷','cuban':'🇨🇺','cypriot':'🇨🇾','czech':'🇨🇿',
  'danish':'🇩🇰','djiboutian':'🇩🇯','dominican':'🇩🇴','dutch':'🇳🇱','ecuadorian':'🇪🇨',
  'egyptian':'🇪🇬','emirati':'🇦🇪','english':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','eritrean':'🇪🇷','estonian':'🇪🇪',
  'ethiopian':'🇪🇹','fijian':'🇫🇯','filipino':'🇵🇭','finnish':'🇫🇮','french':'🇫🇷',
  'gabonese':'🇬🇦','gambian':'🇬🇲','georgian':'🇬🇪','german':'🇩🇪','ghanaian':'🇬🇭',
  'greek':'🇬🇷','grenadian':'🇬🇩','guatemalan':'🇬🇹','guinean':'🇬🇳','guyanese':'🇬🇾',
  'haitian':'🇭🇹','honduran':'🇭🇳','hungarian':'🇭🇺','icelandic':'🇮🇸','indian':'🇮🇳',
  'indonesian':'🇮🇩','iranian':'🇮🇷','iraqi':'🇮🇶','irish':'🇮🇪','israeli':'🇮🇱',
  'italian':'🇮🇹','ivorian':'🇨🇮','jamaican':'🇯🇲','japanese':'🇯🇵','jordanian':'🇯🇴',
  'kazakh':'🇰🇿','kenyan':'🇰🇪','korean':'🇰🇷','south korean':'🇰🇷','north korean':'🇰🇵',
  'kuwaiti':'🇰🇼','kyrgyz':'🇰🇬','lao':'🇱🇦','latvian':'🇱🇻','lebanese':'🇱🇧',
  'liberian':'🇱🇷','libyan':'🇱🇾','lithuanian':'🇱🇹','luxembourgish':'🇱🇺','macedonian':'🇲🇰',
  'malagasy':'🇲🇬','malawian':'🇲🇼','malaysian':'🇲🇾','maldivian':'🇲🇻','malian':'🇲🇱',
  'maltese':'🇲🇹','mauritanian':'🇲🇷','mauritian':'🇲🇺','mexican':'🇲🇽','moldovan':'🇲🇩',
  'mongolian':'🇲🇳','montenegrin':'🇲🇪','moroccan':'🇲🇦','mozambican':'🇲🇿','namibian':'🇳🇦',
  'nepalese':'🇳🇵','nepali':'🇳🇵','new zealander':'🇳🇿','kiwi':'🇳🇿','nicaraguan':'🇳🇮',
  'nigerien':'🇳🇪','nigerian':'🇳🇬','norwegian':'🇳🇴','omani':'🇴🇲','pakistani':'🇵🇰',
  'palestinian':'🇵🇸','panamanian':'🇵🇦','paraguayan':'🇵🇾','peruvian':'🇵🇪','polish':'🇵🇱',
  'portuguese':'🇵🇹','puerto rican':'🇵🇷','qatari':'🇶🇦','romanian':'🇷🇴','russian':'🇷🇺',
  'rwandan':'🇷🇼','salvadoran':'🇸🇻','saudi':'🇸🇦','scottish':'🏴󠁧󠁢󠁳󠁣󠁴󠁿','senegalese':'🇸🇳',
  'serbian':'🇷🇸','singaporean':'🇸🇬','slovak':'🇸🇰','slovenian':'🇸🇮','somali':'🇸🇴',
  'south african':'🇿🇦','spanish':'🇪🇸','sri lankan':'🇱🇰','sudanese':'🇸🇩','surinamese':'🇸🇷',
  'swedish':'🇸🇪','swiss':'🇨🇭','syrian':'🇸🇾','taiwanese':'🇹🇼','tajik':'🇹🇯',
  'tanzanian':'🇹🇿','thai':'🇹🇭','togolese':'🇹🇬','trinidadian':'🇹🇹','tunisian':'🇹🇳',
  'turkish':'🇹🇷','turkmen':'🇹🇲','ugandan':'🇺🇬','ukrainian':'🇺🇦','uruguayan':'🇺🇾',
  'uzbek':'🇺🇿','venezuelan':'🇻🇪','vietnamese':'🇻🇳','welsh':'🏴󠁧󠁢󠁷󠁬󠁳󠁿','yemeni':'🇾🇪',
  'zambian':'🇿🇲','zimbabwean':'🇿🇼',
  // Country names
  'usa':'🇺🇸','us':'🇺🇸','united states':'🇺🇸','uk':'🇬🇧','united kingdom':'🇬🇧',
  'brazil':'🇧🇷','mexico':'🇲🇽','canada':'🇨🇦','france':'🇫🇷','germany':'🇩🇪',
  'italy':'🇮🇹','spain':'🇪🇸','portugal':'🇵🇹','japan':'🇯🇵','china':'🇨🇳',
  'india':'🇮🇳','australia':'🇦🇺','argentina':'🇦🇷','colombia':'🇨🇴','chile':'🇨🇱',
  'peru':'🇵🇪','nigeria':'🇳🇬','south africa':'🇿🇦','egypt':'🇪🇬','kenya':'🇰🇪',
  'israel':'🇮🇱','turkey':'🇹🇷','russia':'🇷🇺','ukraine':'🇺🇦','poland':'🇵🇱',
  'netherlands':'🇳🇱','sweden':'🇸🇪','norway':'🇳🇴','denmark':'🇩🇰','finland':'🇫🇮',
  'ireland':'🇮🇪','scotland':'🏴󠁧󠁢󠁳󠁣󠁴󠁿','england':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','wales':'🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  'switzerland':'🇨🇭','austria':'🇦🇹','belgium':'🇧🇪','greece':'🇬🇷','czech republic':'🇨🇿',
  'czechia':'🇨🇿','hungary':'🇭🇺','romania':'🇷🇴','croatia':'🇭🇷','serbia':'🇷🇸',
  'thailand':'🇹🇭','vietnam':'🇻🇳','philippines':'🇵🇭','indonesia':'🇮🇩','malaysia':'🇲🇾',
  'singapore':'🇸🇬','south korea':'🇰🇷','korea':'🇰🇷','taiwan':'🇹🇼','pakistan':'🇵🇰',
  'bangladesh':'🇧🇩','nepal':'🇳🇵','sri lanka':'🇱🇰','iran':'🇮🇷','iraq':'🇮🇶',
  'saudi arabia':'🇸🇦','uae':'🇦🇪','qatar':'🇶🇦','kuwait':'🇰🇼','jordan':'🇯🇴',
  'lebanon':'🇱🇧','morocco':'🇲🇦','tunisia':'🇹🇳','ghana':'🇬🇭','ethiopia':'🇪🇹',
  'tanzania':'🇹🇿','cuba':'🇨🇺','jamaica':'🇯🇲','puerto rico':'🇵🇷','haiti':'🇭🇹',
  'new zealand':'🇳🇿','iceland':'🇮🇸','luxembourg':'🇱🇺',
};

// Location-based flag mapping (city/state → country flag)
const LOCATION_FLAGS = {
  // US states & cities
  'tx':'🇺🇸','texas':'🇺🇸','austin':'🇺🇸','houston':'🇺🇸','dallas':'🇺🇸','san antonio':'🇺🇸',
  'ca':'🇺🇸','california':'🇺🇸','los angeles':'🇺🇸','san francisco':'🇺🇸','san diego':'🇺🇸',
  'ny':'🇺🇸','new york':'🇺🇸','nyc':'🇺🇸','brooklyn':'🇺🇸','manhattan':'🇺🇸',
  'fl':'🇺🇸','florida':'🇺🇸','miami':'🇺🇸','orlando':'🇺🇸','tampa':'🇺🇸',
  'il':'🇺🇸','illinois':'🇺🇸','chicago':'🇺🇸',
  'wa':'🇺🇸','washington':'🇺🇸','seattle':'🇺🇸',
  'co':'🇺🇸','colorado':'🇺🇸','denver':'🇺🇸','boulder':'🇺🇸',
  'ma':'🇺🇸','massachusetts':'🇺🇸','boston':'🇺🇸',
  'ga':'🇺🇸','georgia':'🇺🇸','atlanta':'🇺🇸',
  'pa':'🇺🇸','pennsylvania':'🇺🇸','philadelphia':'🇺🇸','pittsburgh':'🇺🇸',
  'az':'🇺🇸','arizona':'🇺🇸','phoenix':'🇺🇸','scottsdale':'🇺🇸',
  'nc':'🇺🇸','north carolina':'🇺🇸','charlotte':'🇺🇸','raleigh':'🇺🇸',
  'oh':'🇺🇸','ohio':'🇺🇸','columbus':'🇺🇸','cleveland':'🇺🇸',
  'or':'🇺🇸','oregon':'🇺🇸','portland':'🇺🇸',
  'nv':'🇺🇸','nevada':'🇺🇸','las vegas':'🇺🇸',
  'tn':'🇺🇸','tennessee':'🇺🇸','nashville':'🇺🇸','memphis':'🇺🇸',
  'mi':'🇺🇸','michigan':'🇺🇸','detroit':'🇺🇸',
  'mn':'🇺🇸','minnesota':'🇺🇸','minneapolis':'🇺🇸',
  'hi':'🇺🇸','hawaii':'🇺🇸','honolulu':'🇺🇸',
  'cedar creek':'🇺🇸',
  // International cities
  'london':'🇬🇧','manchester':'🇬🇧','birmingham':'🇬🇧','edinburgh':'🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'paris':'🇫🇷','lyon':'🇫🇷','marseille':'🇫🇷',
  'berlin':'🇩🇪','munich':'🇩🇪','hamburg':'🇩🇪','frankfurt':'🇩🇪',
  'rome':'🇮🇹','milan':'🇮🇹','florence':'🇮🇹','naples':'🇮🇹',
  'madrid':'🇪🇸','barcelona':'🇪🇸','seville':'🇪🇸',
  'lisbon':'🇵🇹','porto':'🇵🇹',
  'amsterdam':'🇳🇱','rotterdam':'🇳🇱',
  'tokyo':'🇯🇵','osaka':'🇯🇵','kyoto':'🇯🇵',
  'beijing':'🇨🇳','shanghai':'🇨🇳','shenzhen':'🇨🇳',
  'mumbai':'🇮🇳','delhi':'🇮🇳','bangalore':'🇮🇳','bengaluru':'🇮🇳',
  'sydney':'🇦🇺','melbourne':'🇦🇺','brisbane':'🇦🇺',
  'toronto':'🇨🇦','vancouver':'🇨🇦','montreal':'🇨🇦',
  'mexico city':'🇲🇽','guadalajara':'🇲🇽','cancun':'🇲🇽',
  'são paulo':'🇧🇷','sao paulo':'🇧🇷','rio de janeiro':'🇧🇷','rio':'🇧🇷',
  'buenos aires':'🇦🇷','bogota':'🇨🇴','bogotá':'🇨🇴','medellín':'🇨🇴','medellin':'🇨🇴',
  'lima':'🇵🇪','santiago':'🇨🇱',
  'seoul':'🇰🇷','bangkok':'🇹🇭','singapore':'🇸🇬','hong kong':'🇭🇰',
  'taipei':'🇹🇼','kuala lumpur':'🇲🇾','jakarta':'🇮🇩','manila':'🇵🇭',
  'dubai':'🇦🇪','abu dhabi':'🇦🇪','tel aviv':'🇮🇱','jerusalem':'🇮🇱',
  'istanbul':'🇹🇷','cairo':'🇪🇬','nairobi':'🇰🇪','cape town':'🇿🇦',
  'johannesburg':'🇿🇦','lagos':'🇳🇬','accra':'🇬🇭',
  'stockholm':'🇸🇪','oslo':'🇳🇴','copenhagen':'🇩🇰','helsinki':'🇫🇮',
  'dublin':'🇮🇪','zurich':'🇨🇭','geneva':'🇨🇭','vienna':'🇦🇹',
  'brussels':'🇧🇪','prague':'🇨🇿','budapest':'🇭🇺','warsaw':'🇵🇱',
  'bucharest':'🇷🇴','athens':'🇬🇷','zagreb':'🇭🇷','belgrade':'🇷🇸',
  'havana':'🇨🇺','kingston':'🇯🇲','auckland':'🇳🇿','reykjavik':'🇮🇸',
};

function getFlagForNationality(text) {
  if (!text) return '🏳️';
  const lower = text.trim().toLowerCase();
  // Try exact match first, then first word
  return COUNTRY_FLAGS[lower] || COUNTRY_FLAGS[lower.split(/[,\/]/)[0].trim()] || '🏳️';
}

function getFlagForLocation(text) {
  if (!text) return '📍';
  const lower = text.trim().toLowerCase();
  // Try full text, then each comma-separated part, then individual words
  if (LOCATION_FLAGS[lower]) return LOCATION_FLAGS[lower];
  if (COUNTRY_FLAGS[lower]) return COUNTRY_FLAGS[lower];
  const parts = lower.split(',').map(s => s.trim());
  for (const part of parts) {
    if (LOCATION_FLAGS[part]) return LOCATION_FLAGS[part];
    if (COUNTRY_FLAGS[part]) return COUNTRY_FLAGS[part];
  }
  // Try individual words (for "Austin, TX" → "austin" or "tx")
  for (const part of parts) {
    const words = part.split(/\s+/);
    for (const w of words) {
      if (LOCATION_FLAGS[w]) return LOCATION_FLAGS[w];
      if (COUNTRY_FLAGS[w]) return COUNTRY_FLAGS[w];
    }
  }
  return '📍';
}

function updateNationalityFlag() {
  const val = document.getElementById('fieldNationality').value;
  document.getElementById('nationalityFlag').textContent = getFlagForNationality(val);
}

function updateLocationFlag() {
  const val = document.getElementById('fieldLocationBase').value;
  document.getElementById('locationFlag').textContent = getFlagForLocation(val);
}

// =============================================
// DIRTY TRACKING
// =============================================

function getFormSnapshot() {
  return JSON.stringify({
    display_name: document.getElementById('fieldDisplayName').value.trim(),
    pronouns: document.getElementById('fieldPronouns').value.trim(),
    bio: document.getElementById('fieldBio').value.trim(),
    nationality: document.getElementById('fieldNationality').value.trim(),
    location_base: document.getElementById('fieldLocationBase').value.trim(),
    birthday: document.getElementById('fieldBirthday').value,
    phone: document.getElementById('fieldPhone').value.trim(),
    instagram: document.getElementById('fieldInstagram').value.trim().replace(/^@/, ''),
    links: collectLinks(),
  });
}

function updateSaveButton() {
  const btn = document.getElementById('saveProfileBtn');
  const dirty = getFormSnapshot() !== savedSnapshot;
  btn.disabled = !dirty;
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
    updateSaveButton();
  });

  // Bio character counter
  document.getElementById('fieldBio').addEventListener('input', updateBioCount);

  // Flag updates on typing
  document.getElementById('fieldNationality').addEventListener('input', updateNationalityFlag);
  document.getElementById('fieldLocationBase').addEventListener('input', updateLocationFlag);

  // Dirty tracking on all form fields
  const textFields = ['fieldDisplayName', 'fieldPronouns', 'fieldBio', 'fieldNationality',
    'fieldLocationBase', 'fieldPhone', 'fieldInstagram'];
  textFields.forEach(id => {
    document.getElementById(id).addEventListener('input', updateSaveButton);
  });
  document.getElementById('fieldBirthday').addEventListener('change', updateSaveButton);

  // Links container — listen for input on dynamically added link fields
  document.getElementById('linksContainer').addEventListener('input', updateSaveButton);
}
