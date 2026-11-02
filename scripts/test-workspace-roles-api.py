import os,uuid
from playwright.sync_api import sync_playwright
B='http://localhost:3002'
with sync_playwright() as p:
 c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B},timeout=120000)
 assert c.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']}).ok
 r=c.get('/api/workspace/roles?includeDevRoles=true');assert r.ok,r.text();initial={r['id'] for r in r.json()['roles']};system=next(r for r in r.json()['roles'] if r['is_system'])
 assert c.delete('/api/workspace/roles/'+system['id']).status==400
 assert c.patch('/api/workspace/roles/'+system['id'],data={'is_active':False}).status==400
 assert c.post('/api/workspace/roles',data={},headers={'Origin':'http://invalid.test'}).status==403
 anon=p.request.new_context(base_url=B);assert anon.get('/api/workspace/roles').status==401
 role=None;user=None
 initial_users={u['id'] for u in c.get('/api/workspace/users').json()['users']}
 try:
  r=c.post('/api/workspace/roles',data={'name':'Vue角色驗證','code':'dev_vue_'+uuid.uuid4().hex,'description':'temporary dev verification role'});assert r.ok,r.text();role=r.json()['role']['id'];url='/api/workspace/roles/'+role
  r=c.patch(url,data={'name':'Vue角色驗證完成','description':'dev-only','is_active':False});assert r.ok,r.text();assert not r.json()['role']['is_active']
  r=c.get(url+'/permissions');assert r.ok,r.text();permissions=r.json()['permissions'];pid=permissions[0]['id']
  r=c.post(url+'/permissions',data={'permissionIds':[pid],'expectedPermissionIds':[]});assert r.ok,r.text()
  r=c.post(url+'/permissions',data={'permissionIds':[],'expectedPermissionIds':[]});assert r.status==409,r.text()
  assert [x['id'] for x in c.get(url+'/permissions').json()['permissions'] if x['granted']]==[pid]
  assert c.get(url+'/users').json()['users']==[]
  assert c.post(url+'/users',data={'employee_codes':['NO_SUCH_'+uuid.uuid4().hex]}).status==404
  token=uuid.uuid4().hex;code='RT'+token[:10].upper()
  r=c.post('/api/workspace/users',data={'action':'create','email':'role-test-'+token+'@example.com','full_name':'臨時角色指派測試','password':uuid.uuid4().hex+'Aa!'});assert r.ok,r.text();user=r.json()['id']
  r=c.patch('/api/workspace/users',data={'action':'edit','id':user,'full_name':'臨時角色指派測試','employee_code':code,'department':'','job_title':''});assert r.ok,r.text()
  r=c.post(url+'/users',data={'employee_codes':[code]});assert r.ok and r.json()['added']==1,r.text()
  assert [u['id'] for u in c.get(url+'/users').json()['users']]==[user]
  r=c.post(url+'/users',data={'employee_codes':[code]});assert r.ok and r.json()['added']==0,r.text()
  r=c.delete(url+'/users/'+user);assert r.ok,r.text();assert c.get(url+'/users').json()['users']==[]
  print('PASS isolated real user assignment, duplicate skip and revocation',flush=True)
  print('PASS DEV role create/edit/permissions atomic save/stale409, users read, invalid employee404, system delete/disable400, origin403, anonymous401',flush=True)
 finally:
  if user:
   assert user not in initial_users
   r=c.delete('/api/workspace/users?id='+user);assert r.ok,r.text()
   assert {u['id'] for u in c.get('/api/workspace/users').json()['users']}==initial_users
  if role:
   assert role not in initial
   r=c.delete('/api/workspace/roles/'+role);assert r.ok,r.text()
   assert {r['id'] for r in c.get('/api/workspace/roles?includeDevRoles=true').json()['roles']}==initial
   print('PASS temporary role removed; existing role IDs unchanged',flush=True)
