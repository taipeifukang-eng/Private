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

    console.log('Inserting template:', {
      title: data.title,
      steps_count: data.steps_schema.length,
    });

    // TODO: Get current user ID from auth
    // For now, we'll insert without user tracking
    const { data: template, error } = await supabase
      .from('templates')
      .insert({
        title: data.title,
        description: data.description,
        steps_schema: data.steps_schema,
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return { success: false, error: `資料庫錯誤: ${error.message}` };
    }

    console.log('Template created successfully:', template);
    revalidatePath('/dashboard');
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
 * Get all templates
 */
export async function getTemplates() {
  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .from('templates')
      .select('*')
      .order('created_at', { ascending: false });

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
 * Create an assignment (assign a template to a user)
 */
export async function createAssignment(data: {
  template_id: string;
  assigned_to: string;
}) {
  try {
    const supabase = createClient();

    const { data: assignment, error } = await supabase
      .from('assignments')
      .insert({
        template_id: data.template_id,
        assigned_to: data.assigned_to,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating assignment:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/dashboard');
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

    // TODO: Get current user ID from auth
    // For now, we'll use the assigned_to user from the assignment
    const { data: assignment } = await supabase
      .from('assignments')
      .select('assigned_to')
      .eq('id', assignmentId)
      .single();

    const { data: log, error } = await supabase
      .from('logs')
      .insert({
        assignment_id: assignmentId,
        user_id: assignment?.assigned_to || null,
        step_id: parseInt(stepId),
        action: action,
      })
      .select()
      .single();

    if (error) {
      console.error('Error logging action:', error);
      return { success: false, error: error.message };
    }

    // Update assignment status to in_progress if it was pending
    if (assignment) {
      await supabase
        .from('assignments')
        .update({ status: 'in_progress' })
        .eq('id', assignmentId)
        .eq('status', 'pending');
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
 * Get all assignments with template and logs data
 */
export async function getAssignments() {
  try {
    const supabase = createClient();

    const { data: assignments, error: assignmentsError } = await supabase
      .from('assignments')
      .select(`
        *,
        template:templates(*)
      `)
      .order('created_at', { ascending: false });

    if (assignmentsError) {
      console.error('Error fetching assignments:', assignmentsError);
      return { success: false, error: assignmentsError.message, data: [] };
    }

    // Fetch logs for all assignments
    const assignmentIds = assignments?.map(a => a.id) || [];
    const { data: logs, error: logsError } = await supabase
      .from('logs')
      .select('*')
      .in('assignment_id', assignmentIds);

    if (logsError) {
      console.error('Error fetching logs:', logsError);
    }

    // Fetch user profiles for all assignments
    const userIds = [...new Set(assignments?.map(a => a.assigned_to).filter(Boolean))];
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', userIds);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
    }

    // Create a map of user profiles
    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

    // Combine data
    const enrichedAssignments = assignments?.map(assignment => ({
      ...assignment,
      logs: logs?.filter(log => log.assignment_id === assignment.id) || [],
      assigned_user: profileMap.get(assignment.assigned_to) || null,
    })) || [];

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

    return {
      success: true,
      data: {
        ...assignment,
        logs: logs || [],
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

    const { error } = await supabase
      .from('assignments')
      .update({ status })
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
