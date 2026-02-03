// Supabase configuration
const SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MzA0MjUsImV4cCI6MjA4NTUwNjQyNX0.yYkdQIq97GQgxK7yT2OQEPi5Tt-a7gM45aF8xjSD6wk';

// Initialize Supabase client
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// App state
let spaces = [];
let assignments = [];
let photoRequests = [];
let isAdminMode = false;
let currentView = 'card';
let currentSort = { column: 'availability', direction: 'asc' };

// DOM elements
const cardView = document.getElementById('cardView');
const tableView = document.getElementById('tableView');
const tableBody = document.getElementById('tableBody');
const cardViewBtn = document.getElementById('cardViewBtn');
const tableViewBtn = document.getElementById('tableViewBtn');
const adminToggle = document.getElementById('adminToggle');
const modeBadge = document.getElementById('modeBadge');
const searchInput = document.getElementById('searchInput');
const priceFilter = document.getElementById('priceFilter');
const bathFilter = document.getElementById('bathFilter');
const availFilter = document.getElementById('availFilter');
const visibilityFilter = document.getElementById('visibilityFilter');
const clearFilters = document.getElementById('clearFilters');

// Modals
const photoRequestModal = document.getElementById('photoRequestModal');
const spaceDetailModal = document.getElementById('spaceDetailModal');
const photoUploadModal = document.getElementById('photoUploadModal');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  setupEventListeners();
  render();
});

// Load data from Supabase
async function loadData() {
  try {
    // Load spaces with parent info and amenities
    const { data: spacesData, error: spacesError } = await db
      .from('spaces')
      .select(`
        *,
        parent:parent_id(name),
        space_amenities(amenity:amenity_id(name)),
        photo_spaces(photo:photo_id(id,url,caption),display_order)
      `)
      .order('name');
    
    if (spacesError) throw spacesError;
    
    // Load active AND future assignments with people
    const { data: assignmentsData, error: assignmentsError } = await db
      .from('assignments')
      .select(`
        *,
        person:person_id(first_name, last_name, type, email, phone),
        assignment_spaces(space_id)
      `)
      .in('status', ['active', 'pending_contract', 'contract_sent'])
      .order('start_date');
    
    if (assignmentsError) throw assignmentsError;
    
    // Load photo requests
    const { data: requestsData, error: requestsError } = await db
      .from('photo_requests')
      .select('*')
      .in('status', ['pending', 'submitted']);
    
    if (requestsError) throw requestsError;
    
    spaces = spacesData || [];
    assignments = assignmentsData || [];
    photoRequests = requestsData || [];
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Map assignments to spaces and compute availability windows
    spaces.forEach(space => {
      // Get all assignments for this space, sorted by start date
      const spaceAssignments = assignments
        .filter(a => a.assignment_spaces?.some(as => as.space_id === space.id))
        .sort((a, b) => {
          const aStart = a.start_date ? new Date(a.start_date) : new Date(0);
          const bStart = b.start_date ? new Date(b.start_date) : new Date(0);
          return aStart - bStart;
        });
      
      // Find current assignment (active and either no end date or end date >= today)
      const currentAssignment = spaceAssignments.find(a => {
        if (a.status !== 'active') return false;
        if (!a.end_date) return true;
        return new Date(a.end_date) >= today;
      });
      
      // Find next future assignment (starts after current ends, or after today if no current)
      const availableFrom = currentAssignment?.end_date 
        ? new Date(currentAssignment.end_date)
        : today;
      
      const nextAssignment = spaceAssignments.find(a => {
        if (a === currentAssignment) return false;
        if (!a.start_date) return false;
        const startDate = new Date(a.start_date);
        return startDate > availableFrom;
      });
      
      space.currentAssignment = currentAssignment || null;
      space.nextAssignment = nextAssignment || null;
      space.availableFrom = currentAssignment ? (currentAssignment.end_date ? new Date(currentAssignment.end_date) : null) : today;
      space.availableUntil = nextAssignment?.start_date ? new Date(nextAssignment.start_date) : null;
      
      space.amenities = space.space_amenities?.map(sa => sa.amenity?.name).filter(Boolean) || [];
      space.photos = (space.photo_spaces || [])
        .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
        .map(ps => ({ ...ps.photo, display_order: ps.display_order }))
        .filter(p => p && p.url);
      space.photoRequests = photoRequests.filter(pr => pr.space_id === space.id);
    });
    
  } catch (error) {
    console.error('Error loading data:', error);
    alert('Failed to load data. Check console for details.');
  }
}

