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

    // 檢查是否為管理員或任務創建者
    const { data: existingTemplate } = await supabase
      .from('templates')
      .select('created_by')
      .eq('id', templateId)
      .single();

    if (!existingTemplate) {
      return { success: false, error: '任務不存在' };
    }

    // 允許 admin、manager 或任務創建者編輯
    const isAdmin = profile?.role === 'admin';
    const isManager = profile?.role === 'manager';
    const isCreator = existingTemplate.created_by === user.id;

    if (!isAdmin && !isManager && !isCreator) {
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
 * Create or update assignment collaborators for a template
 * If an assignment already exists for this template, update its collaborators
 * Otherwise, create a new assignment
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
      console.error('[createAssignment] ERROR: User not logged in');
      return { success: false, error: '未登入' };
    }

    console.log('[createAssignment] ===== START =====');
    console.log('[createAssignment] Current user ID:', user.id);
    console.log('[createAssignment] Template ID:', data.template_id);

    // Get creator's profile to get their department and role
    const { data: creatorProfile, error: profileError } = await supabase
      .from('profiles')
      .select('department, role, full_name, job_title')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('[createAssignment] ERROR fetching profile:', profileError);
    } else {
      console.log('[createAssignment] Creator profile:', {
        department: creatorProfile?.department,
        role: creatorProfile?.role,
        full_name: creatorProfile?.full_name,
        job_title: creatorProfile?.job_title
      });
    }

    // Convert to array for consistent handling and filter out empty strings
    let userIds: string[] = [];
    if (Array.isArray(data.assigned_to)) {
      userIds = data.assigned_to.filter(id => id && id.trim());
    } else if (data.assigned_to && typeof data.assigned_to === 'string') {
      userIds = [data.assigned_to];
    }
    
    // Automatically add creator to the assignment if not already included
    const userIdSet = new Set([user.id, ...userIds]);
    const allUserIds = Array.from(userIdSet);
    
    console.log('[createAssignment] Original assigned users:', userIds);
    console.log('[createAssignment] All users (with creator):', allUserIds);
    
    // Check if an assignment already exists for this template
    const { data: existingAssignments } = await supabase
      .from('assignments')
      .select('id')
      .eq('template_id', data.template_id)
      .order('created_at', { ascending: false })
      .limit(1);

    let assignment;
    let isNewAssignment = false;

    if (existingAssignments && existingAssignments.length > 0) {
      // Update existing assignment
      assignment = existingAssignments[0];
      console.log('[createAssignment] Found existing assignment:', assignment.id);
      
      // Delete all existing collaborators for this assignment
      const { error: deleteError } = await supabase
        .from('assignment_collaborators')
        .delete()
        .eq('assignment_id', assignment.id);

      if (deleteError) {
        console.error('[createAssignment] ERROR deleting old collaborators:', deleteError);
      } else {
        console.log('[createAssignment] ✅ Deleted old collaborators');
      }
    } else {
      // Create new assignment
      console.log('[createAssignment] Creating new assignment...');
      isNewAssignment = true;
      
      const { data: newAssignment, error } = await supabase
        .from('assignments')
        .insert({
          template_id: data.template_id,
          assigned_to: allUserIds[0],
          status: 'pending',
          department: creatorProfile?.department || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) {
        console.error('[createAssignment] ERROR creating assignment:', error);
        return { success: false, error: error.message };
      }

      assignment = newAssignment;
      console.log('[createAssignment] ✅ New assignment created:', assignment.id);
    }

    // Add all users (including creator) as collaborators
    const collaborators = allUserIds.map(userId => ({
      assignment_id: assignment.id,
      user_id: userId,
    }));

    console.log('[createAssignment] Preparing to insert collaborators:', collaborators);
    console.log('[createAssignment] Number of collaborators:', collaborators.length);

    const { data: insertedCollaborators, error: collaboratorError } = await supabase
      .from('assignment_collaborators')
      .insert(collaborators)
      .select();

    if (collaboratorError) {
      console.error('[createAssignment] ❌ ERROR adding collaborators:', {
        error: collaboratorError,
        message: collaboratorError.message,
        code: collaboratorError.code,
        details: collaboratorError.details,
        hint: collaboratorError.hint
      });
      console.log('[createAssignment] Assignment was created but collaborators failed');
      console.log('[createAssignment] This is likely a permissions issue - check RLS policies on assignment_collaborators table');
    } else {
      console.log('[createAssignment] ✅ Successfully inserted collaborators:', insertedCollaborators);
      console.log('[createAssignment] Number of collaborators inserted:', insertedCollaborators?.length || 0);
    }

    console.log('[createAssignment] ===== END =====');
    revalidatePath('/dashboard');
    revalidatePath('/my-tasks');
    revalidatePath('/admin/templates');
    return { success: true, data: assignment };
  } catch (error: any) {
    console.error('[createAssignment] ❌ UNEXPECTED ERROR:', error);
    return { success: false, error: error.message || '發生未知錯誤' };
  }
}

