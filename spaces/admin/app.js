// Admin view - Full access interface with authentication
import { supabase } from '../../shared/supabase.js';
import { initAuth, getAuthState, signOut, onAuthStateChange } from '../../shared/auth.js';
import { mediaService } from '../../shared/media-service.js';

// Toast notification system
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
    error: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
    warning: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
    info: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>'
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }
}

// App state
let spaces = [];
let assignments = [];
let photoRequests = [];
let authState = null;
let currentView = 'card';
let currentSort = { column: 'monthly_rate', direction: 'desc' };
let allTags = [];
let storageUsage = null;

// DOM elements
const loadingOverlay = document.getElementById('loadingOverlay');
const unauthorizedOverlay = document.getElementById('unauthorizedOverlay');
const appContent = document.getElementById('appContent');
const cardView = document.getElementById('cardView');
const tableView = document.getElementById('tableView');
const tableBody = document.getElementById('tableBody');
const cardViewBtn = document.getElementById('cardViewBtn');
const tableViewBtn = document.getElementById('tableViewBtn');
const searchInput = document.getElementById('searchInput');
const parentFilter = document.getElementById('parentFilter');
const bathFilter = document.getElementById('bathFilter');
const visibilityFilter = document.getElementById('visibilityFilter');
const showDwellings = document.getElementById('showDwellings');
const showNonDwellings = document.getElementById('showNonDwellings');
const clearFilters = document.getElementById('clearFilters');
const roleBadge = document.getElementById('roleBadge');
const userInfo = document.getElementById('userInfo');
const manageLink = document.getElementById('manageLink');

// Modals
const spaceDetailModal = document.getElementById('spaceDetailModal');
const photoUploadModal = document.getElementById('photoUploadModal');
const editSpaceModal = document.getElementById('editSpaceModal');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await init();
});

async function init() {
  try {
    // Initialize auth
    await initAuth();
    authState = getAuthState();

    // Check authorization
    if (!authState.isAuthenticated) {
      // Not logged in - redirect to login
      window.location.href = '/GenAlpacaOps/login/?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }

    if (!authState.isAuthorized) {
      // Logged in but not authorized
      loadingOverlay.classList.add('hidden');
      unauthorizedOverlay.classList.remove('hidden');
      setupUnauthorizedHandlers();
      return;
    }

    // User is authorized - show the app
    loadingOverlay.classList.add('hidden');
    appContent.classList.remove('hidden');

    // Update UI based on role
    updateRoleUI();

    // Listen for auth changes
    onAuthStateChange((state) => {
      authState = state;
      if (!state.isAuthorized) {
        window.location.href = '/GenAlpacaOps/spaces/';
      }
      updateRoleUI();
    });

    // Load data and setup
    await loadData();
    setupEventListeners();
    render();

    // Check for URL parameters to auto-open modals
    const urlParams = new URLSearchParams(window.location.search);
    const editSpaceId = urlParams.get('edit');
    if (editSpaceId) {
      // Verify the space exists
      const space = spaces.find(s => s.id === editSpaceId);
      if (space) {
        openEditSpace(editSpaceId);
        // Clear the URL parameter without reloading
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  } catch (error) {
    console.error('Init error:', error);
    loadingOverlay.innerHTML = `
      <div class="unauthorized-card">
        <h2>Error</h2>
        <p>${error.message}</p>
        <a href="/GenAlpacaOps/login/" class="btn-secondary">Try Again</a>
      </div>
    `;
  }
}

function setupUnauthorizedHandlers() {
  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await signOut();
    window.location.href = '/GenAlpacaOps/spaces/';
  });
}

function updateRoleUI() {
  if (!authState) return;

  // Update role badge
  roleBadge.textContent = authState.role;
  roleBadge.className = 'role-badge ' + authState.role;

  // Update user info
  userInfo.textContent = authState.user?.displayName || authState.user?.email || '';

  // Show/hide admin-only features
  if (authState.isAdmin) {
    document.body.classList.add('is-admin');
    manageLink.classList.remove('hidden');
  } else {
    document.body.classList.remove('is-admin');
    manageLink.classList.add('hidden');
  }
}

// Load data from Supabase (staff/admin have access to all data via RLS)
async function loadData() {
  try {
    // Load spaces with all related data (using new media tables)
    const { data: spacesData, error: spacesError } = await supabase
      .from('spaces')
      .select(`
        *,
        parent:parent_id(name),
        space_amenities(amenity:amenity_id(name)),
        media_spaces(
          display_order,
          is_primary,
          media:media_id(
            id,
            url,
            caption,
            title,
            media_type,
            category,
            file_size_bytes,
            media_tag_assignments(tag:tag_id(id,name,color,tag_group))
          )
        )
      `)
      .order('monthly_rate', { ascending: false, nullsFirst: false })
      .order('name');

    if (spacesError) throw spacesError;

    // Load all tags with usage counts for tagging UI
    allTags = await mediaService.getTagsWithUsage();

    // Check storage usage
    storageUsage = await mediaService.getStorageUsage();

    // Load active assignments with people
    const { data: assignmentsData, error: assignmentsError } = await supabase
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
    const { data: requestsData, error: requestsError } = await supabase
      .from('photo_requests')
      .select('*')
      .in('status', ['pending', 'submitted']);

    if (requestsError) throw requestsError;

    // Filter out archived spaces (client-side for compatibility if column doesn't exist)
    spaces = (spacesData || []).filter(s => !s.is_archived);
    assignments = assignmentsData || [];
    photoRequests = requestsData || [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Map assignments to spaces and compute availability windows
    spaces.forEach(space => {
      const spaceAssignments = assignments
        .filter(a => a.assignment_spaces?.some(as => as.space_id === space.id))
        .sort((a, b) => {
          const aStart = a.start_date ? new Date(a.start_date) : new Date(0);
          const bStart = b.start_date ? new Date(b.start_date) : new Date(0);
          return aStart - bStart;
        });

      const currentAssignment = spaceAssignments.find(a => {
        if (a.status !== 'active') return false;
        // Only use desired_departure_date if it's listed (for availability display)
        const effectiveEndDate = (a.desired_departure_listed && a.desired_departure_date) || a.end_date;
        if (!effectiveEndDate) return true;
        return new Date(effectiveEndDate) >= today;
      });

      // Get effective end date (only use desired_departure_date if listed)
      const getEffectiveEndDate = (assignment) => {
        if (!assignment) return null;
        if (assignment.desired_departure_listed && assignment.desired_departure_date) {
          return assignment.desired_departure_date;
        }
        return assignment.end_date;
      };

      const effectiveEndDate = getEffectiveEndDate(currentAssignment);
      const availableFrom = effectiveEndDate
        ? new Date(effectiveEndDate)
        : today;

      const nextAssignment = spaceAssignments.find(a => {
        if (a === currentAssignment) return false;
        if (!a.start_date) return false;
        const startDate = new Date(a.start_date);
        return startDate > availableFrom;
      });

      space.currentAssignment = currentAssignment || null;
      space.nextAssignment = nextAssignment || null;
      space.availableFrom = currentAssignment ? (effectiveEndDate ? new Date(effectiveEndDate) : null) : today;
      space.availableUntil = nextAssignment?.start_date ? new Date(nextAssignment.start_date) : null;

      space.amenities = space.space_amenities?.map(sa => sa.amenity?.name).filter(Boolean) || [];

      // Process media (new system) - flatten and add tags
      space.photos = (space.media_spaces || [])
        .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
        .map(ms => {
          if (!ms.media) return null;
          return {
            ...ms.media,
            display_order: ms.display_order,
            is_primary: ms.is_primary,
            tags: ms.media.media_tag_assignments?.map(mta => mta.tag).filter(Boolean) || []
          };
        })
        .filter(p => p && p.url);

      space.photoRequests = photoRequests.filter(pr => pr.space_id === space.id);
    });

  } catch (error) {
    console.error('Error loading data:', error);
    showToast('Failed to load data. Check console for details.', 'error');
  }
}

// Setup event listeners
function setupEventListeners() {
  // View toggle
  cardViewBtn.addEventListener('click', () => setView('card'));
  tableViewBtn.addEventListener('click', () => setView('table'));

  // Sign out
  document.getElementById('headerSignOutBtn').addEventListener('click', async () => {
    await signOut();
    window.location.href = '/GenAlpacaOps/spaces/';
  });

  // Filters
  searchInput.addEventListener('input', render);
  parentFilter.addEventListener('change', render);
  bathFilter.addEventListener('change', render);
  visibilityFilter.addEventListener('change', render);
  showDwellings?.addEventListener('change', render);
  showNonDwellings?.addEventListener('change', render);
  clearFilters.addEventListener('click', resetFilters);

  // Populate parent filter after data loads
  populateParentFilter();

  // Table sorting
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.sort));
  });

  // Modal handlers
  document.getElementById('closeDetailModal').addEventListener('click', () => {
    spaceDetailModal.classList.add('hidden');
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

  // Media picker tab switching
  document.querySelectorAll('.media-picker-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMediaPickerTab(btn.dataset.tab));
  });

  // Library tab handlers
  document.getElementById('cancelLibrarySelect')?.addEventListener('click', () => {
    photoUploadModal.classList.add('hidden');
  });
  document.getElementById('submitLibrarySelect')?.addEventListener('click', handleLibrarySelect);
  document.getElementById('libraryCategoryFilter')?.addEventListener('change', (e) => {
    activeLibraryFilters.category = e.target.value;
    loadLibraryMedia();
  });

  // Request tab handlers
  document.getElementById('cancelPhotoRequest')?.addEventListener('click', () => {
    photoUploadModal.classList.add('hidden');
  });
  document.getElementById('submitPhotoRequest')?.addEventListener('click', handlePhotoRequestSubmit);

  // Edit space modal handlers
  document.getElementById('closeEditModal').addEventListener('click', () => {
    editSpaceModal.classList.add('hidden');
  });
  document.getElementById('cancelEditSpace').addEventListener('click', () => {
    editSpaceModal.classList.add('hidden');
  });
  document.getElementById('submitEditSpace').addEventListener('click', handleEditSpaceSubmit);
  document.getElementById('archiveSpaceBtn')?.addEventListener('click', handleArchiveSpace);
  // Prevent form from submitting naturally (Enter key) - don't call handleEditSpaceSubmit
  // since the button click handler already handles it
  document.getElementById('editSpaceForm').addEventListener('submit', (e) => {
    e.preventDefault();
    // Don't call handleEditSpaceSubmit here - the button click handler does that
    // This prevents double-submission when pressing Enter
  });
  editSpaceModal.addEventListener('click', (e) => {
    if (e.target === editSpaceModal) editSpaceModal.classList.add('hidden');
  });

  // Add more photos link in edit modal
  document.getElementById('addMorePhotosLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    const spaceId = document.getElementById('editSpaceId').value;
    const spaceName = document.getElementById('editName').value;
    if (spaceId) {
      editSpaceModal.classList.add('hidden');
      openPhotoUpload(spaceId, spaceName);
    }
  });

  // Image lightbox
  const lightbox = document.getElementById('imageLightbox');

  lightbox?.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target.classList.contains('lightbox-close')) {
      closeLightbox();
    }
  });

  // Navigation buttons
  const prevBtn = document.getElementById('lightboxPrev');
  const nextBtn = document.getElementById('lightboxNext');
  if (prevBtn) prevBtn.addEventListener('click', (e) => { e.stopPropagation(); lightboxPrev(); });
  if (nextBtn) nextBtn.addEventListener('click', (e) => { e.stopPropagation(); lightboxNext(); });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    const lightbox = document.getElementById('imageLightbox');
    if (!lightbox || lightbox.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
      closeLightbox();
    } else if (e.key === 'ArrowLeft') {
      lightboxPrev();
    } else if (e.key === 'ArrowRight') {
      lightboxNext();
    }
  });
}

