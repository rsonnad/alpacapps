/**
 * Project Service
 * CRUD operations for property maintenance tasks.
 */

import { supabase } from './supabase.js';

class ProjectService {

  // ---- Task Queries ----

  /**
   * Get all tasks with optional filters
   * @param {Object} filters - { status, priority, assignedTo, assignedName, spaceId, search }
   */
  async getAllTasks(filters = {}) {
    let query = supabase
      .from('tasks')
      .select('*, space:space_id(id, name)')
      .order('priority', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }
    if (filters.priority) {
      query = query.eq('priority', filters.priority);
    }
    if (filters.assignedTo) {
      query = query.eq('assigned_to', filters.assignedTo);
    }
    if (filters.assignedName) {
      query = query.eq('assigned_name', filters.assignedName);
    }
    if (filters.spaceId) {
      query = query.eq('space_id', filters.spaceId);
    }
    if (filters.search) {
      query = query.ilike('title', `%${filters.search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Get a single task by ID
   */
  async getTask(id) {
    const { data, error } = await supabase
      .from('tasks')
      .select('*, space:space_id(id, name)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Get open/in-progress tasks for a user (assigned to them or unassigned)
   */
  async getOpenTasksForUser(userId) {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, assigned_name, space:space_id(name)')
      .in('status', ['open', 'in_progress'])
      .or(`assigned_to.eq.${userId},assigned_to.is.null`)
      .order('priority', { ascending: true, nullsFirst: false })
      .order('title');
    if (error) throw error;
    return data || [];
  }

  /**
   * Get task stats (counts by status)
   */
  async getTaskStats() {
    const { data, error } = await supabase
      .from('tasks')
      .select('status');
    if (error) throw error;

    const stats = { total: 0, open: 0, in_progress: 0, done: 0 };
    (data || []).forEach(t => {
      stats.total++;
      stats[t.status] = (stats[t.status] || 0) + 1;
    });
    return stats;
  }

  /**
   * Get unique assignee names for filter dropdowns
   */
  async getAssigneeNames() {
    const { data, error } = await supabase
      .from('tasks')
      .select('assigned_name')
      .not('assigned_name', 'is', null)
      .order('assigned_name');
    if (error) throw error;
    return [...new Set((data || []).map(t => t.assigned_name))];
  }

  // ---- Task Mutations ----

  /**
   * Create a new task
   */
  async createTask({ title, notes, priority, spaceId, locationLabel, assignedTo, assignedName, status }) {
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title,
        notes: notes || null,
        priority: priority || null,
        space_id: spaceId || null,
        location_label: locationLabel || null,
        assigned_to: assignedTo || null,
        assigned_name: assignedName || null,
        status: status || 'open',
      })
      .select('*, space:space_id(id, name)')
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Update a task
   */
  async updateTask(id, updates) {
    const payload = { updated_at: new Date().toISOString() };

    if ('title' in updates) payload.title = updates.title;
    if ('notes' in updates) payload.notes = updates.notes || null;
    if ('priority' in updates) payload.priority = updates.priority || null;
    if ('spaceId' in updates) payload.space_id = updates.spaceId || null;
    if ('locationLabel' in updates) payload.location_label = updates.locationLabel || null;
    if ('assignedTo' in updates) payload.assigned_to = updates.assignedTo || null;
    if ('assignedName' in updates) payload.assigned_name = updates.assignedName || null;
    if ('status' in updates) {
      payload.status = updates.status;
      if (updates.status === 'done') {
        payload.completed_at = new Date().toISOString();
      } else {
        payload.completed_at = null;
      }
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(payload)
      .eq('id', id)
      .select('*, space:space_id(id, name)')
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Delete a task
   */
  async deleteTask(id) {
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  /**
   * Bulk reassign tasks
   */
  async bulkReassign(taskIds, assignedTo, assignedName) {
    const { error } = await supabase
      .from('tasks')
      .update({
        assigned_to: assignedTo || null,
        assigned_name: assignedName || null,
        updated_at: new Date().toISOString(),
      })
      .in('id', taskIds);
    if (error) throw error;
  }
}

export const projectService = new ProjectService();
