import * as XLSX from 'xlsx';
type Catalog={types:Array<{value:string;label:string}>;stores:Array<{id:string;store_code:string;store_name:string}>;organizationOptions:Array<{id:string;code:string;path:string}>};
function sheet(values:unknown[][],widths:number[]){const result=XLSX.utils.aoa_to_sheet(values.map(row=>row.map(v=>String(v??''))));for(const key of Object.keys(result))if(!key.startsWith('!')){result[key].t='s';result[key].z='@';delete result[key].f;}result['!cols']=widths.map(wch=>({wch}));return result;}
export function movementDraftFile(rows:Record<string,any>[],catalog:Catalog,template=false){
 if(template){
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const first=catalog.stores[0]?.store_code||'請填門市代號',second=catalog.stores[1]?.store_code||'請填另一門市代號';
  rows=catalog.types.map((t,i)=>({employee_code:'EXAMPLE-'+String(i+1).padStart(2,'0'),employee_name:'範例人員'+(i+1),movement_type:t.value,store_id:t.value==='store_transfer'?'':first,onboarding_is_pharmacist:false,birthday:t.value==='onboarding'?'1990-01-01':'',position:t.value==='promotion'?'專員':t.value==='acting_manager'?'代理店長':'',newbie_level:'',from_store_id:t.value==='store_transfer'?first:'',to_store_id:t.value==='store_transfer'?second:'',effective_date:date,notes:'填寫示範；請改為實際人員及日期後再驗證'}));
 }
 const headers=[template?'員編':'完整員編','姓名','異動類型','任職門市ID','是否為藥師','生日','升任後職位','升任後新人/行政等級','原任職門市ID','新任職門市ID','生效日期','備註'];
 const values=rows.map(r=>[r.employee_code,r.employee_name,catalog.types.find(t=>t.value===r.movement_type)?.label||r.movement_type,r.store_id,r.movement_type==='onboarding'?(r.onboarding_is_pharmacist===true?'是':r.onboarding_is_pharmacist===false?'否':''):'',r.birthday,r.position,r.newbie_level,r.from_store_id,r.to_store_id,r.effective_date,r.notes]);
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet([headers,...values],[20,20,18,40,16,16,20,26,40,40,16,60]),'異動資料');
 XLSX.utils.book_append_sheet(book,sheet([
  ['填寫說明'],['只讀取第一個工作表，最多500列；每列一筆異動。'],
  ['此檔為範本或草稿備份；匯入及查核不代表已儲存異動。'],
  ['範例的 EXAMPLE-xx 員編、姓名、門市及日期需改為實際資料；系統不接受範例員編通過驗證。'],
  ['完整員編欄不補前綴；員編欄沿用舊版四位數補FK、五位數補FKF。'],
  ['員編與日期請保留文字格式；日期使用西元YYYY-MM-DD，不使用民國年。'],
  ['入職須任職門市或總部最下層單位、生日、明確是／否藥師。'],
  ['升職須職位；新人與行政須有效階級。代理須填代理店長。'],
  ['調店須原任職與新任職門市，兩者不可相同。其他異動須任職門市。'],
  ['門市可填ID、代碼或名稱；若名稱重複請使用ID。總部單位使用org:ID。'],
  ['不要使用公式；備註內不要重複填寫新人等級或行政階級標記。'],
  ['異動類型',...catalog.types.map(t=>t.label)],
 ],[100]),'填寫說明');
 XLSX.utils.book_append_sheet(book,sheet([['任職ID','代碼','門市／完整組織路徑'],...catalog.stores.map(s=>[s.id,s.store_code,s.store_name]),...catalog.organizationOptions.map(u=>['org:'+u.id,u.code,u.path])],[42,20,80]),'可選任職單位');
 return XLSX.write(book,{type:'array',bookType:'xlsx'});
}