// Lightbox functionality
let lightboxGallery = [];
let lightboxIndex = 0;
let currentGalleryUrls = []; // Stores URLs of photos in currently displayed space

function setCurrentGallery(photos) {
  currentGalleryUrls = photos.map(p => p.url);
}

function openLightbox(imageUrl) {
  const lightbox = document.getElementById('imageLightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  if (lightbox && lightboxImage) {
    // Use current gallery if available and image is in it
    if (currentGalleryUrls.length > 0 && currentGalleryUrls.includes(imageUrl)) {
      lightboxGallery = [...currentGalleryUrls];
      lightboxIndex = lightboxGallery.indexOf(imageUrl);
    } else {
      lightboxGallery = [imageUrl];
      lightboxIndex = 0;
    }

    lightboxImage.src = imageUrl;
    lightbox.classList.remove('hidden');
    updateLightboxNav();
  }
}

function updateLightboxNav() {
  const prevBtn = document.getElementById('lightboxPrev');
  const nextBtn = document.getElementById('lightboxNext');
  if (prevBtn && nextBtn) {
    prevBtn.disabled = lightboxIndex <= 0;
    nextBtn.disabled = lightboxIndex >= lightboxGallery.length - 1;
    // Hide nav buttons if only one image
    const showNav = lightboxGallery.length > 1;
    prevBtn.style.display = showNav ? 'flex' : 'none';
    nextBtn.style.display = showNav ? 'flex' : 'none';
  }
}

function lightboxPrev() {
  if (lightboxIndex > 0) {
    lightboxIndex--;
    document.getElementById('lightboxImage').src = lightboxGallery[lightboxIndex];
    updateLightboxNav();
  }
}

function lightboxNext() {
  if (lightboxIndex < lightboxGallery.length - 1) {
    lightboxIndex++;
    document.getElementById('lightboxImage').src = lightboxGallery[lightboxIndex];
    updateLightboxNav();
  }
}

function closeLightbox() {
  const lightbox = document.getElementById('imageLightbox');
  if (lightbox) {
    lightbox.classList.add('hidden');
    document.getElementById('lightboxImage').src = '';
    lightboxGallery = [];
    lightboxIndex = 0;
  }
}

// View management
function setView(view) {
  currentView = view;
  cardViewBtn.classList.toggle('active', view === 'card');
  tableViewBtn.classList.toggle('active', view === 'table');
  cardView.classList.toggle('hidden', view !== 'card');
  tableView.classList.toggle('hidden', view !== 'table');
}

// Filtering
function getFilteredSpaces() {
  let filtered = [...spaces];

  // Search
  const search = searchInput.value.toLowerCase();
  if (search) {
    filtered = filtered.filter(s =>
      s.name.toLowerCase().includes(search) ||
      (s.description && s.description.toLowerCase().includes(search))
    );
  }

  // Parent filter
  const parent = parentFilter.value;
  if (parent) {
    filtered = filtered.filter(s => s.parent?.name === parent);
  }

  // Bath filter
  const bath = bathFilter.value;
  if (bath) {
    filtered = filtered.filter(s => s.bath_privacy === bath);
  }

  // Visibility filter
  const visibility = visibilityFilter.value;
  if (visibility === 'listed') {
    filtered = filtered.filter(s => s.is_listed && !s.is_secret);
  } else if (visibility === 'unlisted') {
    filtered = filtered.filter(s => !s.is_listed);
  } else if (visibility === 'secret') {
    filtered = filtered.filter(s => s.is_secret);
  }

  // Dwelling/Non-dwelling filter
  const dwellingsChecked = showDwellings?.checked ?? true;
  const nonDwellingsChecked = showNonDwellings?.checked ?? true;
  if (!dwellingsChecked || !nonDwellingsChecked) {
    filtered = filtered.filter(s => {
      const isDwelling = s.can_be_dwelling === true;
      if (dwellingsChecked && isDwelling) return true;
      if (nonDwellingsChecked && !isDwelling) return true;
      return false;
    });
  }

  // Sort: always put available spaces first, then apply selected sort
  filtered.sort((a, b) => {
    // Primary sort: available spaces first (same as public view)
    const aAvailable = !a.currentAssignment;
    const bAvailable = !b.currentAssignment;
    if (aAvailable && !bAvailable) return -1;
    if (!aAvailable && bAvailable) return 1;

    // Secondary sort based on currentSort column
    if (currentSort.column === 'availability') {
      const aEndDate = a.currentAssignment?.end_date ? new Date(a.currentAssignment.end_date) : null;
      const bEndDate = b.currentAssignment?.end_date ? new Date(b.currentAssignment.end_date) : null;

      if (aEndDate && bEndDate) {
        if (aEndDate < bEndDate) return currentSort.direction === 'asc' ? -1 : 1;
        if (aEndDate > bEndDate) return currentSort.direction === 'asc' ? 1 : -1;
      }
      if (aEndDate && !bEndDate) return -1;
      if (!aEndDate && bEndDate) return 1;

      return a.name.localeCompare(b.name);
    }

    let aVal = a[currentSort.column];
    let bVal = b[currentSort.column];

    if (currentSort.column === 'occupant') {
      aVal = a.currentAssignment?.person?.first_name || '';
      bVal = b.currentAssignment?.person?.first_name || '';
    }

    // Handle nulls - put them at the end regardless of sort direction
    const aNull = aVal === null || aVal === undefined || aVal === '';
    const bNull = bVal === null || bVal === undefined || bVal === '';
    if (aNull && !bNull) return 1;  // a goes to end
    if (!aNull && bNull) return -1; // b goes to end
    if (aNull && bNull) return a.name.localeCompare(b.name); // both null, sort by name

    if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase();
      bVal = bVal.toLowerCase();
    }

    if (aVal < bVal) return currentSort.direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return currentSort.direction === 'asc' ? 1 : -1;
    return a.name.localeCompare(b.name); // equal values, sort by name
  });

  return filtered;
}

