/**
 * PhyProp - Physical Property management (3D models, site plans, CAD)
 */

import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';

// =============================================
// STATE
// =============================================

let authState = null;

// =============================================
// INITIALIZATION
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  authState = await initAdminPage({
    activeTab: 'phyprop',
    requiredRole: 'staff',
    section: 'staff',
    onReady: async () => {
      await loadStats();
    }
  });
});

// =============================================
// DATA LOADING
// =============================================

async function loadStats() {
  try {
    // Count non-archived spaces that are physical structures
    const { data: spaces } = await supabase
      .from('spaces')
      .select('id, name, type')
      .eq('is_archived', false);

    if (spaces) {
      const structures = spaces.filter(s =>
        s.type === 'Dwelling' || s.type === 'Amenity' || s.type === 'Storage'
      );
      const el = document.getElementById('structureCount');
      if (el) el.textContent = structures.length;
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}
