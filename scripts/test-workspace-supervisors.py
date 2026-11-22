import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002'
accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts']
f=json.loads(Path('.tmp-check/supervisor-fixture.json').read_text(encoding='utf-8'));users={u['key']:u for u in f['users']}
a,b,m,third=[users[k]['id'] for k in ['a','b','manager','supervisorOnly']];s1,s2,s3,hq=[s['id'] for s in f['stores']]
expect.set_options(timeout=30000)
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1440,'height':1000},extra_http_headers={'Origin':B})
 admin=next(u for u in accounts if u['key']=='navigation');assert c.request.post('/api/workspace/login',data={'email':admin['email'],'password':admin['password']}).ok
 def get():
  r=c.request.get('/api/workspace/supervisors');assert r.ok,r.text();return r.json()
 def version(d):return sorted(':'.join([r['id'],r['user_id'],r['store_id'],r['role_type'],str(r['is_primary']).lower()]) for r in d['assignments'])
 def put(user,ids,choices=None,role='supervisor',expected=None,client=None):
  return (client or c).request.put('/api/workspace/supervisors',data={'userId':user,'storeIds':ids,'primaryAssignments':[{'storeId':sid,'userId':uid} for sid,uid in (choices or {}).items()],'roleType':role,'expected':version(get()) if expected is None else expected})
 def row(user,store,role='supervisor'):return next(r for r in get()['assignments'] if r['user_id']==user and r['store_id']==store and r['role_type']==role)
 def ok(r):assert r.ok,r.text()
 def clear(user):
  d=get();own=[r for r in d['assignments'] if r['user_id']==user and r['role_type']=='supervisor'];choices={}
  for r in own:
   other=[x for x in d['assignments'] if x['store_id']==r['store_id'] and x['user_id']!=user and x['role_type']=='supervisor' and '督導' in (x.get('user') or {}).get('job_title','')]
   if r['is_primary'] and other:choices[r['store_id']]=other[0]['user_id']
  ok(put(user,[],choices))
 original=[r for r in get()['assignments'] if r['user_id'] not in [u['id'] for u in f['users']]]
 if '--ui-only' not in __import__('sys').argv:
  ok(put(a,[s1]));assert row(a,s1)['is_primary'];ok(put(a,[s1]));assert put(b,[s1]).status==409
  ok(put(b,[s1],{s1:a}));assert not row(b,s1)['is_primary'];ok(put(m,[s1]));assert not row(m,s1)['is_primary']
  ok(put(third,[s1],{s1:b}));assert row(b,s1)['is_primary'];assert not row(a,s1)['is_primary'];assert not row(third,s1)['is_primary']
  before=version(get());assert put(third,[s1],{s1:m}).status==400;assert version(get())==before
  assert put(third,[s1],{s2:third}).status==400;assert put(b,[]).status==409;assert row(b,s1)['is_primary']
  ok(put(b,[],{s1:a}));assert row(a,s1)['is_primary'];ok(put(a,[s1],role='store_manager'));assert not row(a,s1,'store_manager')['is_primary']
  stale=version(get());ok(put(m,[s1,s2]));assert put(b,[s1],{s1:b},expected=stale).status==409
  for user,ids in [(a,[s3]),(a,[hq]),(users['ineligible']['id'],[s2])]:assert put(user,ids).status==400
  assert put(a,[s2],role='invalid').status==400
  for key,denied in [('supervisorOnly','store_manager'),('managerOnly','supervisor')]:
   client=browser.new_context(base_url=B,extra_http_headers={'Origin':B});u=users[key];ok(client.request.post('/api/workspace/login',data={'email':u['email'],'password':u['password']}));ok(client.request.get('/api/workspace/supervisors'));assert put(a,[],role=denied,client=client).status==403;client.close()
  viewer=browser.new_context(base_url=B,extra_http_headers={'Origin':B});v=next(u for u in accounts if u['key']=='viewer');ok(viewer.request.post('/api/workspace/login',data={'email':v['email'],'password':v['password']}));assert viewer.request.get('/api/workspace/supervisors').status==403;viewer.close()
  assert c.request.put('/api/workspace/supervisors',headers={'Origin':'https://invalid.test'},data={}).status==403
  page=c.new_page();page.goto('/workspace/index.html');snapshot=version(get())
  outcomes=page.evaluate("""async ({a,b,s1,s2,expected})=>Promise.all([{userId:a,storeIds:[s1,s2]},{userId:b,storeIds:[s2]}].map(x=>fetch('/api/workspace/supervisors',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...x,roleType:'supervisor',primaryAssignments:[],expected})}).then(r=>r.status)))""",{'a':a,'b':b,'s1':s1,'s2':s2,'expected':snapshot});assert sorted(outcomes)==[200,409],outcomes
 for u in [a,b,third,m]:clear(u)
 ok(put(a,[],role='store_manager'));ok(put(a,[s1]));ok(put(m,[s1]));print('PASS fixture prepared for UI' if '--ui-only' in __import__('sys').argv else 'PASS API explicit primary/new-primary/third supervisor/successor required/manager separation/invalid rollback/scope permissions/origin/concurrency/role isolation',flush=True)
 page=c.new_page();page.goto('/workspace/index.html')
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.reload();page.locator('.sidebar').hover();page.locator('.nav-search input').fill('經理/督導管理');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='經理/督導管理 新版',exact=True).click()
 main=page.locator('[role=tabpanel]:visible');expect(main.get_by_role('heading',name='管理門市總覽')).to_be_visible();expect(main.get_by_role('region',name='人員搜尋結果')).to_have_count(0)
 def open_person(code,key):
  main.get_by_label('搜尋經理／督導',exact=True).fill(code);results=main.get_by_role('region',name='人員搜尋結果');expect(results.locator('.person-option')).to_have_count(1);results.get_by_role('button').first.click();dialog=page.get_by_role('dialog',name='選擇管理門市 · Vue 督導驗證 '+key,exact=True);expect(dialog).to_be_visible();dialog.get_by_label('搜尋門市').fill('Vue 督導驗證');expect(dialog.locator('input[type=checkbox]')).to_have_count(2);return dialog
 dialog=open_person('VWS-b','b');dialog.locator('input[type=checkbox]').first.click();choice=page.get_by_role('dialog',name='誰是主責督導？',exact=True);expect(choice).to_be_visible();expect(choice.get_by_role('button',name='確認主責',exact=True)).to_be_disabled();choice.get_by_role('button',name='取消',exact=True).click();expect(dialog.locator('input[type=checkbox]').first).not_to_be_checked()
 dialog.locator('input[type=checkbox]').first.click();choice.get_by_label('Vue 督導驗證 b · VWS-b',exact=True).check();page.screenshot(path='.tmp-check/supervisor-primary-choice-desktop.png');choice.get_by_role('button',name='確認主責',exact=True).click();assert row(a,s1)['is_primary'];assert not any(r['user_id']==b for r in get()['assignments']);expect(dialog.get_by_text('主責督導',exact=True)).to_be_visible();dialog.get_by_role('button',name='儲存指派',exact=True).click();expect(dialog.get_by_text('管理門市指派已儲存',exact=True)).to_be_visible();assert row(b,s1)['is_primary'];assert not row(a,s1)['is_primary']
 # Change primary only, preserve draft on concurrent update, then rebase.
 dialog.get_by_role('button',name='變更主責',exact=True).click();choice.get_by_label('Vue 督導驗證 a · VWS-a',exact=True).check();choice.get_by_role('button',name='確認主責',exact=True).click();ok(put(m,[s1,s2]));dialog.get_by_role('button',name='儲存指派',exact=True).click();expect(dialog.get_by_role('alert')).to_contain_text('其他人更新');assert row(b,s1)['is_primary'];dialog.get_by_role('button',name='重新載入（保留選擇）').click();expect(dialog.get_by_role('button',name='儲存指派',exact=True)).to_be_enabled();dialog.get_by_role('button',name='儲存指派',exact=True).click();expect(dialog.get_by_text('管理門市指派已儲存',exact=True)).to_be_visible();assert row(a,s1)['is_primary'];dialog.get_by_role('button',name='關閉',exact=True).click()
 main.get_by_label('搜尋已指派門市').fill('Vue 督導驗證');expect(main.locator('tbody tr')).to_have_count(2);page.screenshot(path='.tmp-check/supervisor-overview-desktop.png');page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/supervisor-overview-mobile.png');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.set_viewport_size({'width':1440,'height':1000})
 dialog=open_person('VWS-a','a');dialog.locator('input[type=checkbox]').first.click();succ=page.get_by_role('dialog',name='指定接任主責督導',exact=True);expect(succ).to_be_visible();succ.get_by_role('button',name='取消',exact=True).click();expect(dialog.locator('input[type=checkbox]').first).to_be_checked();dialog.locator('input[type=checkbox]').first.click();succ.get_by_label('Vue 督導驗證 b · VWS-b',exact=True).check();succ.get_by_role('button',name='確認主責',exact=True).click();dialog.get_by_role('button',name='儲存指派',exact=True).click();page.get_by_role('button',name='確認儲存指派',exact=True).click();expect(dialog.get_by_text('管理門市指派已儲存',exact=True)).to_be_visible();assert row(b,s1)['is_primary'];dialog.get_by_role('button',name='關閉',exact=True).click()
 dialog=open_person('VWS-b','b');dialog.locator('input[type=checkbox]').nth(1).check();page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/supervisor-edit-mobile.png');page.keyboard.press('Escape');expect(page.get_by_role('dialog',name='放棄尚未儲存的指派？')).to_be_visible();page.get_by_role('button',name='繼續編輯',exact=True).click();expect(dialog.locator('input[type=checkbox]').nth(1)).to_be_checked();dialog.get_by_role('button',name='關閉',exact=True).click();page.get_by_role('button',name='放棄修改並關閉').click();expect(dialog).to_have_count(0);assert not any(r['user_id']==b and r['store_id']==s2 for r in get()['assignments'])
 for u in [a,b,third,m]:clear(u)
 after=[r for r in get()['assignments'] if r['user_id'] not in [u['id'] for u in f['users']]];assert after==original;assert not errors,errors
 print('PASS real DEV popup choice/cancel/deferred writes/primary-only update/conflict rebase/explicit successor/draft discard/single-page overview/mobile/unrelated assignments unchanged',flush=True);browser.close()
