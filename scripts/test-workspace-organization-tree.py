"""Synthetic hierarchy interaction test; does not write business data."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

B='http://localhost:3002'
a=next(a for a in json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts'] if a['key']=='navigation')
ids=['00000000-0000-4000-8000-'+str(i).zfill(12) for i in range(1,5)]
units=[dict(id=ids[i],code='TEST'+str(i),name=name,type='company' if i==0 else 'department',parent_id=parent,status='active',sort_order=i,members=[],managers=[]) for i,(name,parent) in enumerate([('測試公司',None),('測試部門 B',ids[0]),('測試小組 C',ids[1]),('測試部門 D',ids[0])])]
saved=[]
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1500,'height':1400},extra_http_headers={'Origin':B})
 assert c.request.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok
 page=c.new_page()
 def route(r):
  if r.request.method=='POST':
   body=r.request.post_data_json;saved.append(body)
   for update in body['data']['updates']:
    next(u for u in units if u['id']==update['id']).update(update)
   r.fulfill(json={'id':None,'version':'b'*32});return
  r.fulfill(json={'units':units,'version':'a'*32,'capabilities':dict(create=True,update=True,hierarchy=True,members=True,managers=True)})
 page.route('**/api/workspace/organization',route)
 page.goto('/workspace/index.html');page.locator('.sidebar').hover();page.locator('.nav-search input').fill('公司組織');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='公司組織 新版',exact=True).click()
 panel=page.locator('[role=tabpanel]:visible');expect(panel.locator('.tree-row')).to_have_count(4)
 panel.get_by_role('button',name='收合至第一層',exact=True).click();expect(panel.locator('.tree-row')).to_have_count(1)
 panel.get_by_role('button',name='展開至第二層',exact=True).click();expect(panel.locator('.tree-row')).to_have_count(3)
 panel.get_by_role('button',name='全部展開',exact=True).click();expect(panel.locator('.tree-row')).to_have_count(4)
 panel.get_by_role('button',name='調整層級',exact=True).click()
 row=lambda name:panel.locator('.tree-row').filter(has=page.locator('.unit-button strong',has_text=name))
 panel.get_by_role('button',name='拖曳移動 測試部門 B',exact=True).drag_to(row('測試小組 C').locator('.unit-button'))
 expect(panel.get_by_role('alert')).to_contain_text('不可移到自己')
 expect(panel.get_by_role('button',name='儲存層級',exact=True)).to_be_disabled()
 panel.get_by_role('button',name='拖曳移動 測試小組 C',exact=True).drag_to(row('測試部門 D').locator('.unit-button'))
 expect(row('測試小組 C').locator('select')).to_have_value(ids[3])
 panel.get_by_role('button',name='儲存層級',exact=True).click();expect(panel.get_by_role('status')).to_contain_text('已儲存')
 assert len(saved)==1 and saved[0]['data']['updates']==[{'id':ids[2],'parent_id':ids[3],'sort_order':2}]
 panel.get_by_role('button',name='調整層級',exact=True).click();panel.get_by_role('button',name='拖曳移動 測試小組 C',exact=True).drag_to(panel.locator('.root-drop'));expect(row('測試小組 C').locator('select option:checked')).to_have_text('無上層');panel.get_by_role('button',name='取消調整',exact=True).click()
 panel.get_by_label('搜尋單位或人員').fill('測試小組 C');expect(panel.locator('.tree-row')).to_have_count(3)
 page.screenshot(path='.tmp-check/organization-tree-desktop.png')
 print('PASS synthetic multilevel tree: first/two/all levels, drag cycle rejection, drag save payload, root move/discard and search ancestor context')
 browser.close()
