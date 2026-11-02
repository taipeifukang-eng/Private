import json
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright
B='http://localhost:3002';fixture=json.loads(Path('.tmp-check/employee-create-api-fixture.json').read_text(encoding='utf-8'));accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts']
with sync_playwright() as p:
 def login(key):
  a=next(a for a in accounts if a['key']==key);c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});assert c.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok;return c
 c=login('navigation');viewer=login('viewer');data={'employee_code':fixture['code'].lower(),'employee_name':'Vue 員工新增 API 驗證','current_position':'專員','start_date':'2026-10-01','birthday':'1990-02-03'};body={'requestId':str(uuid4()),'data':data}
 assert viewer.post('/api/workspace/employees',data=body).status==403
 assert c.post('/api/workspace/employees',data=body,headers={'Origin':'https://invalid.example'}).status==403
 assert c.post('/api/workspace/employees',data={'requestId':str(uuid4()),'data':dict(data,birthday='2023-02-29')}).status==400
 assert c.post('/api/workspace/employees',data={'requestId':str(uuid4()),'data':dict(data,employee_code='FKI'+fixture['code'])}).status==400
 result=c.post('/api/workspace/employees',data=body);assert result.ok,result.status;assert result.json()['employee_code']==fixture['code']
 assert c.post('/api/workspace/employees',data=body).json()==result.json()
 assert c.post('/api/workspace/employees',data={'requestId':str(uuid4()),'data':data}).status==409
 employees=c.get('/api/workspace/employees').json()['employees'];created=[e for e in employees if e['employee_code']==fixture['code']];assert len(created)==1 and created[0]['birthday']=='1990-02-03' and created[0]['current_position']=='專員'
 print('PASS employee API create/readback, uppercase code, dates, intern-code confirmation, permissions/origin, idempotency and duplicates')
