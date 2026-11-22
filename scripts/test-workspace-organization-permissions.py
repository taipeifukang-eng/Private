import json
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';f=json.loads(Path('.tmp-check/organization-permissions-fixture.json').read_text(encoding='utf-8'));unit=f['units'][0];person=f['actors'][0]
with sync_playwright() as p:
 clients={}
 for actor in f['actors']:
  c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});assert c.post('/api/workspace/login',data={'email':actor['email'],'password':actor['password']}).ok;clients[actor['key']]=c
  catalog=c.get('/api/workspace/organization');assert catalog.ok;caps=catalog.json()['capabilities']
  expected={'view':set(),'members':{'members'},'managers':{'managers'},'edit':{'update','hierarchy'},'create':{'create'}}[actor['key']]
  assert {k for k,v in caps.items() if v}==expected,(actor['key'],caps)
  assert c.get('/api/workspace/organization-people').status==(200 if actor['key'] in ['members','managers'] else 403)
  for operation in {'create','update','hierarchy','members','managers'}-expected:
   assert c.post('/api/workspace/organization',data={'operation':operation,'data':{}}).status==403,(actor['key'],operation)
 print('PASS five independent roles: catalog access, exact capabilities, people access and every forbidden write',flush=True)
 def save(client,operation,data,expected=None,request=None):
  version=expected or client.get('/api/workspace/organization').json()['version']
  return client.post('/api/workspace/organization',data={'operation':operation,'data':data,'expected':version,'requestId':request or str(uuid4())})
 c=clients['members'];before=c.get('/api/workspace/organization').json()['version'];request=str(uuid4());data={'id':unit['id'],'user_ids':[person['id']]}
 first=save(c,'members',data,before,request);assert first.ok,first.status;assert save(c,'members',data,before,request).json()==first.json()
 assert save(c,'members',{'id':f['units'][1]['id'],'user_ids':[person['id']]}).status==409
 assert save(c,'members',{'id':unit['id'],'user_ids':[]},before).status==409
 current=next(u for u in c.get('/api/workspace/organization').json()['units'] if u['id']==unit['id']);assert [m['user_id'] for m in current['members']]==[person['id']]
 people=c.get('/api/workspace/organization-people?q='+person['email']).json()['people'];assert next(x for x in people if x['id']==person['id'])['department']==unit['name']
 assert save(c,'members',{'id':unit['id'],'user_ids':[]}).ok
 assert next(x for x in c.get('/api/workspace/organization-people?q='+person['email']).json()['people'] if x['id']==person['id'])['department'] is None
 print('PASS member save/readback, profile department synchronization/removal, idempotent retry, cross-unit primary conflict and stale version rejection',flush=True)
 # Browser uses a member-only account and the same isolated person.
 actor=next(a for a in f['actors'] if a['key']=='members');browser=p.chromium.launch();context=browser.new_context(base_url=B,viewport={'width':1440,'height':1000},extra_http_headers={'Origin':B});assert context.request.post('/api/workspace/login',data={'email':actor['email'],'password':actor['password']}).ok
 page=context.new_page();page.goto('/workspace/index.html');page.locator('.sidebar').hover();page.locator('.nav-search input').fill('公司組織');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='公司組織 新版',exact=True).click();panel=page.locator('[role=tabpanel]:visible');panel.get_by_label('搜尋單位或人員').fill(unit['code']);panel.locator('.unit-button').click();expect(panel.get_by_role('button',name='新增組織單位',exact=True)).to_have_count(0);expect(panel.get_by_role('button',name='設定主管',exact=True)).to_have_count(0);panel.get_by_role('button',name='設定成員',exact=True).click();panel=page.locator('[role=tabpanel]:visible');panel.get_by_label('搜尋人員').fill(person['email']);panel.locator('.people-list input').check();panel.get_by_role('button',name='儲存組織資料',exact=True).click();page.get_by_role('dialog').get_by_role('button',name='確認儲存',exact=True).click();expect(panel.locator('.notice[role=status]')).to_contain_text('已儲存',timeout=30000)
 assert len(next(u for u in c.get('/api/workspace/organization').json()['units'] if u['id']==unit['id'])['members'])==1
 print('PASS member-only browser selection/confirmation/save and hidden unauthorized controls');browser.close()