/**
 * Get existing collaborators for a template
 * Returns all users that have been assigned to assignments for this template
 */
export async function getExistingCollaborators(templateId: string) {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: '未登入', data: [] };
    }

    // Get the most recent assignment for this template
    const { data: assignment } = await supabase
      .from('assignments')
      .select('id')
      .eq('template_id', templateId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!assignment) {
      return { success: true, data: [] };
    }

    // Get all collaborators for this assignment
    const { data: collaborators, error } = await supabase
      .from('assignment_collaborators')
      .select('user_id')
      .eq('assignment_id', assignment.id);

    if (error) {
      console.error('[getExistingCollaborators] Error:', error);
      return { success: false, error: error.message, data: [] };
    }

    return { success: true, data: collaborators || [] };
  } catch (error: any) {
    console.error('[getExistingCollaborators] Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤', data: [] };
  }
}

/**
 * Log a checklist action (checked/unchecked)
 */
export async function logAction(
  assignmentId: string,
  stepId: string,
  action: 'checked' | 'unchecked',
  note?: string
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
        note: note || null,
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
// Get ALL assignments for admin views (includes logs)
export async function getAllAssignments() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入', data: [] };
    }

    // Fetch all assignments (for admin)
    const { data: assignments, error: assignmentsError } = await supabase
      .from('assignments')
      .select(`
        *,
        template:templates(*)
      `)
      .eq('archived', false)
      .order('created_at', { ascending: false });

    if (assignmentsError) {
      console.error('Error fetching assignments:', assignmentsError);
      return { success: false, error: assignmentsError.message, data: [] };
    }

    if (!assignments || assignments.length === 0) {
      return { success: true, data: [] };
    }

    const assignmentIds = assignments.map((a: any) => a.id);

    // Fetch logs for all assignments
    const { data: logs, error: logsError } = await supabase
      .from('logs')
      .select('*')
      .in('assignment_id', assignmentIds);

    if (logsError) {
      console.error('Error fetching logs:', logsError);
    }

    // Combine data
    const enrichedAssignments = assignments.map((assignment: any) => {
      const assignmentLogs = logs?.filter(log => log.assignment_id === assignment.id) || [];
      
      return {
        ...assignment,
        logs: assignmentLogs,
      };
    });

    return { success: true, data: enrichedAssignments };
  } catch (error: any) {
    console.error('Error in getAllAssignments:', error);
    return { success: false, error: error.message, data: [] };
  }
}

