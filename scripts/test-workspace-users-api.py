import os,uuid,json
from pathlib import Path
from playwright.sync_api import sync_playwright
B='http://localhost:3002'
with sync_playwright() as p:
 c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B},timeout=60000)
 assert c.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']}).ok
 before=c.get('/api/workspace/users');assert before.ok,before.text();initial=before.json();actor=initial['currentUser'];initial_ids={u['id'] for u in initial['users']}
 anon=p.request.new_context(base_url=B);assert anon.get('/api/workspace/users').status==401
 assert c.patch('/api/workspace/users',data={'action':'role','id':actor,'role':'member'},headers={'Origin':'https://invalid.example'}).status==403
 assert c.patch('/api/workspace/users',data={'action':'role','id':actor,'role':'member'}).status==400
 assert c.delete('/api/workspace/users?id='+actor).status==400
 assert c.get('/api/workspace/users?id=invalid').status==400
 assert c.get('/api/workspace/users?id='+actor).ok
 assert c.post('/api/workspace/users',data={'action':'create','email':'invalid','full_name':'bad','password':'x'}).status==400
 token=uuid.uuid4().hex;email='vue-user-'+token+'@example.com';password=uuid.uuid4().hex+'Aa!';target=None
 try:
  r=c.post('/api/workspace/users',data={'action':'create','email':email,'full_name':'新版使用者流程測試','password':password});assert r.ok,r.text();target=r.json()['id'];assert target not in initial_ids
  Path('.tmp-check/users-test-created.json').write_text(json.dumps({'id':target,'email':email}),encoding='utf-8')
  assert c.get('/api/workspace/session').json()['user']['id']==actor
  r=c.patch('/api/workspace/users',data={'action':'edit','id':target,'full_name':'流程測試完成','employee_code':'UT'+token[:10],'department':'測試部門','job_title':'測試職位'});assert r.ok,r.text()
  r=c.patch('/api/workspace/users',data={'action':'role','id':target,'role':'manager'});assert r.ok,r.text()
  row=next(u for u in c.get('/api/workspace/users').json()['users'] if u['id']==target);assert row['role']=='manager' and row['department']=='測試部門' and row['employee_code']=='UT'+token[:10].upper()
  weak=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});assert weak.post('/api/workspace/login',data={'email':email,'password':password}).ok
  assert weak.get('/api/workspace/users').status==403
  assert weak.post('/api/workspace/users',data={'action':'reset','id':actor,'password':'invalid-test'}).status==403
  newpassword=uuid.uuid4().hex+'Aa!';r=c.post('/api/workspace/users',data={'action':'reset','id':target,'password':newpassword});assert r.ok,r.text()
  fresh=p.request.new_context(base_url=B);assert fresh.post('/api/workspace/login',data={'email':email,'password':newpassword},headers={'Origin':B}).ok
  print('PASS real DEV list/detail, anonymous401, Origin403, self role/delete protection, create without replacing actor, edit and role preserving fields, unprivileged403, reset and login; temporary account only',flush=True)
 finally:
  if target:
   assert target not in initial_ids
   r=c.delete('/api/workspace/users?id='+target);assert r.ok,r.text();assert r.json().get('action')=='deleted',r.text()
   assert {u['id'] for u in c.get('/api/workspace/users').json()['users']}==initial_ids
   print('PASS temporary account removed; original user IDs unchanged',flush=True)
