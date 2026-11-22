import json,uuid,copy
from pathlib import Path
from playwright.sync_api import sync_playwright
B='http://localhost:3002';F=json.loads(Path('.tmp-check/task-fixture.json').read_text(encoding='utf-8'));A=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts'];R=[]
def passed(s):R.append(s);print('PASS '+s,flush=True)
with sync_playwright() as p:
 c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});a=next(a for a in A if a['key']=='navigation');assert c.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok
 def get():
  r=c.get('/api/workspace/task-detail?id='+F['id']);assert r.ok,r.text();return r.json()
 d=get();assert len(d['steps'])==2 and len(d['sections'])==2;assert c.get('/api/workspace/task-detail?id='+F['foreign']).status==404
 rows=c.get('/api/workspace/tasks').json()['records'];assert any(r['id']==F['id'] for r in rows) and not any(r['id']==F['foreign'] for r in rows);passed('collaborator-only list and detail, own section write scope')
 def body(changes,version=None):return {'id':F['id'],'version':get()['workspace_version'] if version is None else version,'writeId':str(uuid.uuid4()),'changes':changes}
 bad=body([{'stepId':'secret','checked':True}]);assert c.post('/api/workspace/task-detail',data=bad).status==400
 first=body([{'stepId':'a','checked':True,'note':'主項備註'}]);r=c.post('/api/workspace/task-detail',data=first);assert r.ok,r.text();d=get();assert all(i in d['state'] for i in ['a','a1','a2']) and d['state']['a']=='主項備註';passed('parent completes children and note persists; cross-section write rejected')
 count=len(d['logs']);assert c.post('/api/workspace/task-detail',data=first).ok;assert len(get()['logs'])==count;changed=copy.deepcopy(first);changed['changes'][0]['note']='changed';assert c.post('/api/workspace/task-detail',data=changed).status==409;passed('lost-response retry idempotent; changed replay rejected')
 stale=body([{'stepId':'b','checked':True}],first['version']);assert c.post('/api/workspace/task-detail',data=stale).status==409;assert 'b' not in get()['state'];passed('stale page cannot overwrite newer task')
 r=c.post('/api/workspace/task-detail',data=body([{'stepId':'a1','checked':False}]));assert r.ok,r.text();d=get();assert 'a' not in d['state'] and 'a1' not in d['state'] and 'a2' in d['state'];passed('unchecking child clears parent and its note')
 r=c.post('/api/workspace/task-detail',data=body([{'stepId':'a1','checked':True},{'stepId':'b','checked':True}]));assert r.ok,r.text();d=get();assert d['done']==4 and d['status']=='in_progress';passed('own section complete does not falsely complete other section')
 v=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});va=next(a for a in A if a['key']=='viewer');assert v.post('/api/workspace/login',data={'email':va['email'],'password':va['password']}).ok;assert v.get('/api/workspace/tasks').status==403;assert v.post('/api/workspace/task-detail',data=body([{'stepId':'b','checked':False}])).status==403;passed('task permission enforced on read and write')
 browser=p.chromium.launch();ctx=browser.new_context(storage_state=c.storage_state(),viewport={'width':1366,'height':900});page=ctx.new_page();page.goto(B+'/workspace/index.html');page.get_by_role('button',name='我的任務 新版',exact=True).click();row=page.get_by_role('row').filter(has_text=F['title']);row.get_by_role('button',name='開啟任務').click();page.get_by_role('heading',name=F['title'],exact=True).wait_for();page.get_by_label('Vue 單項測試備註').fill('頁籤草稿驗證');page.get_by_role('button',name='我的任務 新版',exact=True).click();page.get_by_role('tab',name=F['title']).click();assert page.get_by_label('Vue 單項測試備註').input_value()=='頁籤草稿驗證';page.get_by_role('button',name='儲存進度',exact=True).click();page.get_by_text('任務進度已儲存',exact=True).wait_for();assert get()['state']['b']=='頁籤草稿驗證';passed('native navigation, independent tab draft and actual save')
 page.get_by_role('button',name='查看甘特排程').click();page.get_by_role('heading',name='任務排程',exact=True).wait_for();assert page.get_by_text('另一區段項目',exact=False).is_visible();page.screenshot(path='.tmp-check/tasks-desktop.png',full_page=True);page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/tasks-mobile.png',full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');passed('read-only all-section schedule and mobile no overflow');browser.close()
Path('.tmp-check/task-results.json').write_text(json.dumps(R,ensure_ascii=False,indent=2),encoding='utf-8')