function resetFilters() {
  searchInput.value = '';
  parentFilter.value = '';
  bathFilter.value = '';
  visibilityFilter.value = '';
  if (showDwellings) showDwellings.checked = true;
  if (showNonDwellings) showNonDwellings.checked = true;
  render();
}

// Populate parent filter dropdown from loaded spaces
function populateParentFilter() {
  const parents = new Set();
  spaces.forEach(s => {
    if (s.parent?.name) {
      parents.add(s.parent.name);
    }
  });

  const sortedParents = Array.from(parents).sort();

  while (parentFilter.options.length > 1) {
    parentFilter.remove(1);
  }

  sortedParents.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    parentFilter.appendChild(option);
  });
}

function handleSort(column) {
  if (currentSort.column === column) {
    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.column = column;
    currentSort.direction = 'asc';
  }

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

function renderCards(spacesToRender) {
  const isAdmin = authState?.isAdmin;

  cardView.innerHTML = spacesToRender.map(space => {
    const occupant = space.currentAssignment?.person;
    const photo = space.photos[0];
    const photoCount = space.photos.length;
    const isOccupied = !!space.currentAssignment;

    // Format availability window
    const formatDate = (d) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
    const availFromStr = space.availableFrom && space.availableFrom > new Date()
      ? formatDate(space.availableFrom)
      : 'NOW';
    const availUntilStr = space.availableUntil ? formatDate(space.availableUntil) : 'The Cows Come Home';

    const fromBadgeClass = availFromStr === 'NOW' ? 'available' : 'occupied';
    const untilBadgeClass = availUntilStr === 'The Cows Come Home' ? 'available' : 'occupied';

    let badges = `<span class="badge ${fromBadgeClass}">Available: ${availFromStr}</span>`;
    badges += `<span class="badge ${untilBadgeClass} badge-right">Until: ${availUntilStr}</span>`;

    // Visibility badges
    if (space.is_secret) badges += '<span class="badge secret">Secret</span>';
    else if (!space.is_listed) badges += '<span class="badge unlisted">Unlisted</span>';

    const beds = getBedSummary(space);
    const bathText = space.bath_privacy || '';
    const locationText = space.location || (space.parent ? space.parent.name : '');

    // Photo count overlay (only show if more than 1 photo)
    const photoCountHtml = photoCount > 1 ? `
      <div class="photo-count">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
          <path d="M21 15l-5-5L5 21"/>
        </svg>
        ${photoCount}
      </div>
    ` : '';

    let occupantHtml = '';
    if (isOccupied && occupant) {
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

    // Admin actions
    let actionsHtml = '';
    if (isAdmin) {
      actionsHtml = `
        <div class="card-actions">
          <button class="btn-edit" onclick="event.stopPropagation(); openEditSpace('${space.id}')">
            Edit
          </button>
          <button class="btn-small" onclick="event.stopPropagation(); openPhotoUpload('${space.id}', '${space.name.replace(/'/g, "\\'")}')">
            Images${pendingRequests ? ` (${pendingRequests} pending)` : ''}
          </button>
        </div>
      `;
    }

    return `
      <div class="space-card" onclick="showSpaceDetail('${space.id}')">
        <div class="card-image">
          ${photo
            ? `<img src="${photo.url}" alt="${space.name}" onclick="event.stopPropagation(); openLightbox('${photo.url}')" style="cursor: zoom-in;">`
            : `<div class="no-photo">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="M21 15l-5-5L5 21"/>
                </svg>
                No photos
              </div>`
          }
          ${photoCountHtml}
        </div>
        <div class="card-badges">${badges}</div>
        <div class="card-body">
          <div class="card-header">
            <div>
              <div class="card-title">${space.name}</div>
              ${locationText ? `<div class="card-subtitle">in ${locationText}</div>` : ''}
              ${space.description ? `<div class="card-description">${space.description}</div>` : ''}
            </div>
          </div>
          <div class="card-details">
            ${space.sq_footage ? `<span class="detail-item"><span class="detail-icon">📐</span>${space.sq_footage} sq ft</span>` : ''}
            ${beds ? `<span class="detail-item"><span class="detail-icon">🛏️</span>${beds}</span>` : ''}
            ${bathText ? `<span class="detail-item"><span class="detail-icon">🚿</span>${bathText} bath</span>` : ''}
          </div>
          <div class="card-footer">
            <div class="card-price">
              ${space.monthly_rate ? `$${space.monthly_rate}<span>/mo</span>` : '<span class="contact-text">Contact for rates</span>'}
            </div>
            ${space.amenities.length ? `
              <div class="card-amenities">
                ${space.amenities.slice(0, 3).map(a => `<span class="amenity-tag">${a}</span>`).join('')}
                ${space.amenities.length > 3 ? `<span class="amenity-tag amenity-more">+${space.amenities.length - 3}</span>` : ''}
              </div>
            ` : ''}
          </div>
          ${occupantHtml}
          ${actionsHtml}
        </div>
      </div>
    `;
  }).join('');
}

function renderTable(spacesToRender) {
  tableBody.innerHTML = spacesToRender.map(space => {
    const isOccupied = !!space.currentAssignment;
    const occupant = space.currentAssignment?.person;
    const beds = getBedSummary(space);

    const occupantName = occupant
      ? `${occupant.first_name} ${occupant.last_name || ''}`.trim()
      : '-';

    const endDate = space.currentAssignment?.end_date
      ? new Date(space.currentAssignment.end_date).toLocaleDateString()
      : '-';

    const formatDate = (d) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
    const availFromStr = space.availableFrom && space.availableFrom > new Date()
      ? formatDate(space.availableFrom)
      : 'NOW';
    const availUntilStr = space.availableUntil ? formatDate(space.availableUntil) : 'The Cows Come Home';

    let statusBadge = isOccupied
      ? '<span class="badge occupied">Occupied</span>'
      : '<span class="badge available">Available</span>';

    if (space.is_secret) statusBadge += ' <span class="badge secret">Secret</span>';
    else if (!space.is_listed) statusBadge += ' <span class="badge unlisted">Unlisted</span>';

    const thumbnail = space.photos.length > 0
      ? `<img src="${space.photos[0].url}" alt="" class="table-thumbnail" onclick="event.stopPropagation(); openLightbox('${space.photos[0].url}')" style="cursor: zoom-in;">`
      : `<div class="table-thumbnail-placeholder"></div>`;

    // Description (truncated)
    const description = space.description
      ? (space.description.length > 60 ? space.description.substring(0, 60) + '...' : space.description)
      : '';

    return `
      <tr onclick="showSpaceDetail('${space.id}')" style="cursor:pointer;">
        <td class="td-thumbnail">${thumbnail}</td>
        <td><strong>${space.name}</strong>${space.location ? `<br><small style="color:var(--text-muted)">in ${space.location}</small>` : (space.parent ? `<br><small style="color:var(--text-muted)">in ${space.parent.name}</small>` : '')}${description ? `<br><small class="td-description-inline">${description}</small>` : ''}</td>
        <td>${space.monthly_rate ? `$${space.monthly_rate}/mo` : '-'}</td>
        <td>${space.sq_footage || '-'}</td>
        <td>${beds || '-'}</td>
        <td>${space.bath_privacy || '-'}</td>
        <td>${space.amenities.slice(0, 3).join(', ') || '-'}</td>
        <td>${availFromStr}</td>
        <td>${availUntilStr}</td>
        <td>${occupantName}</td>
        <td>${endDate}</td>
        <td>${statusBadge}</td>
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

  const isAdmin = authState?.isAdmin;

  document.getElementById('detailSpaceName').textContent = space.name;

  const isOccupied = !!space.currentAssignment;
  const occupant = space.currentAssignment?.person;

  let photosHtml = '';
  if (space.photos.length) {
    setCurrentGallery(space.photos);
    const photoItems = space.photos.map((p, idx) => {
      return `
        <div class="detail-photo" onclick="openLightbox('${p.url}')" style="cursor: zoom-in;">
          <img src="${p.url}" alt="${p.caption || space.name}">
        </div>
      `;
    }).join('');

    const editLink = isAdmin ? `<a href="#" class="edit-photos-link" onclick="event.preventDefault(); openEditSpace('${space.id}'); spaceDetailModal.classList.add('hidden');">Edit photos</a>` : '';

    photosHtml = `
      <div class="detail-section detail-photos">
        <h3>Photos ${editLink}</h3>
        <div class="detail-photos-grid">
          ${photoItems}
        </div>
      </div>
    `;
  }

  let occupantHtml = '';
  if (isOccupied && occupant) {
    const a = space.currentAssignment;
    const desiredDepartureStr = a.desired_departure_date
      ? new Date(a.desired_departure_date).toLocaleDateString()
      : null;
    const earlyExitHtml = desiredDepartureStr
      ? `<p style="color: var(--accent);"><strong>Early Exit:</strong> ${desiredDepartureStr}</p>`
      : '';
    occupantHtml = `
      <div class="detail-section">
        <h3>Current Occupant</h3>
        <p><strong>${occupant.first_name} ${occupant.last_name || ''}</strong> (${occupant.type})</p>
        ${occupant.email ? `<p>Email: ${occupant.email}</p>` : ''}
        ${occupant.phone ? `<p>Phone: ${occupant.phone}</p>` : ''}
        <p>Rate: $${a.rate_amount}/${a.rate_term}</p>
        <p>Start: ${a.start_date ? new Date(a.start_date).toLocaleDateString() : 'N/A'}</p>
        <p>End: ${a.end_date ? new Date(a.end_date).toLocaleDateString() : 'No end date'}</p>
        ${earlyExitHtml}
        ${isAdmin ? `
          <div style="margin-top: 0.75rem;">
            <label style="font-size: 0.875rem; color: var(--text-muted);">Desired Departure (Early Exit):</label>
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem;">
              <input type="date" id="desiredDepartureDate" value="${a.desired_departure_date || ''}"
                style="padding: 0.25rem 0.5rem; border: 1px solid var(--border); border-radius: var(--radius);"
                onchange="updateDesiredDeparture('${a.id}', this.value)">
              ${a.desired_departure_date ? `
                <button onclick="toggleDesiredDepartureListed('${a.id}', ${!a.desired_departure_listed})"
                  style="padding: 0.25rem 0.75rem; border: 1px solid ${a.desired_departure_listed ? 'var(--error)' : 'var(--accent)'};
                    background: ${a.desired_departure_listed ? 'var(--error-light)' : 'var(--accent-light)'};
                    color: ${a.desired_departure_listed ? 'var(--error)' : 'var(--accent)'};
                    border-radius: var(--radius); cursor: pointer; font-size: 0.875rem; font-weight: 500;">
                  ${a.desired_departure_listed ? 'Unlist' : 'List'}
                </button>
                ${a.desired_departure_listed ? '<span style="color: var(--accent); font-size: 0.75rem;">✓ Listed for new renters</span>' : '<span style="color: var(--text-muted); font-size: 0.75rem;">Not listed yet</span>'}
              ` : ''}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  let photoRequestsHtml = '';
  if (space.photoRequests?.length) {
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
        <p><strong>Rate:</strong> ${space.monthly_rate ? `$${space.monthly_rate}/mo` : 'Contact for rates'}</p>
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
    ${isAdmin ? `
      <div style="margin-top:1rem; display: flex; gap: 0.75rem;">
        <button class="btn-primary" onclick="openEditSpace('${space.id}'); spaceDetailModal.classList.add('hidden');">
          Edit Space
        </button>
        <button class="btn-secondary" onclick="openPhotoUpload('${space.id}', '${space.name.replace(/'/g, "\\'")}'); spaceDetailModal.classList.add('hidden');">
          Add Images
        </button>
      </div>
    ` : ''}
  `;

  spaceDetailModal.classList.remove('hidden');
}

// Photo request handling
function openPhotoRequest(spaceId, spaceName) {
  // Now just opens the Images modal on the Request tab
  openPhotoUpload(spaceId, spaceName, 'dwelling', 'request');
}

async function handlePhotoRequestSubmit() {
  const description = document.getElementById('requestDescription')?.value.trim();
  if (!description) {
    showToast('Please describe the photo needed.', 'warning');
    return;
  }

  // Get suggested tags for the request
  const suggestedTags = [];
  document.querySelectorAll('#requestTagsContainer input[type="checkbox"]:checked').forEach(cb => {
    suggestedTags.push(cb.value);
  });

  try {
    const { error } = await supabase
      .from('photo_requests')
      .insert({
        space_id: currentUploadSpaceId,
        description: description,
        status: 'pending',
        requested_by: authState.appUser?.id || 'admin',
        suggested_tags: suggestedTags.length > 0 ? suggestedTags : null
      });

    if (error) throw error;

    showToast('Photo request submitted!', 'success');
    photoUploadModal.classList.add('hidden');

    await loadData();
    render();

  } catch (error) {
    console.error('Error submitting photo request:', error);
    showToast('Failed to submit request. Check console for details.', 'error');
  }
}

// Photo ordering (detail view)
async function movePhoto(spaceId, mediaId, direction) {
  if (!authState?.isAdmin) {
    showToast('Only admins can reorder photos', 'warning');
    return;
  }

  const space = spaces.find(s => s.id === spaceId);
  if (!space) return;

  const photos = [...space.photos];
  const idx = photos.findIndex(p => p.id === mediaId);
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

  const [photo] = photos.splice(idx, 1);
  photos.splice(newIdx, 0, photo);

  try {
    const mediaIds = photos.map(p => p.id);
    await mediaService.reorderInSpace(spaceId, mediaIds);

    await loadData();
    render();
    showSpaceDetail(spaceId);

  } catch (error) {
    console.error('Error reordering photos:', error);
    showToast('Failed to reorder photos.', 'error');
  }
}

// Photo upload handling
let currentUploadSpaceId = null;
let currentUploadContext = null; // 'dwelling', 'event', 'projects', etc.
let selectedLibraryMedia = new Set();
let libraryMedia = [];
let activeLibraryFilters = { tags: [], category: '' };

function openPhotoUpload(spaceId, spaceName, context = 'dwelling', initialTab = 'library') {
  if (!authState?.isAdmin) {
    showToast('Only admins can upload photos', 'warning');
    return;
  }
  currentUploadSpaceId = spaceId;
  currentUploadContext = context;
  selectedLibraryMedia.clear();
  selectedUploadFiles = [];

  document.getElementById('uploadModalSpaceName').textContent = spaceName;
  document.getElementById('photoFile').value = '';
  document.getElementById('photoBulkCaption').value = '';
  document.getElementById('uploadPreviewGrid').innerHTML = '';
  document.getElementById('bulkTagSection')?.classList.add('hidden');
  document.getElementById('uploadProgress')?.classList.add('hidden');

  // Set default category based on context
  const categorySelect = document.getElementById('photoCategory');
  if (categorySelect) {
    categorySelect.value = context === 'projects' ? 'projects' : 'space';
  }

  // Populate tags with context-aware defaults
  renderUploadTags();

  // Show auto-tag hint
  const autoTagHint = document.getElementById('autoTagHint');
  if (autoTagHint) {
    const autoTags = getAutoTagsForContext(context);
    autoTagHint.textContent = autoTags.length
      ? `Auto-tagged: ${autoTags.join(', ')}`
      : '';
  }

  // Show storage usage
  updateStorageIndicator();

  // Load library for the library tab
  loadLibraryMedia();

  // Render tag filter chips
  renderLibraryTagFilter();

  // Render request tab content
  renderRequestTab();

  // Switch to the specified initial tab
  switchMediaPickerTab(initialTab);

  photoUploadModal.classList.remove('hidden');
}

function renderRequestTab() {
  // Clear/reset the request form
  const descriptionEl = document.getElementById('requestDescription');
  if (descriptionEl) descriptionEl.value = '';

  // Render suggested tags (same as upload tags but pre-selected based on context)
  renderRequestTags();

  // Show existing requests for this space
  renderExistingRequests();
}

function renderRequestTags() {
  const container = document.getElementById('requestTagsContainer');
  if (!container) return;

  // Get auto-tags for current context
  const autoTags = getAutoTagsForContext(currentUploadContext);

  // Group tags by tag_group and sort by priority
  const grouped = {};
  allTags.forEach(tag => {
    const group = tag.tag_group || 'other';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(tag);
  });
  const sortedGroups = mediaService.sortTagGroups(grouped);

  // Render with inline add tag at top
  container.innerHTML = `
    <div class="inline-add-tag">
      <input type="text" data-quick-input placeholder="Add new tag..." class="quick-tag-input">
      <select data-quick-group class="quick-tag-select">
        <option value="">Category</option>
        ${[...new Set(allTags.map(t => t.tag_group).filter(Boolean))].sort().map(g =>
          `<option value="${g}">${g}</option>`
        ).join('')}
        <option value="__new__">+ New...</option>
      </select>
      <input type="text" data-quick-custom placeholder="New category" class="quick-tag-input hidden">
    </div>
    ${Object.entries(sortedGroups).map(([group, tags]) => `
      <div class="tag-row">
        <div class="tag-group-label">${group}</div>
        <div class="tag-checkboxes">
          ${tags.map(tag => {
            const isAuto = autoTags.includes(tag.name);
            return `
              <label class="tag-checkbox" style="--tag-color: ${tag.color || '#666'}">
                <input type="checkbox" value="${tag.name}" ${isAuto ? 'checked' : ''}>
                <span class="tag-chip">${tag.name}</span>
              </label>
            `;
          }).join('')}
        </div>
      </div>
    `).join('')}
  `;

  // Setup inline add tag handlers
  setupQuickAddTag('requestTagsContainer', renderRequestTags);
}

function renderExistingRequests() {
  const section = document.getElementById('existingRequestsSection');
  const list = document.getElementById('existingRequestsList');
  if (!section || !list) return;

  // Find the current space and its pending requests
  const space = spaces.find(s => s.id === currentUploadSpaceId);
  const pendingRequests = space?.photoRequests?.filter(r => r.status === 'pending') || [];

  if (pendingRequests.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  list.innerHTML = pendingRequests.map(pr => `
    <div class="existing-request-item">
      <span class="request-status ${pr.status}">${pr.status}</span>
      <p>${pr.description}</p>
      <small>Requested ${new Date(pr.created_at).toLocaleDateString()}</small>
    </div>
  `).join('');
}

function getAutoTagsForContext(context) {
  switch (context) {
    case 'dwelling':
      return ['listing'];
    case 'event':
      return ['listing'];
    case 'projects':
      return ['in-progress'];
    case 'social':
      return ['social'];
    default:
      return ['listing'];
  }
}

function switchMediaPickerTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.media-picker-tabs .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Update tab content
  document.getElementById('uploadTab')?.classList.toggle('active', tabName === 'upload');
  document.getElementById('libraryTab')?.classList.toggle('active', tabName === 'library');
  document.getElementById('requestTab')?.classList.toggle('active', tabName === 'request');
}

function renderUploadTags() {
  const container = document.getElementById('uploadTagsContainer');
  if (!container) return;

  // Get auto-tags for current context
  const autoTags = getAutoTagsForContext(currentUploadContext);

  // Group tags by tag_group and sort by priority
  const grouped = {};
  allTags.forEach(tag => {
    const group = tag.tag_group || 'other';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(tag);
  });
  const sortedGroups = mediaService.sortTagGroups(grouped);

  // Render with inline add tag at top
  container.innerHTML = `
    <div class="inline-add-tag">
      <input type="text" data-quick-input placeholder="Add new tag..." class="quick-tag-input">
      <select data-quick-group class="quick-tag-select">
        <option value="">Category</option>
        ${[...new Set(allTags.map(t => t.tag_group).filter(Boolean))].sort().map(g =>
          `<option value="${g}">${g}</option>`
        ).join('')}
        <option value="__new__">+ New...</option>
      </select>
      <input type="text" data-quick-custom placeholder="New category" class="quick-tag-input hidden">
    </div>
    ${Object.entries(sortedGroups).map(([group, tags]) => `
      <div class="tag-row">
        <div class="tag-group-label">${group}</div>
        <div class="tag-checkboxes">
          ${tags.map(tag => {
            const isAuto = autoTags.includes(tag.name);
            return `
              <label class="tag-checkbox" style="--tag-color: ${tag.color || '#666'}">
                <input type="checkbox" value="${tag.name}" ${isAuto ? 'checked' : ''}>
                <span class="tag-chip">${tag.name}</span>
              </label>
            `;
          }).join('')}
        </div>
      </div>
    `).join('')}
  `;

  // Setup inline add tag handlers
  setupQuickAddTag('uploadTagsContainer', renderUploadTags);
}

// Quick inline add tag functionality
function setupQuickAddTag(containerId, rerenderFn) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const input = container.querySelector('[data-quick-input]');
  const groupSelect = container.querySelector('[data-quick-group]');
  const customGroupInput = container.querySelector('[data-quick-custom]');

  if (!input) return;

  // Show/hide custom group input
  groupSelect?.addEventListener('change', (e) => {
    if (e.target.value === '__new__') {
      customGroupInput?.classList.remove('hidden');
      customGroupInput?.focus();
    } else {
      customGroupInput?.classList.add('hidden');
    }
  });

  // Create tag on Enter
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await quickCreateTag(containerId, rerenderFn);
    }
  });
}

