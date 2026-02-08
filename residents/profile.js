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
let userVehicles = []; // vehicles the user owns or drives

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
  const [profileRes, ownedRes, driverRes] = await Promise.all([
    supabase
      .from('app_users')
      .select('id, display_name, first_name, last_name, email, role, avatar_url, bio, phone, phone2, whatsapp, gender, pronouns, birthday, instagram, links, nationality, location_base, privacy_settings')
      .eq('id', currentUser.id)
      .single(),
    supabase
      .from('vehicles')
      .select('id, name, vehicle_make, vehicle_model, year, color, color_hex, vin, image_url')
      .eq('owner_id', currentUser.id)
      .eq('is_active', true)
      .order('display_order'),
    supabase
      .from('vehicle_drivers')
      .select('vehicle_id, vehicles:vehicle_id(id, name, vehicle_make, vehicle_model, year, color, color_hex, vin, image_url)')
      .eq('app_user_id', currentUser.id),
  ]);

  if (profileRes.error) {
    showToast('Failed to load profile', 'error');
    return;
  }

  profileData = profileRes.data;

  // Merge owned + driver vehicles, deduplicate
  const owned = (ownedRes.data || []).map(v => ({ ...v, relationship: 'Owner' }));
  const driven = (driverRes.data || [])
    .map(d => d.vehicles)
    .filter(Boolean)
    .map(v => ({ ...v, relationship: 'Driver' }));
  const seen = new Set();
  userVehicles = [];
  for (const v of [...owned, ...driven]) {
    if (!seen.has(v.id)) {
      seen.add(v.id);
      userVehicles.push(v);
    }
  }

  renderProfile();
  renderVehicles();
}

function getDisplayName(d) {
  if (d.first_name && d.last_name) return `${d.first_name} ${d.last_name}`;
  if (d.first_name) return d.first_name;
  return d.display_name || d.email;
}