export async function getAssignments() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入', data: [] };
    }

    console.log('[getAssignments] Fetching assignments for user:', user.id);

    // Get all assignment IDs where user is a collaborator (with section_id)
    const { data: collaborations, error: collabError } = await supabase
      .from('assignment_collaborators')
      .select('assignment_id, section_id')
      .eq('user_id', user.id);

    if (collabError) {
      console.error('[getAssignments] Error fetching collaborations:', collabError);
    } else {
      console.log('[getAssignments] Found collaborations:', collaborations);
    }

    const assignmentIds = collaborations?.map(c => c.assignment_id) || [];
    console.log('[getAssignments] Assignment IDs:', assignmentIds);

    // Create a map of user's section_id for each assignment
    const userSectionMap = new Map(
      collaborations?.map(c => [c.assignment_id, c.section_id]) || []
    );

    // If no assignments found, return empty array early
    if (assignmentIds.length === 0) {
      console.log('[getAssignments] No assignment IDs found, returning empty array');
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

    // Fetch all collaborators for these assignments (with section_id for display)
    const { data: allCollaborators, error: allCollabError } = await supabase
      .from('assignment_collaborators')
      .select('assignment_id, user_id, section_id')
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

    // Combine data with section-aware filtering
    const enrichedAssignments = assignments?.map((assignment: any) => {
      const assignmentLogs = logs?.filter(log => log.assignment_id === assignment.id) || [];
      const assignmentCollaborators = allCollaborators?.filter(c => c.assignment_id === assignment.id) || [];
      const collaboratorProfiles = assignmentCollaborators.map(c => profileMap.get(c.user_id)).filter(Boolean);
      
      // Get user's section_id for this assignment
      const userSectionId = userSectionMap.get(assignment.id);
      
      // Process template based on sections
      let processedTemplate = assignment.template;
      
      if (assignment.template?.sections && Array.isArray(assignment.template.sections) && assignment.template.sections.length > 0 && userSectionId) {
        // Find user's section
        const userSection = assignment.template.sections.find((s: any) => s.id === userSectionId);
        
        if (userSection) {
          // Replace steps_schema with user's section steps only
          processedTemplate = {
            ...assignment.template,
            steps_schema: userSection.steps || [],
            userSection: {
              id: userSection.id,
              department: userSection.department,
            },
            creator: creatorMap.get(assignment.template.created_by) || null
          };
        } else {
          // Add creator info even if section not found
          processedTemplate = {
            ...assignment.template,
            creator: creatorMap.get(assignment.template.created_by) || null
          };
        }
      } else {
        // No sections or no section_id - use original steps
        processedTemplate = assignment.template ? {
          ...assignment.template,
          creator: creatorMap.get(assignment.template.created_by) || null
        } : null;
      }

      return {
        ...assignment,
        template: processedTemplate,
        logs: assignmentLogs,
        assigned_user: profileMap.get(assignment.assigned_to) || null,
        collaborators: collaboratorProfiles,
        userSectionId: userSectionId || null,
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

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();

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

    // Fetch collaborators for this assignment with section_id
    const { data: collaborations, error: collabError } = await supabase
      .from('assignment_collaborators')
      .select('user_id, section_id')
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

    // Process template for section-based filtering
    let processedTemplate = assignment.template;
    
    // If template has sections and user is logged in, filter steps for this user
    if (user && assignment.template?.sections && Array.isArray(assignment.template.sections) && assignment.template.sections.length > 0) {
      console.log('[getAssignment] Template has sections, filtering for user:', user.id);
      
      // Find user's section_id from collaborations
      const userCollab = collaborations?.find(c => c.user_id === user.id);
      const userSectionId = userCollab?.section_id;
      
      console.log('[getAssignment] User section_id:', userSectionId);
      
      if (userSectionId) {
        // Find the user's section in template
        const userSection = assignment.template.sections.find((s: any) => s.id === userSectionId);
        
        if (userSection) {
          console.log('[getAssignment] Found user section:', userSection.department, 'with', userSection.steps?.length, 'steps');
          
          // Replace steps_schema with only this user's section steps
          processedTemplate = {
            ...assignment.template,
            steps_schema: userSection.steps || [],
            userSection: {
              id: userSection.id,
              department: userSection.department,
            }
          };
        }
      } else {
        // User doesn't have a specific section, show all steps (for backward compatibility)
        console.log('[getAssignment] User has no section_id, showing all steps');
      }
    }

    return {
      success: true,
      data: {
        ...assignment,
        template: processedTemplate,
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

    // Revalidate all pages that show assignment status
    revalidatePath('/my-tasks');
    revalidatePath('/dashboard');
    revalidatePath('/admin/templates');

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

    // Get assignment with template and logs to check actual progress
    const { data: assignment } = await supabase
      .from('assignments')
      .select(`
        *,
        template:templates(*),
        logs:logs(*)
      `)
      .eq('id', assignmentId)
      .single();

    if (!assignment) {
      return { success: false, error: '任務不存在' };
    }

    if (assignment.archived) {
      return { success: false, error: '任務已經封存' };
    }

    // Calculate actual progress from logs
    const template = assignment.template as any;
    if (template?.steps_schema) {
      const totalSteps = template.steps_schema.reduce((count: number, step: any) => {
        return count + 1 + (step.subSteps?.length || 0);
      }, 0);

      const logs = assignment.logs as any[];
      const sortedLogs = [...logs].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      const checkedSteps = new Set<string>();
      sortedLogs.forEach((log) => {
        if (log.step_id !== null && log.step_id !== undefined) {
          const stepIdStr = log.step_id.toString();
          if (log.action === 'complete') {
            checkedSteps.add(stepIdStr);
          } else if (log.action === 'uncomplete') {
            checkedSteps.delete(stepIdStr);
          }
        }
      });

      const progress = totalSteps > 0 ? Math.round((checkedSteps.size / totalSteps) * 100) : 0;

      if (progress < 100) {
        return { success: false, error: '只能封存進度100%的任務' };
      }
    }

    // Prepare update data
    const updateData: any = {
      archived: true,
      archived_at: new Date().toISOString(),
      archived_by: user.id,
      status: 'completed', // Ensure status is set to completed
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
    revalidatePath('/admin/archived');
    revalidatePath('/dashboard');
    revalidatePath('/my-tasks');
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

    // If not admin, show assignments where user is archived_by or created_by
    if (profile?.role !== 'admin') {
      query = query.or(`archived_by.eq.${user.id},created_by.eq.${user.id}`);
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

    // Check if template exists and get creator info
    const { data: template } = await supabase
      .from('templates')
      .select('id, title, created_by')
      .eq('id', templateId)
      .single();

    if (!template) {
      return { success: false, error: '流程模板不存在' };
    }

    // Allow deletion if user is:
    // 1. Admin or manager
    // 2. The creator of the template
    const isCreator = template.created_by === user.id;
    const isAdminOrManager = profile && (profile.role === 'admin' || profile.role === 'manager');

    if (!isAdminOrManager && !isCreator) {
      return { success: false, error: '權限不足，只有管理員、主管或模板創建者可以刪除流程模板' };
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

/**
 * Create a new template with department-based sections (V2)
 * Each section has its own department, assigned users, and steps
 */
export async function createTemplateV2(data: {
  title: string;
  description: string;
  sections: {
    id: string;
    department: string;
    assigned_users: string[];
    steps: { id: string; label: string; description?: string; required: boolean }[];
  }[];
}) {
  try {
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

    console.log('[createTemplateV2] Creating template with sections:', {
      title: data.title,
      sections_count: data.sections.length,
      total_users: data.sections.reduce((sum, s) => sum + s.assigned_users.length, 0),
      total_steps: data.sections.reduce((sum, s) => sum + s.steps.length, 0),
    });

    // Create template with sections
    // Note: steps_schema will store a flattened version for backward compatibility
    const allSteps = data.sections.flatMap(section => section.steps);
    
    const { data: template, error } = await supabase
      .from('templates')
      .insert({
        title: data.title,
        description: data.description,
        steps_schema: allSteps, // Flattened for backward compatibility
        sections: data.sections, // New: full department sections
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return { success: false, error: `資料庫錯誤: ${error.message}` };
    }

    console.log('[createTemplateV2] Template created:', template.id);

    // Create assignment with all unique users as collaborators
    const allUserIds = new Set<string>();
    allUserIds.add(user.id); // Always include creator
    data.sections.forEach(section => {
      section.assigned_users.forEach(userId => allUserIds.add(userId));
    });

    const userIdArray = Array.from(allUserIds);
    console.log('[createTemplateV2] Creating assignment for users:', userIdArray);

    // Create the main assignment record
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .insert({
        template_id: template.id,
        assigned_to: userIdArray[0], // Primary assignee (creator)
        status: 'pending',
        department: creatorProfile?.department || null,
        created_by: user.id,
      })
      .select()
      .single();

    if (assignmentError) {
      console.error('[createTemplateV2] Error creating assignment:', assignmentError);
      // Don't fail template creation if assignment fails
    } else {
      // Add all users as collaborators with their section info
      const collaborators = userIdArray.map(userId => {
        // Find which section this user belongs to
        const userSection = data.sections.find(s => s.assigned_users.includes(userId));
        return {
          assignment_id: assignment.id,
          user_id: userId,
          section_id: userSection?.id || null, // Store which section this user is assigned to
        };
      });

      const { error: collaboratorError } = await supabase
        .from('assignment_collaborators')
        .insert(collaborators);

      if (collaboratorError) {
        console.error('[createTemplateV2] Error adding collaborators:', collaboratorError);
      }
    }

    revalidatePath('/dashboard');
    revalidatePath('/admin/templates');
    revalidatePath('/my-tasks');
    return { success: true, data: template };
  } catch (error: any) {
    console.error('[createTemplateV2] Unexpected error:', error);
    return { 
      success: false, 
      error: `發生錯誤: ${error.message || '未知錯誤'}` 
    };
  }
}

/**
 * Update an existing template with department-based sections (V2)
 */
export async function updateTemplateV2(templateId: string, data: {
  title: string;
  description: string;
  sections: {
    id: string;
    department: string;
    assigned_users: string[];
    steps: { id: string; label: string; description?: string; required: boolean }[];
  }[];
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
      .select('id, status')
      .eq('template_id', templateId);

    const hasCompletedAssignments = assignments?.some(a => a.status === 'completed');
    if (hasCompletedAssignments) {
      return { success: false, error: '此任務已有完成的指派記錄，無法編輯' };
    }

    console.log('[updateTemplateV2] Updating template:', templateId);

    // Flatten steps for backward compatibility
    const allSteps = data.sections.flatMap(section => section.steps);

    // Update the template
    const { data: template, error } = await supabase
      .from('templates')
      .update({
        title: data.title,
        description: data.description,
        steps_schema: allSteps,
        sections: data.sections,
      })
      .eq('id', templateId)
      .select()
      .single();

    if (error) {
      console.error('[updateTemplateV2] Error updating template:', error);
      return { success: false, error: error.message };
    }

    // Update collaborators for all active assignments
    for (const assignment of assignments || []) {
      // Get current collaborators
      const { data: currentCollaborators } = await supabase
        .from('assignment_collaborators')
        .select('user_id')
        .eq('assignment_id', assignment.id);
      
      const currentUserIds = new Set(currentCollaborators?.map(c => c.user_id) || []);
      
      // Get new user IDs from sections
      const newUserIds = new Set<string>();
      data.sections.forEach(section => {
        section.assigned_users.forEach(userId => newUserIds.add(userId));
      });

      // Find users to add (use Array.from instead of spread)
      const usersToAdd = Array.from(newUserIds).filter(id => !currentUserIds.has(id));
      
      // Find users to remove (use Array.from instead of spread)
      const usersToRemove = Array.from(currentUserIds).filter(id => !newUserIds.has(id as string)) as string[];

      // Add new collaborators
      if (usersToAdd.length > 0) {
        const newCollaborators = usersToAdd.map(userId => {
          const userSection = data.sections.find(s => s.assigned_users.includes(userId));
          return {
            assignment_id: assignment.id,
            user_id: userId,
            section_id: userSection?.id || null,
          };
        });
        
        await supabase
          .from('assignment_collaborators')
          .insert(newCollaborators);
      }

      // Remove old collaborators (except if they've already completed steps)
      if (usersToRemove.length > 0) {
        for (const userId of usersToRemove) {
          // Check if user has any logs
          const { data: userLogs } = await supabase
            .from('logs')
            .select('id')
            .eq('assignment_id', assignment.id)
            .eq('user_id', userId)
            .limit(1);
          
          // Only remove if no logs
          if (!userLogs || userLogs.length === 0) {
            await supabase
              .from('assignment_collaborators')
              .delete()
              .eq('assignment_id', assignment.id)
              .eq('user_id', userId);
          }
        }
      }
    }

    revalidatePath('/admin/templates');
    revalidatePath('/admin/template/[id]', 'page');
    revalidatePath('/dashboard');
    revalidatePath('/my-tasks');
    return { success: true, data: template };
  } catch (error: any) {
    console.error('[updateTemplateV2] Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤' };
  }
}

/**
 * Get all unique departments from profiles
 */
export async function getAllDepartments() {
  try {
    const supabase = createClient();
    
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('department')
      .not('department', 'is', null)
      .not('department', 'eq', '');
    
    if (error) {
      console.error('Error fetching departments:', error);
      return { success: false, error: error.message, data: [] };
    }

    // Get unique departments (use Array.from instead of spread)
    const departmentSet = new Set(profiles?.map(p => p.department).filter(Boolean));
    const departments = Array.from(departmentSet) as string[];
    
    return { success: true, data: departments.sort() };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤', data: [] };
  }
}

/**
 * Get users by department
 */
export async function getUsersByDepartment(department: string) {
  try {
    const supabase = createClient();
    
    const { data: users, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, department, job_title')
      .eq('department', department)
      .order('full_name');
    
    if (error) {
      console.error('Error fetching users by department:', error);
      return { success: false, error: error.message, data: [] };
    }

    return { success: true, data: users || [] };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤', data: [] };
  }
}

/**
 * Duplicate/Copy a template
 */
export async function duplicateTemplate(templateId: string, newTitle?: string) {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // Get the original template
    const { data: originalTemplate, error: fetchError } = await supabase
      .from('templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (fetchError || !originalTemplate) {
      console.error('Error fetching template:', fetchError);
      return { success: false, error: '找不到原始任務' };
    }

    // Create new title
    const copiedTitle = newTitle || `${originalTemplate.title} (副本)`;

    // Create the duplicated template
    const { data: newTemplate, error: createError } = await supabase
      .from('templates')
      .insert({
        title: copiedTitle,
        description: originalTemplate.description,
        steps_schema: originalTemplate.steps_schema,
        sections: originalTemplate.sections,
        created_by: user.id, // Set current user as creator
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating duplicate template:', createError);
      return { success: false, error: `複製失敗: ${createError.message}` };
    }

    revalidatePath('/admin/templates');
    return { success: true, data: newTemplate };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤' };
  }
}

/**
 * 從已封存的任務複製創建新任務
 * @param archivedAssignmentId - 要複製的已封存任務 ID
 * @param newTitle - 新任務標題（可選，默認為原標題 + "副本"）
 * @returns 新創建的任務
 */
export async function duplicateArchivedAssignment(
  archivedAssignmentId: string,
  newTitle?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // Get user's profile to get department
    const { data: profile } = await supabase
      .from('profiles')
      .select('department')
      .eq('id', user.id)
      .single();

    // Fetch the archived assignment with all its data
    const { data: originalAssignment, error: fetchError } = await supabase
      .from('assignments')
      .select(`
        *,
        template:templates(*)
      `)
      .eq('id', archivedAssignmentId)
      .eq('archived', true)
      .single();

    if (fetchError || !originalAssignment) {
      console.error('Error fetching archived assignment:', fetchError);
      return { success: false, error: '找不到該封存任務' };
    }

    if (!originalAssignment.template) {
      return { success: false, error: '該任務的模板已被刪除，無法複製' };
    }

    // Create new assignment with the same template
    // Use current user's department instead of original assignment's department
    const { data: newAssignment, error: createError } = await supabase
      .from('assignments')
      .insert({
        template_id: originalAssignment.template_id,
        assigned_to: user.id, // Assign to current user
        department: profile?.department || null, // Use current user's department
        status: 'pending',
        created_by: user.id
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating duplicate assignment:', createError);
      return { success: false, error: `複製失敗: ${createError.message}` };
    }

    revalidatePath('/admin/archived');
    revalidatePath('/my-tasks');
    revalidatePath('/dashboard');
    
    return { success: true, data: newAssignment };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message || '發生未知錯誤' };
  }
}