async function quickCreateTag(containerId, rerenderFn) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const input = container.querySelector('[data-quick-input]');
  const groupSelect = container.querySelector('[data-quick-group]');
  const customGroupInput = container.querySelector('[data-quick-custom]');

  const name = input?.value.trim();
  if (!name) return;

  let group = groupSelect?.value;
  if (group === '__new__') {
    group = customGroupInput?.value.trim().toLowerCase();
  }
  if (group === '') group = null;

  try {
    const result = await mediaService.createTag(name, group);

    if (!result.success) {
      if (result.duplicate) {
        showToast('Tag already exists', 'warning');
      } else {
        showToast('Failed to create tag: ' + result.error, 'error');
      }
      return;
    }

    // Add to allTags
    allTags.push(result.tag);

    // Re-render tags
    if (rerenderFn) rerenderFn();

    // Select the newly created tag
    const checkbox = container.querySelector(`input[value="${result.tag.name}"]`);
    if (checkbox) checkbox.checked = true;

    showToast(`Tag "${name}" created`, 'success');

  } catch (error) {
    console.error('Error creating tag:', error);
    showToast('Failed to create tag', 'error');
  }
}

// Track existing tag groups for the dropdown
let existingTagGroups = [];

async function showAddTagForm(containerId) {
  // Get existing groups
  existingTagGroups = await mediaService.getTagGroups();

  const container = document.getElementById(containerId);
  if (!container) return;

  // Check if form already exists
  if (container.querySelector('.add-tag-form')) {
    container.querySelector('.add-tag-form').remove();
    return;
  }

  // Create inline form
  const form = document.createElement('div');
  form.className = 'add-tag-form';
  form.innerHTML = `
    <div class="add-tag-form-row">
      <input type="text" id="newTagName" placeholder="Tag name" class="tag-input">
      <select id="newTagGroup" class="tag-select">
        <option value="">Category (optional)</option>
        ${existingTagGroups.map(g => `<option value="${g}">${g}</option>`).join('')}
        <option value="__new__">+ New category...</option>
      </select>
      <input type="text" id="newTagGroupCustom" placeholder="New category" class="tag-input hidden">
      <button type="button" class="btn-small btn-primary" onclick="createNewTag('${containerId}')">Add</button>
      <button type="button" class="btn-small" onclick="hideAddTagForm('${containerId}')">Cancel</button>
    </div>
  `;

  // Insert before the add button
  const addBtn = container.querySelector('.add-tag-inline');
  if (addBtn) {
    addBtn.before(form);
  } else {
    container.appendChild(form);
  }

  // Focus the name input
  form.querySelector('#newTagName').focus();

  // Handle category dropdown change
  form.querySelector('#newTagGroup').addEventListener('change', (e) => {
    const customInput = form.querySelector('#newTagGroupCustom');
    if (e.target.value === '__new__') {
      customInput.classList.remove('hidden');
      customInput.focus();
    } else {
      customInput.classList.add('hidden');
    }
  });
}

