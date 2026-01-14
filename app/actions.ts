'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { WorkflowStep } from '@/types/workflow';

/**
 * Create a new template with workflow steps
 */
export async function createTemplate(data: {
  title: string;
  description: string;
  steps_schema: WorkflowStep[];
  assigned_to?: string[];
}) {
  try {
    // Check environment variables
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    console.log('Environment check:', {
      hasUrl: !!supabaseUrl,
      hasKey: !!supabaseKey,
      urlPreview: supabaseUrl?.substring(0, 30) + '...',
      keyPreview: supabaseKey?.substring(0, 20) + '...',
    });

    if (!supabaseUrl || !supabaseKey) {
      return { 
        success: false, 
        error: '環境變數未設定。請確認 .env.local 檔案存在且包含正確的 Supabase 連線資訊。' 
      };
    }

    const supabase = createClient();

    // Get current user (creator)
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // Get creator's profile to fetch department
    const { data: creatorProfile } = await supabase
      .from('profiles')
      .select('department')
      .eq('id', user.id)
      .single();

    console.log('Inserting template:', {
      title: data.title,
      steps_count: data.steps_schema.length,
      assigned_to: data.assigned_to,
      creator_department: creatorProfile?.department,
    });

    // Create template
    const { data: template, error } = await supabase
      .from('templates')
      .insert({
        title: data.title,
        description: data.description,
        steps_schema: data.steps_schema,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return { success: false, error: `資料庫錯誤: ${error.message}` };
    }

    console.log('Template created successfully:', template);

    // Automatically create assignment with specified users (or creator only)
    const userIds = Array.isArray(data.assigned_to) ? data.assigned_to : [];
    const userIdSet = new Set([user.id, ...userIds]);
    const allUserIds = Array.from(userIdSet);
    
    console.log('[createTemplate] Creating assignment for:', allUserIds);

    // Create the assignment with creator's department
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .insert({
        template_id: template.id,
        assigned_to: allUserIds[0],
        status: 'pending',
        department: creatorProfile?.department || null,
      })
      .select()
      .single();

    if (assignmentError) {
      console.error('Error creating assignment:', assignmentError);
      // Don't fail template creation if assignment fails
    } else {
      // Add all users as collaborators
      const collaborators = allUserIds.map(userId => ({
        assignment_id: assignment.id,
        user_id: userId,
      }));

      const { error: collaboratorError } = await supabase
        .from('assignment_collaborators')
        .insert(collaborators);

      if (collaboratorError) {
        console.error('Error adding collaborators:', collaboratorError);
      }
    }

    revalidatePath('/dashboard');
    revalidatePath('/admin/templates');
    revalidatePath('/my-tasks');
    return { success: true, data: template };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { 
      success: false, 
      error: `發生錯誤: ${error.message || '未知錯誤'}。詳細資訊請查看 Console。` 
    };
  }
}

/**
 * Update an existing template
 */
export async function updateTemplate(templateId: string, data: {
  title: string;
  description: string;
  steps_schema: WorkflowStep[];
}) {
  try {
    const supabase = createClient();

    // Check user role
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: '未登入' };
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
      return { success: false, error: '權限不足' };
    }

    // Check if template has completed assignments
    const { data: assignments } = await supabase
      .from('assignments')
      .select('status')
      .eq('template_id', templateId);

    const hasCompletedAssignments = assignments?.some(a => a.status === 'completed');
    if (hasCompletedAssignments) {
      return { success: false, error: '此任務已有完成的指派記錄，無法編輯' };
    }

    // Update the template
    const { data: template, error } = await supabase
      .from('templates')
      .update({
        title: data.title,
        description: data.description,
        steps_schema: data.steps_schema,
      })
      .eq('id', templateId)
      .select()
      .single();

    if (error) {
      console.error('Error updating template:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/admin/templates');
    revalidatePath('/admin/template/[id]', 'page');
    revalidatePath('/dashboard');
    return { success: true, data: template };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤' };
  }
}