// Setup event listeners
function setupEventListeners() {
  // View toggle
  cardViewBtn.addEventListener('click', () => setView('card'));
  tableViewBtn.addEventListener('click', () => setView('table'));
  
  // Admin toggle
  adminToggle.addEventListener('click', toggleAdminMode);
  
  // Filters
  searchInput.addEventListener('input', render);
  priceFilter.addEventListener('change', render);
  bathFilter.addEventListener('change', render);
  availFilter.addEventListener('change', render);
  visibilityFilter.addEventListener('change', render);
  clearFilters.addEventListener('click', resetFilters);
  
  // Table sorting
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.sort));
  });
  
  // Modal close handlers
  document.getElementById('closeModal').addEventListener('click', () => {
    photoRequestModal.classList.add('hidden');
  });
  document.getElementById('closeDetailModal').addEventListener('click', () => {
    spaceDetailModal.classList.add('hidden');
  });
  document.getElementById('cancelPhotoRequest').addEventListener('click', () => {
    photoRequestModal.classList.add('hidden');
  });
  document.getElementById('submitPhotoRequest').addEventListener('click', handlePhotoRequestSubmit);
  
  // Close modals on backdrop click
  photoRequestModal.addEventListener('click', (e) => {
    if (e.target === photoRequestModal) photoRequestModal.classList.add('hidden');
  });
  spaceDetailModal.addEventListener('click', (e) => {
    if (e.target === spaceDetailModal) spaceDetailModal.classList.add('hidden');
  });
  photoUploadModal.addEventListener('click', (e) => {
    if (e.target === photoUploadModal) photoUploadModal.classList.add('hidden');
  });
  
  // Upload modal handlers
  document.getElementById('closeUploadModal').addEventListener('click', () => {
    photoUploadModal.classList.add('hidden');
  });
  document.getElementById('cancelPhotoUpload').addEventListener('click', () => {
    photoUploadModal.classList.add('hidden');
  });
  document.getElementById('submitPhotoUpload').addEventListener('click', handlePhotoUpload);
  document.getElementById('photoFile').addEventListener('change', handleFilePreview);
}

// View management
function setView(view) {
  currentView = view;
  cardViewBtn.classList.toggle('active', view === 'card');
  tableViewBtn.classList.toggle('active', view === 'table');
  cardView.classList.toggle('hidden', view !== 'card');
  tableView.classList.toggle('hidden', view !== 'table');
}

function toggleAdminMode() {
  isAdminMode = !isAdminMode;
  document.body.classList.toggle('admin-mode', isAdminMode);
  adminToggle.classList.toggle('active', isAdminMode);
  adminToggle.textContent = isAdminMode ? 'Exit Admin' : 'Enter Admin';
  modeBadge.textContent = isAdminMode ? 'Admin' : 'Consumer';
  modeBadge.classList.toggle('admin', isAdminMode);
  render();
}