function hideAddTagForm(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const form = container.querySelector('.add-tag-form');
  if (form) form.remove();
}

async function createNewTag(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const nameInput = container.querySelector('#newTagName');
  const groupSelect = container.querySelector('#newTagGroup');
  const customGroupInput = container.querySelector('#newTagGroupCustom');

  const name = nameInput?.value.trim();
  if (!name) {
    showToast('Please enter a tag name', 'warning');
    return;
  }

  let group = groupSelect?.value;
  if (group === '__new__') {
    group = customGroupInput?.value.trim().toLowerCase();
    if (!group) {
      showToast('Please enter a category name', 'warning');
      return;
    }
  }

  try {
    const result = await mediaService.createTag(name, group || null);

    if (!result.success) {
      if (result.duplicate) {
        showToast('A tag with that name already exists', 'warning');
      } else {
        showToast('Failed to create tag: ' + result.error, 'error');
      }
      return;
    }

    // Add to allTags
    allTags.push(result.tag);

    // Re-render tags and auto-select the new one
    renderUploadTags();

    // Select the newly created tag
    const checkbox = container.querySelector(`input[value="${result.tag.name}"]`);
    if (checkbox) checkbox.checked = true;

    // Also refresh request tags if visible
    if (document.getElementById('requestTagsContainer')) {
      renderRequestTags();
    }

  } catch (error) {
    console.error('Error creating tag:', error);
    showToast('Failed to create tag', 'error');
  }
}

