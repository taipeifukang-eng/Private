import json
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright
B='http://localhost:3002';accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts'];ids=json.loads(Path('.tmp-check/movement-catalog-fixture.json').read_text())['ids']
with sync_playwright() as p:
 def login(key):
  a=next(a for a in accounts if a['key']==key);c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});assert c.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok;return c
 c=login('navigation');viewer=login('viewer');assert viewer.get('/api/workspace/movement-validation').status==403
 response=c.get('/api/workspace/movement-validation');assert response.ok,response.text();catalog=response.json();assert catalog['canSubmit'] is False;assert len(catalog['types'])==8;assert all(s['is_active'] for s in catalog['stores']);assert len({e['id'] for e in catalog['employees']})==len(catalog['employees'])
 selected=[u for u in catalog['organizationOptions'] if u['id'] in ids];assert len(selected)==1 and selected[0]['id']==ids[3];assert selected[0]['path']=='驗證公司 / 驗證總部 / 驗證部門 / 驗證最下層'
 row={'employee_code':'VCT'+uuid4().hex[:12].upper(),'employee_name':'組織入職僅驗證','movement_type':'onboarding','effective_date':'2026-08-01','birthday':'2000-01-01','onboarding_is_pharmacist':False}
 for i,id in enumerate(ids):
  result=c.post('/api/workspace/movement-validation',data={'rows':[dict(row,store_id='org:'+id)]});assert result.ok,result.text();r=result.json();assert r['valid']==(i==3),r;assert r['canSubmit'] is False
 assert c.get('/api/workspace/employees?history='+row['employee_code']).json()['history']==[]
 print('PASS live batch catalog/validation: active HQ leaf only, full path, parent/company/outside/inactive rejection, eight types, unique employee rows and viewer denial')