/**
 * Get all templates
 */
export async function getTemplates() {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: '未登入', data: [] };
    }

    // Get user profile to check role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    // Build query
    let query = supabase
      .from('templates')
      .select('*')
      .order('created_at', { ascending: false });

    // If not admin, only show templates created by current user
    if (profile?.role !== 'admin') {
      query = query.eq('created_by', user.id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching templates:', error);
      return { success: false, error: error.message, data: [] };
    }

    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤', data: [] };
  }
}

/**
 * Create an assignment (assign a template to one or multiple users for collaboration)
 */
export async function createAssignment(data: {
  template_id: string;
  assigned_to: string | string[]; // Support single user or array of users
}) {
  try {
    const supabase = createClient();

    // Get current user (creator/manager)
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // Convert to array for consistent handling
    const userIds = Array.isArray(data.assigned_to) ? data.assigned_to : [data.assigned_to];
    
    // Automatically add creator to the assignment if not already included
    const userIdSet = new Set([user.id, ...userIds]);
    const allUserIds = Array.from(userIdSet); // Use Array.from() to avoid downlevelIteration issues
    
    console.log('[createAssignment] Creator:', user.id);
    console.log('[createAssignment] Original assigned users:', userIds);
    console.log('[createAssignment] All users (with creator):', allUserIds);
    
    // Create the assignment (assigned_to will be the first user for backward compatibility)
    const { data: assignment, error } = await supabase
      .from('assignments')
      .insert({
        template_id: data.template_id,
        assigned_to: allUserIds[0],
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating assignment:', error);
      return { success: false, error: error.message };
    }

    // Add all users (including creator) as collaborators
    const collaborators = allUserIds.map(userId => ({
      assignment_id: assignment.id,
      user_id: userId,
    }));

    const { error: collaboratorError } = await supabase
      .from('assignment_collaborators')
      .insert(collaborators);

    if (collaboratorError) {
      console.error('Error adding collaborators:', collaboratorError);
      // Don't fail the whole operation, but log the error
    }

    revalidatePath('/dashboard');
    revalidatePath('/my-tasks');
    return { success: true, data: assignment };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤' };
  }
}

/**
 * Log a checklist action (checked/unchecked)
 */
export async function logAction(
  assignmentId: string,
  stepId: string,
  action: 'checked' | 'unchecked'
) {
  try {
    const supabase = createClient();

    // Get current user ID from auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // Map UI actions to database actions
    const dbAction = action === 'checked' ? 'complete' : 'uncomplete';

    const { data: log, error } = await supabase
      .from('logs')
      .insert({
        assignment_id: assignmentId,
        user_id: user.id,
        step_id: stepId, // Keep as string, don't use parseInt
        action: dbAction,
      })
      .select()
      .single();

    if (error) {
      console.error('Error logging action:', error);
      return { success: false, error: error.message };
    }

    // Update assignment status to in_progress if it was pending
    const { data: assignment } = await supabase
      .from('assignments')
      .select('status')
      .eq('id', assignmentId)
      .single();

    if (assignment?.status === 'pending') {
      await supabase
        .from('assignments')
        .update({ status: 'in_progress' })
        .eq('id', assignmentId);
    }

    revalidatePath(`/assignment/${assignmentId}`);
    revalidatePath('/dashboard');
    
    return { success: true, data: log };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤' };
  }
}

/**
 * Get all assignments with template and logs data (including collaborative assignments)
 */
export async function getAssignments() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入', data: [] };
    }

    // Get all assignment IDs where user is a collaborator
    const { data: collaborations, error: collabError } = await supabase
      .from('assignment_collaborators')
      .select('assignment_id')
      .eq('user_id', user.id);

    if (collabError) {
      console.error('Error fetching collaborations:', collabError);
    }

    const assignmentIds = collaborations?.map(c => c.assignment_id) || [];

    // If no assignments found, return empty array early
    if (assignmentIds.length === 0) {
      return { success: true, data: [] };
    }

    // Fetch assignments where user is a collaborator
    const { data: assignments, error: assignmentsError } = await supabase
      .from('assignments')
      .select(`
        *,
        template:templates(*)
      `)
      .in('id', assignmentIds)
      .eq('archived', false)
      .order('created_at', { ascending: false });

    if (assignmentsError) {
      console.error('Error fetching assignments:', assignmentsError);
      return { success: false, error: assignmentsError.message, data: [] };
    }

    // Get all template creator IDs
    const creatorIds = Array.from(new Set(
      assignments?.map((a: any) => a.template?.created_by).filter(Boolean) || []
    ));

    // Fetch creator profiles
    const { data: creatorProfiles, error: creatorError } = await supabase
      .from('profiles')
      .select('id, email, full_name, department')
      .in('id', creatorIds);

    if (creatorError) {
      console.error('Error fetching creator profiles:', creatorError);
    }

    // Create a map of creator profiles
    const creatorMap = new Map(creatorProfiles?.map(p => [p.id, p]) || []);

    // Fetch logs for all assignments
    const { data: logs, error: logsError } = await supabase
      .from('logs')
      .select('*')
      .in('assignment_id', assignmentIds);

    if (logsError) {
      console.error('Error fetching logs:', logsError);
    }

    // Fetch all collaborators for these assignments
    const { data: allCollaborators, error: allCollabError } = await supabase
      .from('assignment_collaborators')
      .select('assignment_id, user_id')
      .in('assignment_id', assignmentIds);

    if (allCollabError) {
      console.error('Error fetching all collaborators:', allCollabError);
    }

    // Fetch user profiles for all collaborators
    const allUserIds = Array.from(new Set(allCollaborators?.map(c => c.user_id) || []));
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', allUserIds);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
    }

    // Create a map of user profiles
    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

    // Combine data
    const enrichedAssignments = assignments?.map((assignment: any) => {
      const assignmentLogs = logs?.filter(log => log.assignment_id === assignment.id) || [];
      const assignmentCollaborators = allCollaborators?.filter(c => c.assignment_id === assignment.id) || [];
      const collaboratorProfiles = assignmentCollaborators.map(c => profileMap.get(c.user_id)).filter(Boolean);
      
      // Add creator info to template
      const enrichedTemplate = assignment.template ? {
        ...assignment.template,
        creator: creatorMap.get(assignment.template.created_by) || null
      } : null;

      return {
        ...assignment,
        template: enrichedTemplate,
        logs: assignmentLogs,
        assigned_user: profileMap.get(assignment.assigned_to) || null,
        collaborators: collaboratorProfiles,
      };
    }) || [];

    return { success: true, data: enrichedAssignments };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤', data: [] };
  }
}