function updateStorageIndicator() {
  const indicator = document.getElementById('storageIndicator');
  if (!indicator || !storageUsage) return;

  const percent = storageUsage.percent_used || 0;
  const used = mediaService.formatBytes(storageUsage.current_bytes || 0);
  const limit = mediaService.formatBytes(storageUsage.limit_bytes || 0);

  let colorClass = 'storage-ok';
  if (percent >= 90) colorClass = 'storage-critical';
  else if (percent >= 70) colorClass = 'storage-warning';

  indicator.innerHTML = `
    <div class="storage-bar ${colorClass}">
      <div class="storage-fill" style="width: ${Math.min(percent, 100)}%"></div>
    </div>
    <div class="storage-text">${used} / ${limit} (${percent.toFixed(1)}%)</div>
  `;
}

// Library tab functions
async function loadLibraryMedia() {
  console.log('loadLibraryMedia called with filters:', activeLibraryFilters);
  try {
    libraryMedia = await mediaService.search({
      category: activeLibraryFilters.category || null,
      tags: activeLibraryFilters.tags,
      limit: 100,
    });
    console.log('Library media loaded:', libraryMedia.length, 'items');
    renderLibraryGrid();
  } catch (error) {
    console.error('Error loading library:', error);
    libraryMedia = [];
    renderLibraryGrid();
  }
}

function renderLibraryTagFilter() {
  const container = document.getElementById('libraryTagFilter');
  if (!container) return;

  // Show only space tags as filter chips, sorted by usage count (most used first)
  const filterableTags = allTags
    .filter(t => t.tag_group === 'space')
    .sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));

  container.innerHTML = filterableTags.map(tag => `
    <button type="button"
      class="tag-filter-chip ${activeLibraryFilters.tags.includes(tag.name) ? 'active' : ''}"
      data-tag="${tag.name}"
      onclick="toggleLibraryTagFilter('${tag.name}')"
    >${tag.name}</button>
  `).join('');
}

function toggleLibraryTagFilter(tagName) {
  console.log('toggleLibraryTagFilter called:', tagName);
  const idx = activeLibraryFilters.tags.indexOf(tagName);
  if (idx >= 0) {
    activeLibraryFilters.tags.splice(idx, 1);
  } else {
    activeLibraryFilters.tags.push(tagName);
  }
  console.log('Active filters:', activeLibraryFilters.tags);
  renderLibraryTagFilter();
  loadLibraryMedia();
}