function renderProfile() {
  const d = profileData;
  const displayName = getDisplayName(d);

  // Header section
  renderAvatar(d.avatar_url, displayName);
  document.getElementById('profileName').textContent = displayName;
  const roleEl = document.getElementById('profileRole');
  roleEl.textContent = (d.role || 'resident').charAt(0).toUpperCase() + (d.role || 'resident').slice(1);
  roleEl.className = 'role-badge ' + (d.role || 'resident');

  // Form fields
  document.getElementById('fieldFirstName').value = d.first_name || '';
  document.getElementById('fieldLastName').value = d.last_name || '';
  document.getElementById('fieldDisplayName').value = d.display_name || '';
  document.getElementById('fieldGender').value = d.gender || '';
  document.getElementById('fieldBio').value = d.bio || '';
  document.getElementById('fieldNationality').value = d.nationality || '';
  document.getElementById('fieldLocationBase').value = d.location_base || '';
  document.getElementById('fieldBirthday').value = d.birthday || '';
  document.getElementById('fieldPhone').value = d.phone || '';
  document.getElementById('fieldPhone2').value = d.phone2 || '';
  document.getElementById('fieldWhatsApp').value = d.whatsapp || '';
  document.getElementById('fieldInstagram').value = d.instagram || '';

  // Bio counter
  updateBioCount();

  // Flags
  updateNationalityFlag();
  updateLocationFlag();

  // Links
  renderLinks(d.links || []);

  // Privacy controls
  renderPrivacyControls();

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
    const firstName = document.getElementById('fieldFirstName').value.trim() || null;
    const lastName = document.getElementById('fieldLastName').value.trim() || null;

    const updates = {
      first_name: firstName,
      last_name: lastName,
      display_name: document.getElementById('fieldDisplayName').value.trim() || null,
      gender: document.getElementById('fieldGender').value || null,
      bio: document.getElementById('fieldBio').value.trim() || null,
      nationality: document.getElementById('fieldNationality').value.trim() || null,
      location_base: document.getElementById('fieldLocationBase').value.trim() || null,
      birthday: document.getElementById('fieldBirthday').value || null,
      phone: document.getElementById('fieldPhone').value.trim() || null,
      phone2: document.getElementById('fieldPhone2').value.trim() || null,
      whatsapp: document.getElementById('fieldWhatsApp').value.trim() || null,
      instagram: document.getElementById('fieldInstagram').value.trim().replace(/^@/, '') || null,
      links: collectLinks(),
      privacy_settings: collectPrivacySettings(),
    };

    const { error } = await supabase
      .from('app_users')
      .update(updates)
      .eq('id', currentUser.id);

    if (error) throw error;

    // Update local state
    Object.assign(profileData, updates);

    // Update header name
    const headerName = getDisplayName(profileData);
    document.getElementById('profileName').textContent = headerName;

    // Update cached auth state so header updates on other pages
    updateCachedAuth({ display_name: updates.display_name, first_name: updates.first_name, last_name: updates.last_name });

    // Update this page's header
    const userInfoEl = document.getElementById('userInfo');
    if (userInfoEl) {
      const nameSpan = userInfoEl.querySelector('.user-profile-name');
      if (nameSpan) nameSpan.textContent = headerName;
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
    first_name: document.getElementById('fieldFirstName').value.trim(),
    last_name: document.getElementById('fieldLastName').value.trim(),
    display_name: document.getElementById('fieldDisplayName').value.trim(),
    gender: document.getElementById('fieldGender').value,
    bio: document.getElementById('fieldBio').value.trim(),
    nationality: document.getElementById('fieldNationality').value.trim(),
    location_base: document.getElementById('fieldLocationBase').value.trim(),
    birthday: document.getElementById('fieldBirthday').value,
    phone: document.getElementById('fieldPhone').value.trim(),
    phone2: document.getElementById('fieldPhone2').value.trim(),
    whatsapp: document.getElementById('fieldWhatsApp').value.trim(),
    instagram: document.getElementById('fieldInstagram').value.trim().replace(/^@/, ''),
    links: collectLinks(),
    privacy: collectPrivacySettings(),
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
  const textFields = ['fieldFirstName', 'fieldLastName', 'fieldDisplayName', 'fieldBio', 'fieldNationality',
    'fieldLocationBase', 'fieldPhone', 'fieldPhone2', 'fieldWhatsApp', 'fieldInstagram'];
  textFields.forEach(id => {
    document.getElementById(id).addEventListener('input', updateSaveButton);
  });
  document.getElementById('fieldBirthday').addEventListener('change', updateSaveButton);
  document.getElementById('fieldGender').addEventListener('change', updateSaveButton);

  // Links container — listen for input on dynamically added link fields
  document.getElementById('linksContainer').addEventListener('input', updateSaveButton);

  // Privacy dropdowns — Facebook-style icon menus
  initPrivacyDropdowns();

  // Vehicle card expand/collapse
  document.getElementById('vehiclesContainer').addEventListener('click', (e) => {
    const header = e.target.closest('.profile-vehicle-header');
    if (!header) return;
    const card = header.closest('.profile-vehicle-card');
    card.toggleAttribute('open');
  });
}

// =============================================
// VEHICLES
// =============================================

function renderVehicles() {
  const section = document.getElementById('vehiclesSection');
  const container = document.getElementById('vehiclesContainer');

  if (!userVehicles.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  container.innerHTML = userVehicles.map(v => {
    const make = v.vehicle_make || '';
    const model = v.vehicle_model || '';
    const year = v.year || '';
    const color = v.color || '';
    const vin = v.vin || '';
    const colorHex = v.color_hex || '#ccc';
    const subtitle = [make, model, year].filter(Boolean).join(' ');

    return `
      <div class="profile-vehicle-card">
        <div class="profile-vehicle-header">
          <span class="profile-vehicle-color" style="background:${escapeAttr(colorHex)}"></span>
          <span class="profile-vehicle-name">${escapeAttr(v.name)}</span>
          <span class="profile-vehicle-role">${escapeAttr(v.relationship)}</span>
          <span class="profile-vehicle-model">${escapeAttr(subtitle)}</span>
          <span class="profile-vehicle-chevron">&#9654;</span>
        </div>
        <div class="profile-vehicle-details">
          <div class="profile-vehicle-grid">
            <div class="profile-vehicle-detail">
              <span class="profile-vehicle-detail-label">Make</span>
              <span class="profile-vehicle-detail-value">${escapeAttr(make) || '—'}</span>
            </div>
            <div class="profile-vehicle-detail">
              <span class="profile-vehicle-detail-label">Model</span>
              <span class="profile-vehicle-detail-value">${escapeAttr(model) || '—'}</span>
            </div>
            <div class="profile-vehicle-detail">
              <span class="profile-vehicle-detail-label">Year</span>
              <span class="profile-vehicle-detail-value">${year || '—'}</span>
            </div>
            <div class="profile-vehicle-detail">
              <span class="profile-vehicle-detail-label">Color</span>
              <span class="profile-vehicle-detail-value">${escapeAttr(color) || '—'}</span>
            </div>
            ${vin ? `<div class="profile-vehicle-detail" style="grid-column:1/-1">
              <span class="profile-vehicle-detail-label">VIN</span>
              <span class="profile-vehicle-detail-value" style="font-family:monospace;font-size:0.8rem">${escapeAttr(vin)}</span>
            </div>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// =============================================
// PRIVACY SETTINGS
// =============================================

const PRIVACY_FIELDS = [
  { key: 'gender', label: 'Gender' },
  { key: 'bio', label: 'Bio' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'location_base', label: 'Location Base' },
  { key: 'birthday', label: 'Birthday' },
  { key: 'phone', label: 'Phone' },
  { key: 'phone2', label: 'Phone 2' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'links', label: 'Links' },
];

// Facebook-style privacy icons (globe = all guests, people = residents, lock = only me)
const PRIVACY_ICONS = {
  all_guests: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm5.9 7H11.1a14.7 14.7 0 0 0-1-4.3A6 6 0 0 1 13.9 7zM8 14c-.6 0-1.8-1.7-2-5h4c-.2 3.3-1.4 5-2 5zM6 7c.2-3.3 1.4-5 2-5s1.8 1.7 2 5H6zM5.9 2.7A14.7 14.7 0 0 0 4.9 7H2.1a6 6 0 0 1 3.8-4.3zM2.1 9h2.8a14.7 14.7 0 0 0 1 4.3A6 6 0 0 1 2.1 9zm8 4.3a14.7 14.7 0 0 0 1-4.3h2.8a6 6 0 0 1-3.8 4.3z"/></svg>',
  residents: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm0 1C3 8 0 9.8 0 11v1.5c0 .3.2.5.5.5h10c.3 0 .5-.2.5-.5V11c0-1.2-3-3-5.5-3zm5-1a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm1.6 2c.6.6 1.9 1.5 1.9 2v1.5c0 .3-.2.5-.5.5H12V11c0-.7-.4-1.4-.9-2h1z"/></svg>',
  only_me: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M12 7V5a4 4 0 0 0-8 0v2a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM6 5a2 2 0 1 1 4 0v2H6V5z"/></svg>',
};

const PRIVACY_LABELS = {
  all_guests: 'All Guests',
  residents: 'Residents Only',
  only_me: 'Only Me',
};

const PRIVACY_DESCS = {
  all_guests: 'Anyone visiting the property',
  residents: 'Only current residents',
  only_me: 'Hidden from everyone',
};

function collectPrivacySettings() {
  const settings = {};
  PRIVACY_FIELDS.forEach(f => {
    const widget = document.getElementById(`privacy_${f.key}`);
    if (widget) settings[f.key] = widget.dataset.value || 'all_guests';
  });
  return settings;
}

function renderPrivacyControls() {
  const saved = profileData.privacy_settings || {};

  PRIVACY_FIELDS.forEach(f => {
    const widget = document.getElementById(`privacy_${f.key}`);
    if (!widget) return;

    const currentValue = saved[f.key] || 'all_guests';
    widget.dataset.value = currentValue;

    widget.innerHTML = `
      <button type="button" class="profile-privacy-btn" title="${PRIVACY_LABELS[currentValue]}">
        ${PRIVACY_ICONS[currentValue]}
        <svg class="privacy-caret" viewBox="0 0 10 10" fill="currentColor"><path d="M3 4l2 2 2-2"/></svg>
      </button>
      <div class="profile-privacy-menu">
        ${['all_guests', 'residents', 'only_me'].map(val => `
          <button type="button" class="profile-privacy-option${val === currentValue ? ' selected' : ''}" data-value="${val}">
            ${PRIVACY_ICONS[val]}
            <span class="profile-privacy-option-text">
              <span class="profile-privacy-option-label">${PRIVACY_LABELS[val]}</span>
              <span class="profile-privacy-option-desc">${PRIVACY_DESCS[val]}</span>
            </span>
          </button>
        `).join('')}
      </div>
    `;
  });
}

// Toggle privacy dropdown menus
function initPrivacyDropdowns() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.profile-privacy-btn');
    if (btn) {
      e.stopPropagation();
      // Close any other open menus
      document.querySelectorAll('.profile-privacy-menu.open').forEach(m => {
        if (m !== btn.nextElementSibling) m.classList.remove('open');
      });
      btn.nextElementSibling.classList.toggle('open');
      return;
    }

    const option = e.target.closest('.profile-privacy-option');
    if (option) {
      e.stopPropagation();
      const menu = option.closest('.profile-privacy-menu');
      const widget = option.closest('.profile-privacy-widget');
      const newValue = option.dataset.value;
      widget.dataset.value = newValue;

      // Update button icon
      const triggerBtn = widget.querySelector('.profile-privacy-btn');
      triggerBtn.title = PRIVACY_LABELS[newValue];
      triggerBtn.innerHTML = `${PRIVACY_ICONS[newValue]}<svg class="privacy-caret" viewBox="0 0 10 10" fill="currentColor"><path d="M3 4l2 2 2-2"/></svg>`;

      // Update selected state in menu
      menu.querySelectorAll('.profile-privacy-option').forEach(o => {
        o.classList.toggle('selected', o.dataset.value === newValue);
      });

      menu.classList.remove('open');
      updateSaveButton();
      return;
    }

    // Close all menus on outside click
    document.querySelectorAll('.profile-privacy-menu.open').forEach(m => m.classList.remove('open'));
  });
}
