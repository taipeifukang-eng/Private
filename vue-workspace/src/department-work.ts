export const workTypes:Record<string,string>={fixed:'固定工作',recurring:'週期工作',project:'專案工作'};
export const importanceLabels:Record<string,string>={normal:'一般',important:'重要',critical:'關鍵'};
export const assignmentLabels:Record<string,string>={PRIMARY:'主責',COLLABORATOR:'協作',BACKUP:'代理'};
export const workFields:Record<string,string>={purpose:'工作目的',execution_context:'執行情境',completion_standard:'完成標準',notes:'備註',related_resources:'相關資源',handover_focus:'接手重點',required_systems:'所需系統',important_contacts:'重要聯絡人',handover_notes:'交接注意事項'};
export const currentAssignments=(item:any)=>(item.assignments||[]).filter((a:any)=>a.status==='active'&&!a.effective_to);