// Filtering
function getFilteredSpaces() {
  let filtered = [...spaces];
  
  // Consumer mode: only show listed, non-secret dwelling spaces
  if (!isAdminMode) {
    filtered = filtered.filter(s => s.is_listed && !s.is_secret && s.can_be_dwelling);
  } else {
    // Admin can still filter by dwelling
    filtered = filtered.filter(s => s.can_be_dwelling);
  }
  
  // Search
  const search = searchInput.value.toLowerCase();
  if (search) {
    filtered = filtered.filter(s => 
      s.name.toLowerCase().includes(search) ||
      (s.description && s.description.toLowerCase().includes(search))
    );
  }
  
  // Price filter
  const price = priceFilter.value;
  if (price) {
    filtered = filtered.filter(s => {
      const rate = s.monthly_rate || 0;
      if (price === '0-400') return rate < 400;
      if (price === '400-700') return rate >= 400 && rate < 700;
      if (price === '700-1000') return rate >= 700 && rate < 1000;
      if (price === '1000+') return rate >= 1000;
      return true;
    });
  }
  
  // Bath filter
  const bath = bathFilter.value;
  if (bath) {
    filtered = filtered.filter(s => s.bath_privacy === bath);
  }
  
  // Availability filter
  const avail = availFilter.value;
  if (avail) {
    if (avail === 'available') {
      filtered = filtered.filter(s => !s.currentAssignment);
    } else if (avail === 'occupied') {
      filtered = filtered.filter(s => s.currentAssignment);
    }
  }
  
  // Visibility filter (admin only)
  if (isAdminMode) {
    const visibility = visibilityFilter.value;
    if (visibility === 'listed') {
      filtered = filtered.filter(s => s.is_listed && !s.is_secret);
    } else if (visibility === 'unlisted') {
      filtered = filtered.filter(s => !s.is_listed);
    } else if (visibility === 'secret') {
      filtered = filtered.filter(s => s.is_secret);
    }
  }
  
  // Sort
  filtered.sort((a, b) => {
    // Special handling for availability sort
    if (currentSort.column === 'availability') {
      const aEndDate = a.currentAssignment?.end_date ? new Date(a.currentAssignment.end_date) : null;
      const bEndDate = b.currentAssignment?.end_date ? new Date(b.currentAssignment.end_date) : null;
      const aOccupied = !!a.currentAssignment;
      const bOccupied = !!b.currentAssignment;
      
      // Available now comes first
      if (!aOccupied && bOccupied) return currentSort.direction === 'asc' ? -1 : 1;
      if (aOccupied && !bOccupied) return currentSort.direction === 'asc' ? 1 : -1;
      
      // Both available - sort by name
      if (!aOccupied && !bOccupied) return a.name.localeCompare(b.name);
      
      // Both occupied - sort by end date
      if (aEndDate && bEndDate) {
        if (aEndDate < bEndDate) return currentSort.direction === 'asc' ? -1 : 1;
        if (aEndDate > bEndDate) return currentSort.direction === 'asc' ? 1 : -1;
      }
      // No end date goes to bottom
      if (aEndDate && !bEndDate) return -1;
      if (!aEndDate && bEndDate) return 1;
      
      return a.name.localeCompare(b.name);
    }
    
    let aVal = a[currentSort.column];
    let bVal = b[currentSort.column];
    
    // Handle occupant sorting
    if (currentSort.column === 'occupant') {
      aVal = a.currentAssignment?.person?.first_name || '';
      bVal = b.currentAssignment?.person?.first_name || '';
    }
    
    if (aVal === null || aVal === undefined) aVal = '';
    if (bVal === null || bVal === undefined) bVal = '';
    
    if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase();
      bVal = bVal.toLowerCase();
    }
    
    if (aVal < bVal) return currentSort.direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return currentSort.direction === 'asc' ? 1 : -1;
    return 0;
  });
  
  return filtered;
}

function resetFilters() {
  searchInput.value = '';
  priceFilter.value = '';
  bathFilter.value = '';
  availFilter.value = '';
  visibilityFilter.value = '';
  render();
}

function handleSort(column) {
  if (currentSort.column === column) {
    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.column = column;
    currentSort.direction = 'asc';
  }
  
  // Update header classes
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === column) {
      th.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
  
  render();
}

