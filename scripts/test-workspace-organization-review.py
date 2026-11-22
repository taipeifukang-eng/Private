"""Exercise all three organization conflict review modes using explicit API doubles."""
import json,copy
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';account=next(a for a in json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts'] if a['key']=='navigation');expect.set_options(timeout=15000)
people=[{'id':'00000000-0000-4000-8000-'+str(i).zfill(12),'full_name':'測試人員 '+str(i),'email':'review'+str(i)+'@example.invalid','employee_code':'REVIEW'+str(i),'job_title':'測試'} for i in range(1,4)]
def member(p):return {'id':p['id'],'user_id':p['id'],'user':p,'is_primary':True}
def manager(p,primary=True):return dict(member(p),manager_role='manager',is_primary=primary)
with sync_playwright() as p:
 browser=p.chromium.launch();context=browser.new_context(base_url=B,viewport={'width':1440,'height':1000},extra_http_headers={'Origin':B});assert context.request.post('/api/workspace/login',data={'email':account['email'],'password':account['password']}).ok
 for mode in ['basic','members','managers']:
  unit={'id':'00000000-0000-4000-9000-000000000001','code':'TEST-REVIEW','name':'核對測試部門','short_name':'','type':'department','parent_id':None,'status':'active','description':'原說明','sort_order':0,'members':[member(people[0])],'managers':[manager(people[0])]}
  state={'stale':False,'writes':[]};page=context.new_page()
  def route(r):
   if r.request.method=='POST':
    if state['stale']:r.fulfill(status=409,json={'error':'組織資料已被其他操作更新，請保留草稿並重新載入核對'});return
    body=r.request.post_data_json;state['writes'].append(body);data=body['data']
    if mode=='basic':unit.update(data)
    elif mode=='members':unit['members']=[member(next(p for p in people if p['id']==i)) for i in data['user_ids']]
    else:unit['managers']=[dict(manager(next(p for p in people if p['id']==a['user_id'])),**a) for a in data['assignments']]
    r.fulfill(json={'id':unit['id'],'version':'c'*32});return
   r.fulfill(json={'units':[unit],'version':('b' if state['stale'] else 'a')*32,'capabilities':dict(create=True,update=True,hierarchy=True,members=True,managers=True)})
  page.route('**/api/workspace/organization',route);page.route('**/api/workspace/organization-people',lambda r:r.fulfill(json={'people':people}))
  page.goto('/workspace/index.html');page.locator('.sidebar').hover();page.locator('.nav-search input').fill('公司組織');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='公司組織 新版',exact=True).click();panel=page.locator('[role=tabpanel]:visible');panel.get_by_role('button',name={'basic':'編輯單位','members':'設定成員','managers':'設定主管'}[mode],exact=True).click();panel=page.locator('[role=tabpanel]:visible')
  if mode=='basic':panel.get_by_label('單位名稱',exact=True).fill('我的單位草稿');unit['description']='其他人的說明'
  else:
   panel.get_by_label('搜尋人員').fill(people[1]['email']);panel.locator('.people-list input').check()
   unit[mode]=[member(people[2]) if mode=='members' else manager(people[2])]
  state['stale']=True;panel.get_by_role('button',name='儲存組織資料',exact=True).click()
  if mode!='basic':page.get_by_role('dialog').get_by_role('button',name='確認儲存',exact=True).click()
  expect(panel.get_by_role('alert')).to_contain_text('其他操作');panel.get_by_role('button',name='重新載入（保留草稿）',exact=True).click();review=panel.get_by_role('region',name='核對最新組織資料');expect(review).to_be_visible();expect(panel.get_by_role('button',name='儲存組織資料',exact=True)).to_be_disabled()
  if mode=='basic':expect(review).to_contain_text('我的單位草稿');expect(review).to_contain_text('其他人的說明');review.get_by_role('button',name='採用目前的說明',exact=True).click()
  else:expect(review).to_contain_text('測試人員 3');expect(review).to_contain_text('測試人員 2');review.get_by_role('button',name='採用目前全部指派',exact=True).click()
  review.get_by_role('button',name='已核對，繼續編輯',exact=True).click()
  if mode!='basic':panel.locator('.people-list input').check()
  state['stale']=False;panel.get_by_role('button',name='儲存組織資料',exact=True).click()
  if mode!='basic':page.get_by_role('dialog').get_by_role('button',name='確認儲存',exact=True).click()
  expect(panel.locator('.notice[role=status]')).to_contain_text('已儲存');assert len(state['writes'])==1
  data=state['writes'][0]['data']
  if mode=='basic':assert data['name']=='我的單位草稿' and data['description']=='其他人的說明'
  elif mode=='members':assert set(data['user_ids'])=={people[1]['id'],people[2]['id']}
  else:assert {a['user_id'] for a in data['assignments']}=={people[1]['id'],people[2]['id']} and sum(a['is_primary'] for a in data['assignments'])==1
  page.close();print('PASS explicit API-double conflict review:',mode,flush=True)
 browser.close()