/**
 * Get a single assignment with template and logs
 */
export async function getAssignment(assignmentId: string) {
  try {
    const supabase = createClient();

    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        *,
        template:templates(*)
      `)
      .eq('id', assignmentId)
      .single();

    if (assignmentError) {
      console.error('Error fetching assignment:', assignmentError);
      return { success: false, error: assignmentError.message };
    }

    // Fetch logs for this assignment
    const { data: logs, error: logsError } = await supabase
      .from('logs')
      .select('*')
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: true });

    if (logsError) {
      console.error('Error fetching logs:', logsError);
    }

    // Fetch collaborators for this assignment
    const { data: collaborations, error: collabError } = await supabase
      .from('assignment_collaborators')
      .select('user_id')
      .eq('assignment_id', assignmentId);

    if (collabError) {
      console.error('Error fetching collaborators:', collabError);
    }

    // Fetch user profiles for collaborators
    const userIds = collaborations?.map(c => c.user_id) || [];
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', userIds);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
    }

    return {
      success: true,
      data: {
        ...assignment,
        logs: logs || [],
        collaborators: profiles || [],
      },
    };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤' };
  }
}

/**
 * Update assignment status
 */
export async function updateAssignmentStatus(
  assignmentId: string,
  status: 'pending' | 'in_progress' | 'completed'
) {
  try {
    const supabase = createClient();

    // Prepare update data
    const updateData: any = { status };
    
    // If status is completed, record completion time
    if (status === 'completed') {
      updateData.completed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('assignments')
      .update(updateData)
      .eq('id', assignmentId);

    if (error) {
      console.error('Error updating assignment status:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤' };
  }
}

/**
 * Archive a completed assignment
 */
export async function archiveAssignment(assignmentId: string) {
  try {
    const supabase = createClient();
    
    // Check user role
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: '未登入' };
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
      return { success: false, error: '權限不足' };
    }

    // Check if assignment exists and is completed
    const { data: assignment } = await supabase
      .from('assignments')
      .select('status, archived, completed_at')
      .eq('id', assignmentId)
      .single();

    if (!assignment) {
      return { success: false, error: '任務不存在' };
    }

    if (assignment.status !== 'completed') {
      return { success: false, error: '只能封存已完成的任務' };
    }

    if (assignment.archived) {
      return { success: false, error: '任務已經封存' };
    }

    // Prepare update data
    const updateData: any = {
      archived: true,
      archived_at: new Date().toISOString(),
      archived_by: user.id,
    };

    // If completed_at is not set, set it now
    if (!assignment.completed_at) {
      updateData.completed_at = new Date().toISOString();
    }

    // Archive assignment
    const { error } = await supabase
      .from('assignments')
      .update(updateData)
      .eq('id', assignmentId);

    if (error) {
      console.error('Error archiving assignment:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/admin/templates');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '封存任務失敗' };
  }
}

/**
 * Get archived assignments (for history view)
 */
export async function getArchivedAssignments() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入', data: [] };
    }

    // Get user profile to check role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    // Build query for archived assignments
    let query = supabase
      .from('assignments')
      .select(`
        id,
        template_id,
        assigned_to,
        created_by,
        status,
        created_at,
        archived,
        archived_at,
        archived_by,
        completed_at,
        department,
        template:templates(*)
      `)
      .eq('archived', true)
      .order('archived_at', { ascending: false });

    // If not admin, only show templates created by current user
    if (profile?.role !== 'admin') {
      // Get templates created by current user
      const { data: userTemplates } = await supabase
        .from('templates')
        .select('id')
        .eq('created_by', user.id);
      
      const templateIds = userTemplates?.map(t => t.id) || [];
      
      if (templateIds.length === 0) {
        return { success: true, data: [] };
      }
      
      query = query.in('template_id', templateIds);
    }

    const { data: assignments, error: assignmentsError } = await query;

    if (assignmentsError) {
      console.error('Error fetching archived assignments:', assignmentsError);
      return { success: false, error: assignmentsError.message, data: [] };
    }

    // Get all template creator IDs
    const creatorIds = Array.from(new Set(
      assignments?.map((a: any) => a.template?.created_by).filter(Boolean) || []
    ));

    // Fetch creator profiles
    const { data: creatorProfiles } = await supabase
      .from('profiles')
      .select('id, email, full_name, department')
      .in('id', creatorIds);

    const creatorMap = new Map(creatorProfiles?.map(p => [p.id, p]) || []);

    // Get assignment IDs
    const assignmentIds = assignments?.map(a => a.id) || [];

    // Fetch logs for all assignments
    const { data: logs } = await supabase
      .from('logs')
      .select('*')
      .in('assignment_id', assignmentIds);

    // Fetch all collaborators
    const { data: allCollaborators } = await supabase
      .from('assignment_collaborators')
      .select('assignment_id, user_id')
      .in('assignment_id', assignmentIds);

    // Fetch user profiles for collaborators and archived_by
    const allUserIds = Array.from(new Set([
      ...(allCollaborators?.map(c => c.user_id) || []),
      ...(assignments?.map(a => a.archived_by).filter(Boolean) || []),
      ...(assignments?.map(a => a.assigned_to).filter(Boolean) || []),
      ...(assignments?.map(a => a.created_by).filter(Boolean) || [])
    ]));

    console.log('[getArchivedAssignments] All user IDs to fetch:', allUserIds);
    console.log('[getArchivedAssignments] Assignments created_by:', assignments?.map(a => ({ id: a.id, created_by: a.created_by })));

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name, department')
      .in('id', allUserIds);

    console.log('[getArchivedAssignments] Fetched profiles:', profiles);

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
    console.log('[getArchivedAssignments] Profile map size:', profileMap.size);

    // Combine data
    const enrichedAssignments = assignments?.map((assignment: any) => {
      const assignmentLogs = logs?.filter(log => log.assignment_id === assignment.id) || [];
      const assignmentCollaborators = allCollaborators?.filter(c => c.assignment_id === assignment.id) || [];
      const collaboratorProfiles = assignmentCollaborators.map(c => profileMap.get(c.user_id)).filter(Boolean);
      
      const enrichedTemplate = assignment.template ? {
        ...assignment.template,
        creator: creatorMap.get(assignment.template.created_by) || null
      } : null;

      const creatorProfile = profileMap.get(assignment.created_by);
      console.log('[getArchivedAssignments] Assignment:', assignment.id, '{ created_by:', assignment.created_by, ', creator profile:', creatorProfile, '}');

      return {
        ...assignment,
        template: enrichedTemplate,
        logs: assignmentLogs,
        assignee: profileMap.get(assignment.assigned_to) || null,
        creator: creatorProfile || null,
        collaborators: assignmentCollaborators.map(c => ({
          user_id: c.user_id,
          user: profileMap.get(c.user_id) || null
        })),
        archived_by_user: profileMap.get(assignment.archived_by) || null,
      };
    }) || [];

    console.log('[getArchivedAssignments] Final enriched assignments:', enrichedAssignments.map(a => ({
      id: a.id,
      created_by: a.created_by,
      creator: a.creator,
      assignee: a.assignee
    })));

    return { success: true, data: enrichedAssignments };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤', data: [] };
  }
}

/**
 * Delete a completed assignment (only admins and managers)
 */
export async function deleteAssignment(assignmentId: string) {
  try {
    const supabase = createClient();
    
    // Check user role
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: '未登入' };
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
      return { success: false, error: '權限不足' };
    }

    // Check if assignment is completed
    const { data: assignment } = await supabase
      .from('assignments')
      .select('status')
      .eq('id', assignmentId)
      .single();

    if (!assignment) {
      return { success: false, error: '任務不存在' };
    }

    if (assignment.status !== 'completed') {
      return { success: false, error: '只能刪除已完成的任務' };
    }

    // Delete assignment (will cascade delete logs and collaborators)
    const { error } = await supabase
      .from('assignments')
      .delete()
      .eq('id', assignmentId);

    if (error) {
      console.error('Error deleting assignment:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/dashboard');
    revalidatePath('/my-tasks');
    revalidatePath('/admin/templates');
    revalidatePath('/admin/template/[id]', 'page');
    return { success: true };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤' };
  }
}

/**
 * Delete a template and all related assignments
 */
export async function deleteTemplate(templateId: string) {
  try {
    const supabase = createClient();
    
    // Check user role
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: '未登入' };
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
      return { success: false, error: '權限不足，只有管理員和主管可以刪除流程模板' };
    }

    // Check if template exists
    const { data: template } = await supabase
      .from('templates')
      .select('id, title')
      .eq('id', templateId)
      .single();

    if (!template) {
      return { success: false, error: '流程模板不存在' };
    }

    // Delete template (will cascade delete all assignments, logs, and collaborators)
    const { error } = await supabase
      .from('templates')
      .delete()
      .eq('id', templateId);

    if (error) {
      console.error('Error deleting template:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/admin/templates');
    revalidatePath('/dashboard');
    revalidatePath('/my-tasks');
    return { success: true };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤' };
  }
}