function renderLibraryGrid() {
  const container = document.getElementById('libraryMediaGrid');
  if (!container) return;

  if (!libraryMedia || libraryMedia.length === 0) {
    container.innerHTML = `
      <div class="library-empty">
        <p>No media found${activeLibraryFilters.tags.length ? ' matching filters' : ''}.</p>
        <p style="font-size: 0.8rem; margin-top: 0.5rem;">Try uploading new media or adjusting filters.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = libraryMedia.map(media => {
    const isSelected = selectedLibraryMedia.has(media.id);
    const tagsHtml = media.tags?.slice(0, 3).map(t => `<span class="tag-chip">${t.name}</span>`).join('') || '';

    return `
      <div class="library-media-item ${isSelected ? 'selected' : ''}"
           data-media-id="${media.id}"
           onclick="toggleLibraryMediaSelection('${media.id}')">
        <img src="${media.url}" alt="${media.caption || 'Media'}">
        ${tagsHtml ? `<div class="media-info">${tagsHtml}</div>` : ''}
      </div>
    `;
  }).join('');

  updateLibrarySelectButton();
}

function toggleLibraryMediaSelection(mediaId) {
  if (selectedLibraryMedia.has(mediaId)) {
    selectedLibraryMedia.delete(mediaId);
  } else {
    selectedLibraryMedia.add(mediaId);
  }
  renderLibraryGrid();
}

function updateLibrarySelectButton() {
  const btn = document.getElementById('submitLibrarySelect');
  if (!btn) return;

  const count = selectedLibraryMedia.size;
  btn.disabled = count === 0;
  btn.textContent = `Add Selected (${count})`;
}

async function handleLibrarySelect() {
  if (selectedLibraryMedia.size === 0) return;

  const submitBtn = document.getElementById('submitLibrarySelect');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Adding...';

  try {
    // Get current max display_order for the space
    const space = spaces.find(s => s.id === currentUploadSpaceId);
    let displayOrder = space?.photos?.length || 0;

    // Link each selected media to the space
    for (const mediaId of selectedLibraryMedia) {
      await mediaService.linkToSpace(mediaId, currentUploadSpaceId, displayOrder);
      displayOrder++;
    }

    showToast(`Added ${selectedLibraryMedia.size} media item(s) to space.`, 'success');
    photoUploadModal.classList.add('hidden');

    await loadData();
    render();

  } catch (error) {
    console.error('Error adding media from library:', error);
    showToast('Failed to add media: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    updateLibrarySelectButton();
  }
}

// Track selected files for upload
let selectedUploadFiles = [];

function handleFilePreview(e) {
  const files = Array.from(e.target.files);
  if (!files.length) {
    selectedUploadFiles = [];
    renderUploadPreviews();
    return;
  }

  selectedUploadFiles = files.map((file, idx) => ({
    file,
    id: `file-${Date.now()}-${idx}`,
    caption: '',
    preview: null
  }));

  // Load previews for each file
  selectedUploadFiles.forEach((item, idx) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      item.preview = e.target.result;
      renderUploadPreviews();
    };
    reader.readAsDataURL(item.file);
  });

  renderUploadPreviews();
}

function renderUploadPreviews() {
  const grid = document.getElementById('uploadPreviewGrid');
  const bulkSection = document.getElementById('bulkTagSection');
  const fileCountEl = document.getElementById('fileCount');
  const submitBtn = document.getElementById('submitPhotoUpload');

  if (!grid) return;

  // Update file count and show/hide bulk section
  const count = selectedUploadFiles.length;
  if (fileCountEl) fileCountEl.textContent = count;
  if (bulkSection) bulkSection.classList.toggle('hidden', count <= 1);
  if (submitBtn) submitBtn.textContent = count > 1 ? `Upload All (${count})` : 'Upload';

  if (count === 0) {
    grid.innerHTML = '';
    return;
  }

  grid.innerHTML = selectedUploadFiles.map((item, idx) => `
    <div class="upload-preview-item" data-file-id="${item.id}">
      ${item.preview
        ? `<img src="${item.preview}" alt="Preview ${idx + 1}">`
        : `<div style="display:flex;align-items:center;justify-content:center;height:100%;background:var(--bg);color:var(--text-muted);font-size:0.75rem;">Loading...</div>`
      }
      <span class="preview-index">${idx + 1}</span>
      <button type="button" class="preview-remove" onclick="removeUploadFile('${item.id}')" title="Remove">×</button>
      <div class="preview-caption">
        <input type="text"
          placeholder="Caption..."
          value="${item.caption}"
          onchange="updateFileCaption('${item.id}', this.value)"
          onclick="event.stopPropagation()">
      </div>
    </div>
  `).join('');
}

function removeUploadFile(fileId) {
  selectedUploadFiles = selectedUploadFiles.filter(f => f.id !== fileId);
  renderUploadPreviews();

  // Also clear the file input if all removed
  if (selectedUploadFiles.length === 0) {
    document.getElementById('photoFile').value = '';
  }
}

function updateFileCaption(fileId, caption) {
  const item = selectedUploadFiles.find(f => f.id === fileId);
  if (item) item.caption = caption;
}

// Guard against concurrent uploads
let isPhotoUploading = false;

async function handlePhotoUpload() {
  console.log('handlePhotoUpload called');
  console.log('isAdmin:', authState?.isAdmin);
  console.log('selectedUploadFiles:', selectedUploadFiles.length);

  // Guard against double-click or multiple submissions
  if (isPhotoUploading) {
    console.log('Upload already in progress, ignoring');
    return;
  }

  if (!authState?.isAdmin) {
    showToast('Only admins can upload photos', 'warning');
    return;
  }

  // Check if we have files to upload
  if (selectedUploadFiles.length === 0) {
    showToast('Please select at least one image.', 'warning');
    return;
  }

  // Set guard before any async work
  isPhotoUploading = true;

  const bulkCaption = document.getElementById('photoBulkCaption')?.value.trim() || '';
  const category = document.getElementById('photoCategory')?.value || 'space';

  // Get selected tags (apply to all)
  const selectedTags = [];
  document.querySelectorAll('#uploadTagsContainer input[type="checkbox"]:checked').forEach(cb => {
    selectedTags.push(cb.value);
  });

  const submitBtn = document.getElementById('submitPhotoUpload');
  const progressContainer = document.getElementById('uploadProgress');
  const progressFill = document.getElementById('uploadProgressFill');
  const progressText = document.getElementById('uploadProgressText');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Uploading...';

  // Show progress for multiple files
  if (selectedUploadFiles.length > 1 && progressContainer) {
    progressContainer.classList.remove('hidden');
  }

  let successCount = 0;
  let failCount = 0;
  const totalFiles = selectedUploadFiles.length;

  try {
    for (let i = 0; i < selectedUploadFiles.length; i++) {
      const item = selectedUploadFiles[i];

      // Update progress
      if (progressFill) progressFill.style.width = `${((i) / totalFiles) * 100}%`;
      if (progressText) progressText.textContent = `Uploading ${i + 1} of ${totalFiles}...`;

      // Use per-file caption if set, otherwise bulk caption
      const caption = item.caption || bulkCaption;

      try {
        const result = await mediaService.upload(item.file, {
          category,
          caption,
          tags: selectedTags,
          spaceId: currentUploadSpaceId,
        });

        if (result.success) {
          successCount++;
        } else {
          console.error(`Failed to upload ${item.file.name}:`, result.error);
          failCount++;
        }
      } catch (err) {
        console.error(`Error uploading ${item.file.name}:`, err);
        failCount++;
      }
    }

    // Final progress
    if (progressFill) progressFill.style.width = '100%';
    if (progressText) progressText.textContent = 'Complete!';

    // Show results
    if (failCount === 0) {
      if (successCount === 1) {
        showToast('Photo uploaded successfully!', 'success');
      } else {
        showToast(`${successCount} photos uploaded successfully!`, 'success');
      }
    } else {
      showToast(`Uploaded ${successCount} of ${totalFiles} photos. ${failCount} failed.`, 'warning');
    }

    // Refresh storage usage
    storageUsage = await mediaService.getStorageUsage();
    if (storageUsage && storageUsage.percent_used >= 80) {
      showToast(`Warning: Storage is ${storageUsage.percent_used.toFixed(1)}% full.`, 'warning');
    }

    photoUploadModal.classList.add('hidden');

    await loadData();
    render();

  } catch (error) {
    console.error('Error during upload:', error);
    showToast('Upload failed: ' + error.message, 'error');
  } finally {
    // Reset guard
    isPhotoUploading = false;
    submitBtn.disabled = false;
    submitBtn.textContent = selectedUploadFiles.length > 1 ? `Upload All (${selectedUploadFiles.length})` : 'Upload';
    if (progressContainer) progressContainer.classList.add('hidden');
    selectedUploadFiles = [];
  }
}

// Edit space functionality
let currentEditSpaceId = null;

function openEditSpace(spaceId) {
  if (!authState?.isAdmin) {
    showToast('Only admins can edit spaces', 'warning');
    return;
  }

  const space = spaces.find(s => s.id === spaceId);
  if (!space) {
    showToast('Space not found', 'error');
    return;
  }

  currentEditSpaceId = spaceId;
  document.getElementById('editSpaceName').textContent = space.name;
  document.getElementById('editSpaceId').value = spaceId;

  // Populate parent space dropdown
  const parentSelect = document.getElementById('editParentSpace');
  if (parentSelect) {
    // Get all spaces except the current one (to avoid circular reference)
    const possibleParents = spaces.filter(s => s.id !== spaceId && !s.is_archived);
    parentSelect.innerHTML = '<option value="">None (top level)</option>' +
      possibleParents.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    parentSelect.value = space.parent_id || '';
  }

  // Populate form fields
  document.getElementById('editName').value = space.name || '';
  document.getElementById('editLocation').value = space.location || '';
  document.getElementById('editType').value = space.type || '';
  document.getElementById('editDescription').value = space.description || '';
  document.getElementById('editMonthlyRate').value = space.monthly_rate || '';
  document.getElementById('editWeeklyRate').value = space.weekly_rate || '';
  document.getElementById('editNightlyRate').value = space.nightly_rate || '';
  document.getElementById('editRentalTerm').value = space.rental_term || '';
  document.getElementById('editStandardDeposit').value = space.standard_deposit || '';
  document.getElementById('editSqFootage').value = space.sq_footage || '';
  document.getElementById('editMinResidents').value = space.min_residents || 1;
  document.getElementById('editMaxResidents').value = space.max_residents || '';
  document.getElementById('editBathPrivacy').value = space.bath_privacy || '';
  document.getElementById('editBathFixture').value = space.bath_fixture || '';
  document.getElementById('editGenderRestriction').value = space.gender_restriction || 'none';
  document.getElementById('editBedsKing').value = space.beds_king || 0;
  document.getElementById('editBedsQueen').value = space.beds_queen || 0;
  document.getElementById('editBedsDouble').value = space.beds_double || 0;
  document.getElementById('editBedsTwin').value = space.beds_twin || 0;
  document.getElementById('editBedsFolding').value = space.beds_folding || 0;
  document.getElementById('editIsListed').checked = space.is_listed || false;
  document.getElementById('editIsSecret').checked = space.is_secret || false;
  document.getElementById('editCanBeDwelling').checked = space.can_be_dwelling !== false;

  // Populate photos
  renderEditPhotos(space);

  editSpaceModal.classList.remove('hidden');
}

function renderEditPhotos(space) {
  const container = document.getElementById('editPhotosContainer');

  if (!space.photos || space.photos.length === 0) {
    container.innerHTML = '<div class="no-photos-message">No photos yet. Use the Images button to add photos.</div>';
    return;
  }

  setCurrentGallery(space.photos);

  container.innerHTML = space.photos.map((photo, idx) => {
    // Show tags if available
    const tagsHtml = photo.tags?.length
      ? `<div class="photo-tags">${photo.tags.slice(0, 3).map(t => `<span class="photo-tag">${t.name}</span>`).join('')}</div>`
      : '';

    // Show primary badge
    const primaryBadge = photo.is_primary ? '<span class="photo-tag" style="background: var(--accent);">Primary</span>' : '';

    return `
      <div class="edit-photo-item" draggable="true" data-photo-id="${photo.id}" data-space-id="${space.id}">
        <div class="drag-handle" title="Drag to reorder">⋮⋮</div>
        <img src="${photo.url}" alt="${photo.caption || 'Photo ' + (idx + 1)}" onclick="openLightbox('${photo.url}')" style="cursor: zoom-in;">
        ${tagsHtml}
        <span class="photo-order">#${idx + 1} ${primaryBadge}</span>
        <button type="button" class="btn-remove-photo" onclick="event.preventDefault(); event.stopPropagation(); removePhotoFromSpace('${space.id}', '${photo.id}')" title="Remove">×</button>
      </div>
    `;
  }).join('');

  // Initialize drag and drop
  initPhotoDragAndDrop(container, space.id);
}

// Drag and drop for photo reordering
function initPhotoDragAndDrop(container, spaceId) {
  let draggedItem = null;

  container.querySelectorAll('.edit-photo-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedItem = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      draggedItem = null;
      // Remove all drag-over states
      container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedItem && draggedItem !== item) {
        item.classList.add('drag-over');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');

      if (!draggedItem || draggedItem === item) return;

      // Get current order
      const items = [...container.querySelectorAll('.edit-photo-item')];
      const fromIndex = items.indexOf(draggedItem);
      const toIndex = items.indexOf(item);

      // Reorder in DOM
      if (fromIndex < toIndex) {
        item.parentNode.insertBefore(draggedItem, item.nextSibling);
      } else {
        item.parentNode.insertBefore(draggedItem, item);
      }

      // Get new order of photo IDs
      const newOrder = [...container.querySelectorAll('.edit-photo-item')]
        .map(el => el.dataset.photoId);

      // Save to database
      await savePhotoOrder(spaceId, newOrder);
    });
  });
}

// Save photo order to database
async function savePhotoOrder(spaceId, mediaIds) {
  try {
    await mediaService.reorderInSpace(spaceId, mediaIds);

    // Update local data
    const space = spaces.find(s => s.id === spaceId);
    if (space) {
      // Reorder the photos array to match
      const photoMap = new Map(space.photos.map(p => [p.id, p]));
      space.photos = mediaIds.map(id => photoMap.get(id)).filter(Boolean);
      // Re-render to update order numbers
      renderEditPhotos(space);
    }
  } catch (error) {
    console.error('Error saving photo order:', error);
    showToast('Failed to save photo order', 'error');
  }
}

// Guard against concurrent saves
let isSavingSpace = false;

async function handleEditSpaceSubmit() {
  console.log('handleEditSpaceSubmit called');

  // Guard against double-click or Enter key while already saving
  if (isSavingSpace) {
    console.log('Already saving, ignoring duplicate call');
    return;
  }

  if (!authState?.isAdmin) {
    showToast('Only admins can edit spaces', 'warning');
    return;
  }

  const spaceId = document.getElementById('editSpaceId').value;
  const name = document.getElementById('editName').value.trim();

  console.log('Saving space:', { spaceId, name });

  if (!name) {
    showToast('Name is required', 'warning');
    return;
  }

  const submitBtn = document.getElementById('submitEditSpace');

  // Set guard BEFORE any async work
  isSavingSpace = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  try {
    // Build updates object with safe element access
    const getVal = (id) => document.getElementById(id)?.value?.trim() || null;
    const getInt = (id) => parseInt(document.getElementById(id)?.value) || null;
    const getIntOrZero = (id) => parseInt(document.getElementById(id)?.value) || 0;
    const getChecked = (id) => document.getElementById(id)?.checked || false;

    const updates = {
      name: name,
      parent_id: getVal('editParentSpace') || null,
      location: getVal('editLocation'),
      type: getVal('editType'),
      description: getVal('editDescription'),
      monthly_rate: getInt('editMonthlyRate'),
      weekly_rate: getInt('editWeeklyRate'),
      nightly_rate: getInt('editNightlyRate'),
      rental_term: getVal('editRentalTerm'),
      standard_deposit: getVal('editStandardDeposit'),
      sq_footage: getInt('editSqFootage'),
      min_residents: getInt('editMinResidents') || 1,
      max_residents: getInt('editMaxResidents'),
      bath_privacy: getVal('editBathPrivacy'),
      bath_fixture: getVal('editBathFixture'),
      gender_restriction: getVal('editGenderRestriction') || 'none',
      beds_king: getIntOrZero('editBedsKing'),
      beds_queen: getIntOrZero('editBedsQueen'),
      beds_double: getIntOrZero('editBedsDouble'),
      beds_twin: getIntOrZero('editBedsTwin'),
      beds_folding: getIntOrZero('editBedsFolding'),
      is_listed: getChecked('editIsListed'),
      is_secret: getChecked('editIsSecret'),
      can_be_dwelling: getChecked('editCanBeDwelling'),
    };

    console.log('Updating space with:', updates);

    // Wrap Supabase call with timeout to prevent indefinite hangs
    const timeoutMs = 15000; // 15 second timeout
    const updatePromise = supabase
      .from('spaces')
      .update(updates)
      .eq('id', spaceId)
      .select();

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out. Please check your connection and try again.')), timeoutMs)
    );

    const { data, error } = await Promise.race([updatePromise, timeoutPromise]);

    console.log('Update result:', { data, error });

    if (error) throw error;

    showToast('Space updated successfully!', 'success');

    // Close modal and reset button state IMMEDIATELY after save succeeds
    // Don't wait for loadData() - that can be slow
    editSpaceModal.classList.add('hidden');
    isSavingSpace = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Changes';

    // Refresh data in background - don't block UI
    loadData().then(() => render()).catch(err => {
      console.error('Error refreshing data:', err);
      // Non-critical - data will refresh on next page load
    });

    return; // Exit early - cleanup already done

  } catch (error) {
    console.error('Error updating space:', error);
    showToast('Failed to update space: ' + error.message, 'error');
    // Only reset on error - success case already handled above
    isSavingSpace = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Changes';
  }
}

// Archive a space (soft delete)
async function handleArchiveSpace() {
  if (!authState?.isAdmin) {
    showToast('Only admins can archive spaces', 'warning');
    return;
  }

  const spaceId = document.getElementById('editSpaceId').value;
  const space = spaces.find(s => s.id === spaceId);
  if (!space) return;

  const confirmMsg = `Archive "${space.name}"?\n\nThis will hide the space from all views but keep it in the database. You can restore it later from the Manage page.`;
  if (!confirm(confirmMsg)) return;

  try {
    const { error } = await supabase
      .from('spaces')
      .update({ is_archived: true })
      .eq('id', spaceId)
      .select();

    if (error) throw error;

    showToast(`"${space.name}" has been archived`, 'success');
    editSpaceModal.classList.add('hidden');

    await loadData();
    render();

  } catch (error) {
    console.error('Error archiving space:', error);
    showToast('Failed to archive space: ' + error.message, 'error');
  }
}

// Move photo from edit modal (optimistic update for performance)
async function movePhotoInEdit(spaceId, mediaId, direction) {
  if (!authState?.isAdmin) {
    showToast('Only admins can reorder photos', 'warning');
    return;
  }

  const space = spaces.find(s => s.id === spaceId);
  if (!space) return;

  const photos = [...space.photos];
  const idx = photos.findIndex(p => p.id === mediaId);
  if (idx === -1) return;

  let newIdx;
  switch (direction) {
    case 'up':
      newIdx = Math.max(0, idx - 1);
      break;
    case 'down':
      newIdx = Math.min(photos.length - 1, idx + 1);
      break;
    default:
      return;
  }

  if (newIdx === idx) return;

  // Optimistic update - move in local array immediately
  const [photo] = photos.splice(idx, 1);
  photos.splice(newIdx, 0, photo);
  space.photos = photos;

  // Re-render immediately for snappy UI
  renderEditPhotos(space);

  // Sync to database in background using media service
  try {
    const mediaIds = photos.map(p => p.id);
    await mediaService.reorderInSpace(spaceId, mediaIds);
  } catch (error) {
    console.error('Error saving photo order:', error);
    // Silently fail - the visual order is already updated
  }
}

// Remove photo from space (unlinks, doesn't delete the actual media file)
async function removePhotoFromSpace(spaceId, mediaId) {
  console.log('removePhotoFromSpace called:', { spaceId, mediaId, isAdmin: authState?.isAdmin });

  if (!authState?.isAdmin) {
    showToast('Only admins can remove photos', 'warning');
    return;
  }

  try {
    // Use media service to unlink
    await mediaService.unlinkFromSpace(mediaId, spaceId);
    console.log('Successfully unlinked photo from space');

    // Update local data without full reload (keeps modal open)
    const space = spaces.find(s => s.id === spaceId);
    if (space) {
      space.photos = space.photos.filter(p => p.id !== mediaId);
      renderEditPhotos(space);
      // Also refresh the detail view if open
      if (document.getElementById('detailModal')?.style.display !== 'none') {
        showSpaceDetail(spaceId);
      }
    }
    showToast('Photo removed from space', 'success');

  } catch (error) {
    console.error('Error removing photo:', error);
    showToast('Failed to remove photo: ' + error.message, 'error');
  }
}

// Permanently delete media (removes file from storage too)
async function deleteMedia(mediaId) {
  if (!authState?.isAdmin) {
    showToast('Only admins can delete media', 'warning');
    return;
  }

  if (!confirm('Permanently delete this media? This cannot be undone.')) {
    return;
  }

  try {
    const result = await mediaService.delete(mediaId);
    if (!result.success) {
      throw new Error(result.error);
    }

    await loadData();
    render();
    showToast('Media deleted successfully.', 'success');
  } catch (error) {
    console.error('Error deleting media:', error);
    showToast('Failed to delete: ' + error.message, 'error');
  }
}

// Update desired departure date for early exit
async function updateDesiredDeparture(assignmentId, dateValue) {
  try {
    // When date changes, also reset the listed flag
    const { error } = await supabase
      .from('assignments')
      .update({
        desired_departure_date: dateValue || null,
        desired_departure_listed: false
      })
      .eq('id', assignmentId)
      .select();

    if (error) throw error;

    showToast('Desired departure date updated', 'success');
    await loadData();
    render();
  } catch (error) {
    console.error('Error updating desired departure:', error);
    showToast('Failed to update departure date', 'error');
  }
}

// Toggle listing status for desired departure date
async function toggleDesiredDepartureListed(assignmentId, listed) {
  try {
    const { error } = await supabase
      .from('assignments')
      .update({ desired_departure_listed: listed })
      .eq('id', assignmentId)
      .select();

    if (error) throw error;

    showToast(listed ? 'Early exit date listed for new renters' : 'Early exit date unlisted', 'success');
    await loadData();
    render();
  } catch (error) {
    console.error('Error toggling listed status:', error);
    showToast('Failed to update listing status', 'error');
  }
}

// Make functions globally accessible for onclick handlers
window.updateDesiredDeparture = updateDesiredDeparture;
window.toggleDesiredDepartureListed = toggleDesiredDepartureListed;
window.showSpaceDetail = showSpaceDetail;
window.openPhotoRequest = openPhotoRequest;
window.openPhotoUpload = openPhotoUpload;
window.movePhoto = movePhoto;
window.movePhotoInEdit = movePhotoInEdit;
window.removePhotoFromSpace = removePhotoFromSpace;
window.deleteMedia = deleteMedia;
window.openEditSpace = openEditSpace;
window.mediaService = mediaService;
window.toggleLibraryTagFilter = toggleLibraryTagFilter;
window.toggleLibraryMediaSelection = toggleLibraryMediaSelection;
window.switchMediaPickerTab = switchMediaPickerTab;
window.removeUploadFile = removeUploadFile;
window.updateFileCaption = updateFileCaption;
window.showAddTagForm = showAddTagForm;
window.hideAddTagForm = hideAddTagForm;
window.createNewTag = createNewTag;
window.openLightbox = openLightbox;