// Rendering
function render() {
  const filtered = getFilteredSpaces();
  renderCards(filtered);
  renderTable(filtered);
}

function renderCards(spaces) {
  cardView.innerHTML = spaces.map(space => {
    const occupant = space.currentAssignment?.person;
    const photo = space.photos[0];
    
    let badges = '';
    const isOccupied = !!space.currentAssignment;
    
    // Format availability window
    const formatDate = (d) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
    const availFromStr = space.availableFrom && space.availableFrom > new Date()
      ? formatDate(space.availableFrom)
      : 'NOW';
    const availUntilStr = space.availableUntil ? formatDate(space.availableUntil) : 'The Cows Come Home';

    const fromBadgeClass = availFromStr === 'NOW' ? 'available' : 'occupied';
    const untilBadgeClass = availUntilStr === 'The Cows Come Home' ? 'available' : 'occupied';
    badges += `<span class="badge ${fromBadgeClass}">Available: ${availFromStr}</span>`;
    badges += `<span class="badge ${untilBadgeClass} badge-right">Until: ${availUntilStr}</span>`;
    if (isAdminMode) {
      if (space.is_secret) badges += '<span class="badge secret">Secret</span>';
      else if (!space.is_listed) badges += '<span class="badge unlisted">Unlisted</span>';
    }
    
    const beds = getBedSummary(space);
    const bathText = space.bath_privacy ? `${space.bath_privacy} bath` : '';
    
    let occupantHtml = '';
    if (isAdminMode && isOccupied) {
      const name = `${occupant.first_name} ${occupant.last_name || ''}`.trim();
      const endDate = space.currentAssignment.end_date 
        ? new Date(space.currentAssignment.end_date).toLocaleDateString()
        : 'No end date';
      occupantHtml = `
        <div class="card-occupant">
          <strong>${name}</strong> · ${occupant.type}<br>
          <small>Until: ${endDate}</small>
        </div>
      `;
    }
    
    const pendingRequests = space.photoRequests?.filter(r => r.status === 'pending').length || 0;
    
    return `
      <div class="space-card" onclick="showSpaceDetail('${space.id}')">
        <div class="card-image">
          ${photo 
            ? `<img src="${photo.url}" alt="${space.name}">`
            : `<div class="no-photo">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="M21 15l-5-5L5 21"/>
                </svg>
                No photos
              </div>`
          }
          <div class="card-badges">${badges}</div>
        </div>
        <div class="card-body">
          <div class="card-title">${space.name}</div>
          ${space.location ? `<div class="card-parent">in ${space.location}</div>` : (space.parent ? `<div class="card-parent">in ${space.parent.name}</div>` : '')}
          <div class="card-details">
            ${space.sq_footage ? `<span>${space.sq_footage} sq ft</span>` : ''}
            ${beds ? `<span>${beds}</span>` : ''}
            ${bathText ? `<span>${bathText}</span>` : ''}
          </div>
${space.monthly_rate ? `<div class="card-price">$${space.monthly_rate}<span>/mo</span></div>` : ''}
          ${space.amenities.length ? `
            <div class="card-amenities">
              ${space.amenities.slice(0, 4).map(a => `<span class="amenity-tag">${a}</span>`).join('')}
              ${space.amenities.length > 4 ? `<span class="amenity-tag">+${space.amenities.length - 4}</span>` : ''}
            </div>
          ` : ''}
          ${occupantHtml}
          <div class="card-actions">
            <button class="btn-small" onclick="event.stopPropagation(); openPhotoUpload('${space.id}', '${space.name}')">
              📤 Upload
            </button>
            <button class="btn-small" onclick="event.stopPropagation(); openPhotoRequest('${space.id}', '${space.name}')">
              📷 Request ${pendingRequests ? `(${pendingRequests})` : ''}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderTable(spaces) {
  tableBody.innerHTML = spaces.map(space => {
    const isOccupied = !!space.currentAssignment;
    const occupant = space.currentAssignment?.person;
    const beds = getBedSummary(space);
    
    const occupantName = occupant 
      ? `${occupant.first_name} ${occupant.last_name || ''}`.trim()
      : '-';
    
    const endDate = space.currentAssignment?.end_date
      ? new Date(space.currentAssignment.end_date).toLocaleDateString()
      : '-';
    
    // Format availability window
    const formatDate = (d) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
    const availFromStr = space.availableFrom && space.availableFrom > new Date()
      ? formatDate(space.availableFrom)
      : 'NOW';
    const availUntilStr = space.availableUntil ? formatDate(space.availableUntil) : 'The Cows Come Home';

    let statusBadge = isOccupied
      ? '<span class="badge occupied">Occupied</span>'
      : '<span class="badge available">Available</span>';
    
    if (isAdminMode) {
      if (space.is_secret) statusBadge += ' <span class="badge secret">Secret</span>';
      else if (!space.is_listed) statusBadge += ' <span class="badge unlisted">Unlisted</span>';
    }
    
    return `
      <tr onclick="showSpaceDetail('${space.id}')" style="cursor:pointer;">
        <td><strong>${space.name}</strong>${space.location ? `<br><small style="color:var(--text-muted)">in ${space.location}</small>` : (space.parent ? `<br><small style="color:var(--text-muted)">in ${space.parent.name}</small>` : '')}</td>
        <td>${space.monthly_rate ? `$${space.monthly_rate}/mo` : '-'}</td>
        <td>${space.sq_footage || '-'}</td>
        <td>${beds || '-'}</td>
        <td>${space.bath_privacy || '-'}</td>
        <td>${space.amenities.slice(0, 3).join(', ') || '-'}</td>
        <td>${availFromStr}</td>
        <td>${availUntilStr}</td>
        <td class="admin-only">${occupantName}</td>
        <td class="admin-only">${endDate}</td>
        <td class="admin-only">${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

// Helpers
function getBedSummary(space) {
  const beds = [];
  if (space.beds_king) beds.push(`${space.beds_king} king`);
  if (space.beds_queen) beds.push(`${space.beds_queen} queen`);
  if (space.beds_double) beds.push(`${space.beds_double} double`);
  if (space.beds_twin) beds.push(`${space.beds_twin} twin`);
  if (space.beds_folding) beds.push(`${space.beds_folding} folding`);
  return beds.join(', ');
}

// Space detail modal
function showSpaceDetail(spaceId) {
  const space = spaces.find(s => s.id === spaceId);
  if (!space) return;
  
  document.getElementById('detailSpaceName').textContent = space.name;
  
  const isOccupied = !!space.currentAssignment;
  const occupant = space.currentAssignment?.person;
  
  let photosHtml = '';
  if (space.photos.length) {
    const photoItems = space.photos.map((p, idx) => {
      const orderControls = isAdminMode ? `
        <div class="photo-order-controls">
          <button onclick="event.stopPropagation(); movePhoto('${space.id}', '${p.id}', 'top')" title="Move to top">⇈</button>
          <button onclick="event.stopPropagation(); movePhoto('${space.id}', '${p.id}', 'up')" title="Move up">↑</button>
          <button onclick="event.stopPropagation(); movePhoto('${space.id}', '${p.id}', 'down')" title="Move down">↓</button>
          <button onclick="event.stopPropagation(); movePhoto('${space.id}', '${p.id}', 'bottom')" title="Move to bottom">⇊</button>
        </div>
      ` : '';
      return `
        <div class="detail-photo">
          <img src="${p.url}" alt="${p.caption || space.name}">
          ${orderControls}
        </div>
      `;
    }).join('');
    
    photosHtml = `
      <div class="detail-section detail-photos">
        <h3>Photos</h3>
        <div class="detail-photos-grid">
          ${photoItems}
        </div>
      </div>
    `;
  }
  
  let occupantHtml = '';
  if (isAdminMode && isOccupied) {
    const a = space.currentAssignment;
    occupantHtml = `
      <div class="detail-section">
        <h3>Current Occupant</h3>
        <p><strong>${occupant.first_name} ${occupant.last_name || ''}</strong> (${occupant.type})</p>
        ${occupant.email ? `<p>Email: ${occupant.email}</p>` : ''}
        ${occupant.phone ? `<p>Phone: ${occupant.phone}</p>` : ''}
        <p>Rate: $${a.rate_amount}/${a.rate_term}</p>
        <p>Start: ${a.start_date ? new Date(a.start_date).toLocaleDateString() : 'N/A'}</p>
        <p>End: ${a.end_date ? new Date(a.end_date).toLocaleDateString() : 'No end date'}</p>
      </div>
    `;
  }
  
  let photoRequestsHtml = '';
  if (isAdminMode && space.photoRequests?.length) {
    photoRequestsHtml = `
      <div class="detail-section photo-requests">
        <h3>Photo Requests</h3>
        ${space.photoRequests.map(pr => `
          <div class="photo-request-item">
            <div>
              <span class="request-status ${pr.status}">${pr.status}</span>
              <p style="margin-top:0.5rem">${pr.description}</p>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
  
  document.getElementById('spaceDetailBody').innerHTML = `
    ${photosHtml}
    <div class="detail-grid">
      <div class="detail-section">
        <h3>Details</h3>
        ${space.monthly_rate ? `<p><strong>Rate:</strong> $${space.monthly_rate}/mo</p>` : ''}
        <p><strong>Size:</strong> ${space.sq_footage ? `${space.sq_footage} sq ft` : 'N/A'}</p>
        <p><strong>Beds:</strong> ${getBedSummary(space) || 'N/A'}</p>
        <p><strong>Bathroom:</strong> ${space.bath_privacy || 'N/A'}${space.bath_fixture ? ` (${space.bath_fixture})` : ''}</p>
        <p><strong>Capacity:</strong> ${space.min_residents || 1}-${space.max_residents || '?'} residents</p>
        ${space.gender_restriction && space.gender_restriction !== 'none' ? `<p><strong>Restriction:</strong> ${space.gender_restriction} only</p>` : ''}
      </div>
      <div class="detail-section">
        <h3>Amenities</h3>
        ${space.amenities.length 
          ? `<p>${space.amenities.join(', ')}</p>`
          : '<p>No amenities listed</p>'
        }
      </div>
      ${occupantHtml}
    </div>
    ${space.description ? `
      <div class="detail-section detail-description">
        <h3>Description</h3>
        <p>${space.description}</p>
      </div>
    ` : ''}
    ${photoRequestsHtml}
    ${isAdminMode ? `
      <div style="margin-top:1rem;">
        <button class="btn-primary" onclick="openPhotoRequest('${space.id}', '${space.name}')">
          📷 Request Photo
        </button>
      </div>
    ` : ''}
  `;
  
  spaceDetailModal.classList.remove('hidden');
}

// Photo request handling
let currentPhotoRequestSpaceId = null;

function openPhotoRequest(spaceId, spaceName) {
  currentPhotoRequestSpaceId = spaceId;
  document.getElementById('modalSpaceName').textContent = spaceName;
  document.getElementById('photoDescription').value = '';
  photoRequestModal.classList.remove('hidden');
}

async function handlePhotoRequestSubmit() {
  const description = document.getElementById('photoDescription').value.trim();
  if (!description) {
    alert('Please describe the photo needed.');
    return;
  }
  
  try {
    const { error } = await db
      .from('photo_requests')
      .insert({
        space_id: currentPhotoRequestSpaceId,
        description: description,
        status: 'pending',
        requested_by: 'admin' // Could be a real user ID later
      });
    
    if (error) throw error;
    
    alert('Photo request submitted!');
    photoRequestModal.classList.add('hidden');
    
    // Reload data to reflect new request
    await loadData();
    render();
    
  } catch (error) {
    console.error('Error submitting photo request:', error);
    alert('Failed to submit request. Check console for details.');
  }
}

// Make functions globally accessible
window.showSpaceDetail = showSpaceDetail;
window.openPhotoRequest = openPhotoRequest;
window.openPhotoUpload = openPhotoUpload;
window.movePhoto = movePhoto;

// Photo ordering
async function movePhoto(spaceId, photoId, direction) {
  const space = spaces.find(s => s.id === spaceId);
  if (!space) return;
  
  const photos = [...space.photos];
  const idx = photos.findIndex(p => p.id === photoId);
  if (idx === -1) return;
  
  let newIdx;
  switch (direction) {
    case 'top':
      newIdx = 0;
      break;
    case 'up':
      newIdx = Math.max(0, idx - 1);
      break;
    case 'down':
      newIdx = Math.min(photos.length - 1, idx + 1);
      break;
    case 'bottom':
      newIdx = photos.length - 1;
      break;
    default:
      return;
  }
  
  if (newIdx === idx) return;
  
  // Reorder array
  const [photo] = photos.splice(idx, 1);
  photos.splice(newIdx, 0, photo);
  
  // Update display_order for all photos
  try {
    for (let i = 0; i < photos.length; i++) {
      await db
        .from('photo_spaces')
        .update({ display_order: i })
        .eq('space_id', spaceId)
        .eq('photo_id', photos[i].id);
    }
    
    // Reload and re-render
    await loadData();
    render();
    showSpaceDetail(spaceId);
    
  } catch (error) {
    console.error('Error reordering photos:', error);
    alert('Failed to reorder photos.');
  }
}

// Photo upload handling
let currentUploadSpaceId = null;

function openPhotoUpload(spaceId, spaceName) {
  currentUploadSpaceId = spaceId;
  document.getElementById('uploadModalSpaceName').textContent = spaceName;
  document.getElementById('photoFile').value = '';
  document.getElementById('photoCaption').value = '';
  document.getElementById('uploadPreview').innerHTML = '';
  photoUploadModal.classList.remove('hidden');
}

function handleFilePreview(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('uploadPreview').innerHTML = `
      <img src="${e.target.result}" style="max-width:100%; max-height:200px; border-radius:var(--radius);">
    `;
  };
  reader.readAsDataURL(file);
}

async function handlePhotoUpload() {
  const file = document.getElementById('photoFile').files[0];
  const caption = document.getElementById('photoCaption').value.trim();
  
  if (!file) {
    alert('Please select an image.');
    return;
  }
  
  const submitBtn = document.getElementById('submitPhotoUpload');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Uploading...';
  
  try {
    // Generate unique filename
    const ext = file.name.split('.').pop();
    const filename = `${currentUploadSpaceId}/${Date.now()}.${ext}`;
    
    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await db.storage
      .from('housephotos')
      .upload(filename, file);
    
    if (uploadError) throw uploadError;
    
    // Get public URL
    const { data: urlData } = db.storage
      .from('housephotos')
      .getPublicUrl(filename);
    
    const publicUrl = urlData.publicUrl;
    
    // Create photo record
    const { data: photoData, error: photoError } = await db
      .from('photos')
      .insert({
        url: publicUrl,
        caption: caption || null,
        uploaded_by: 'admin'
      })
      .select()
      .single();
    
    if (photoError) throw photoError;
    
    // Link to space
    const { error: linkError } = await db
      .from('photo_spaces')
      .insert({
        photo_id: photoData.id,
        space_id: currentUploadSpaceId
      });
    
    if (linkError) throw linkError;
    
    alert('Photo uploaded successfully!');
    photoUploadModal.classList.add('hidden');
    
    // Reload data to show new photo
    await loadData();
    render();
    
  } catch (error) {
    console.error('Error uploading photo:', error);
    alert('Failed to upload: ' + error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Upload';
  }
}
