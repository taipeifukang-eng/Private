export type BirthdayRow={row:number;employee_code:string;employee_name:string;birthday:string};
export type BirthdayIssue={row:number;message:string};
export const MAX_BIRTHDAY_ROWS=10000;
export const MAX_BIRTHDAY_BYTES=5*1024*1024;

export function normalizeBirthday(value:string,today:string):string|null{
 const match=value.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);if(!match)return null;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 if(year<1900||month<1||month>12||day<1||day>31)return null;
 const date=new Date(Date.UTC(year,month-1,day));
 if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
 const normalized=`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
 return normalized<=today?normalized:null;
}

// Parse quoted commas, escaped quotes and multiline fields while retaining source line numbers.
function csvRecords(input:string){
 const rows:{line:number;cells:string[]}[]=[];let cells:string[]=[],value='',quoted=false,closed=false,line=1,start=1;
 const pushCell=()=>{cells.push(value);value='';closed=false;};
 for(let i=0;i<input.length;i++){
  const ch=input[i];
  if(quoted){if(ch==='"'){if(input[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else{value+=ch;if(ch==='\n'||(ch==='\r'&&input[i+1]!=='\n'))line++;}continue;}
  if(ch==='"'){if(value.trim()||closed)throw Error(`第 ${line} 列的引號格式不正確`);value='';quoted=true;continue;}
  if(ch===','){pushCell();continue;}
  if(ch==='\r'||ch==='\n'){if(ch==='\r'&&input[i+1]==='\n')i++;pushCell();if(cells.some(c=>c.trim()))rows.push({line:start,cells});cells=[];line++;start=line;if(rows.length>MAX_BIRTHDAY_ROWS+1)throw Error(`最多可匯入 ${MAX_BIRTHDAY_ROWS} 列`);continue;}
  if(closed){if(ch.trim())throw Error(`第 ${line} 列的引號後有多餘文字`);continue;}
  value+=ch;
 }
 if(quoted)throw Error(`第 ${start} 列的引號未關閉`);
 pushCell();if(cells.some(c=>c.trim()))rows.push({line:start,cells});return rows;
}

export function parseBirthdayCsv(input:string,today:string){
 if(new TextEncoder().encode(input).length>MAX_BIRTHDAY_BYTES)throw Error('CSV 檔案不可超過 5 MB');
 if(input.includes('\uFFFD')||input.includes('\0'))throw Error('檔案編碼無法辨識，請使用 UTF-8 CSV');
 const records=csvRecords(input.replace(/^\uFEFF/,''));if(!records.length)throw Error('CSV 沒有內容');
 const header=records.shift()!;const columns=header.cells.map(s=>s.trim());
 const aliases:Record<string,string>={'員編':'employee_code','員工代碼':'employee_code','姓名':'employee_name','生日':'birthday','生日(YYYY-MM-DD)':'birthday',employee_code:'employee_code',employee_name:'employee_name',birthday:'birthday'};
 const fields=columns.map(c=>aliases[c]);
 if(fields.length!==3||new Set(fields).size!==3||['employee_code','employee_name','birthday'].some(k=>!fields.includes(k)))throw Error('CSV 標題須包含且僅包含「員編、姓名、生日」三欄');
 if(records.length>MAX_BIRTHDAY_ROWS)throw Error(`最多可匯入 ${MAX_BIRTHDAY_ROWS} 列`);
 const rows:BirthdayRow[]=[],errors:BirthdayIssue[]=[],seen=new Map<string,number>();let skipped=0;
 for(const record of records){
  if(record.cells.length!==3){errors.push({row:record.line,message:'欄位數量不是三欄，請確認逗號與引號'});continue;}
  const data=Object.fromEntries(fields.map((k,i)=>[k,record.cells[i].trim()]));
  if(!data.birthday){skipped++;continue;}
  const code=data.employee_code.toUpperCase();
  if(!/^[A-Z0-9_-]{1,30}$/.test(code)){errors.push({row:record.line,message:'員編格式不正確'});continue;}
  if(!data.employee_name||data.employee_name.length>200){errors.push({row:record.line,message:'請填寫正確姓名'});continue;}
  if(seen.has(code)){errors.push({row:record.line,message:`員編 ${code} 與第 ${seen.get(code)} 列重複`});continue;}seen.set(code,record.line);
  const birthday=normalizeBirthday(data.birthday,today);
  if(!birthday){errors.push({row:record.line,message:'生日須為有效西元日期，且不可晚於今天（YYYY-MM-DD 或 YYYY/M/D）'});continue;}
  rows.push({row:record.line,employee_code:code,employee_name:data.employee_name,birthday});
 }
 return {rows,errors,skipped};
}

// Exported CSV adds an apostrophe before spreadsheet formula-like text. Remove it
// only when the exact canonical employee name proves it was an export escape.
export function restoreBirthdayNames(rows:BirthdayRow[],employees:{employee_code:string;employee_name:string}[]){
 const names=new Map(employees.map(e=>[e.employee_code.toUpperCase(),e.employee_name.trim()]));
 return rows.map(row=>{
  const canonical=names.get(row.employee_code),name=row.employee_name;
  return canonical!==name&&/^'[=+\-@\t\r]/.test(name)&&name.slice(1)===canonical?{...row,employee_name:canonical}:row;
 });
}
export function matchBirthdayEmployees(rows:BirthdayRow[],employees:{employee_code:string;employee_name:string}[]){
 const byCode=new Map(employees.map(e=>[e.employee_code.toUpperCase(),e]));const errors:BirthdayIssue[]=[];
 for(const row of rows){const employee=byCode.get(row.employee_code);if(!employee)errors.push({row:row.row,message:`查無員編 ${row.employee_code}`});else if(employee.employee_name.trim()!==row.employee_name.trim())errors.push({row:row.row,message:`員編 ${row.employee_code} 的姓名與目前資料不符`});}
 return errors;
}
