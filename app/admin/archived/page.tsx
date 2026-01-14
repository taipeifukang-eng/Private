import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getArchivedAssignments } from '@/app/actions';
import Link from 'next/link';
import { Archive, Calendar, User, Clock, CheckCircle, FileText, ChevronLeft, ChevronDown, ChevronRight } from 'lucide-react';
import ArchivedTasksList from '@/components/admin/ArchivedTasksList';

export default async function ArchivedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single();

  if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
    redirect('/dashboard');
  }

  const result = await getArchivedAssignments();

  if (!result.success) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">錯誤: {result.error}</p>
          </div>
        </div>
      </div>
    );
  }

  const archivedAssignments = result.data || [];

  // 按照建立日期的年月分組
  const groupedByMonth = archivedAssignments.reduce((acc: any, assignment: any) => {
    const date = new Date(assignment.created_at);
    const yearMonth = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (!acc[yearMonth]) {
      acc[yearMonth] = [];
    }
    acc[yearMonth].push(assignment);
    return acc;
  }, {});

  // 按照年月排序（最新的在前）
  const sortedMonths = Object.keys(groupedByMonth).sort((a, b) => b.localeCompare(a));

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/templates"
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <ChevronLeft size={24} />
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                <Archive className="text-purple-600" size={32} />
                已封存任務
              </h1>
              <p className="text-gray-600 mt-1">
                查看所有已完成並封存的任務記錄
              </p>
            </div>
          </div>
          <div className="text-sm text-gray-600">
            共 {archivedAssignments.length} 個已封存任務
          </div>
        </div>

        {/* Content */}
        {archivedAssignments.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <Archive size={64} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              尚無已封存任務
            </h3>
            <p className="text-gray-600">
              當任務完成後，您可以選擇封存以保存歷史記錄
            </p>
          </div>
        ) : (
          <ArchivedTasksList 
            groupedByMonth={groupedByMonth}
            sortedMonths={sortedMonths}
          />
        )}
      </div>
    </div>
  );
}
