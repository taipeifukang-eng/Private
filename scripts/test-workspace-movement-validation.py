import json,subprocess,base64
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright
B='http://localhost:3002';accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts']
with sync_playwright() as p:
 def login(key):
  c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});a=next(a for a in accounts if a['key']==key);assert c.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok;return c
 c=login('navigation');viewer=login('viewer');session=c.get('/api/workspace/session').json();assert session['stores'];store=session['stores'][0]['id'];code='VPV'+uuid4().hex[:12].upper()
 row={'employee_code':code,'employee_name':'驗證不儲存','store_id':store,'movement_type':'onboarding','birthday':'2000-02-29','onboarding_is_pharmacist':False,'effective_date':'2026-08-01'}
 before=c.get('/api/workspace/employees').json()['employees'];history_before=c.get('/api/workspace/employees?history='+code).json()['history']
 result=c.post('/api/workspace/movement-validation',data={'rows':[row]});assert result.ok,result.text();body=result.json();assert body['valid'],body['errors'];assert body['validationOnly'] and body['canSubmit'] is False and body['references'][0]['store_name']
 assert viewer.post('/api/workspace/movement-validation',data={'rows':[row]}).status==403
 assert c.post('/api/workspace/movement-validation',data={'rows':[row]},headers={'Origin':'https://invalid.example'}).status==403
 assert c.post('/api/workspace/movement-validation',data={'rows':[]}).status==400
 bad=c.post('/api/workspace/movement-validation',data={'rows':[dict(row,birthday='2001-02-29')]}).json();assert not bad['valid'] and any(e['field']=='birthday' for e in bad['errors'])
 missing=c.post('/api/workspace/movement-validation',data={'rows':[dict(row,store_id=str(uuid4()))]}).json();assert not missing['valid'] and any(e['field']=='store_id' for e in missing['errors'])
 missing_employee=c.post('/api/workspace/movement-validation',data={'rows':[dict(row,movement_type='resignation')]}).json();assert not missing_employee['valid'] and any(e['field']=='employee_code' for e in missing_employee['errors'])
 def workbook(values):
  script="const fs=require('fs'),X=require('xlsx');const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.aoa_to_sheet(JSON.parse(fs.readFileSync(0,'utf8'))),'異動');process.stdout.write(X.write(b,{type:'base64',bookType:'xlsx'}));"
  result=subprocess.run(['node','-e',script],input=json.dumps(values,ensure_ascii=False),encoding='utf-8',capture_output=True,check=True);return base64.b64decode(result.stdout)
 header=['員編','姓名','異動類型','任職門市ID','是否為藥師','生日','生效日期']
 values=[header,[],[code,'驗證不儲存','入職',store,'否','2000-02-29','2026-08-01']]
 uploaded=c.post('/api/workspace/movement-validation',multipart={'file':{'name':'movements.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':workbook(values)}});assert uploaded.ok,uploaded.text();parsed=uploaded.json();assert parsed['valid'] and parsed['sourceRows']==[3] and parsed['references'][0]['row']==3 and parsed['canSubmit'] is False
 values[2][3]=str(uuid4());missing_file=c.post('/api/workspace/movement-validation',multipart={'file':{'name':'missing.xlsx','mimeType':'application/octet-stream','buffer':workbook(values)}}).json();assert not missing_file['valid'] and any(e['row']==3 and e['field']=='store_id' for e in missing_file['errors'])
 assert c.post('/api/workspace/movement-validation',multipart={'file':{'name':'bad.txt','mimeType':'text/plain','buffer':b'bad'}}).status==400
 assert c.get('/api/workspace/employees').json()['employees']==before;assert c.get('/api/workspace/employees?history='+code).json()['history']==history_before
 print('PASS read-only movement validation API: real store, JSON/Excel rows with original line numbers, no-save marker, invalid references/fields, permission/origin and unchanged employee/history reads')
