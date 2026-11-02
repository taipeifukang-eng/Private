import json, uuid, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path.cwd(); DATA=json.loads((ROOT/'.tmp-check/workspace-accounts.json').read_text(encoding='utf-8')); BASE='http://localhost:5173'; RESULTS=[]
def passed(name): RESULTS.append(name); print('PASS '+name,flush=True)
def login(ctx,key):
 a=next(a for a in DATA['accounts'] if a['key']==key)
 r=ctx.request.post(BASE+'/api/workspace/login',data={'email':a['email'],'password':a['password']},headers={'Origin':BASE}); assert r.status==200, f'login {r.status}'
def panel(page): return page.locator('[role=tabpanel]:visible')
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 anon=browser.new_context(); assert anon.request.get(BASE+'/api/workspace/session').status==401; passed('unauthenticated rejected')
 editor=browser.new_context(viewport={'width':1440,'height':950});login(editor,'editor')
 viewer=browser.new_context();login(viewer,'viewer')
 denied=browser.new_context();login(denied,'denied')
 assert denied.request.get(BASE+'/api/workspace/inspections?month='+DATA['month']).status==403
 assert denied.request.get(BASE+'/api/workspace/campaigns').status==403;passed('no capability rejected on direct API')
 rs=viewer.request.get(BASE+'/api/workspace/stores?module=inspections').json()['stores']; assert len(rs)==1 and rs[0]['id']==DATA['stores'][0]['id']
 rs=viewer.request.get(BASE+'/api/workspace/inspections?month='+DATA['month']).json()['records'];assert len(rs)==1 and rs[0]['store_id']==DATA['stores'][0]['id']
 rs=viewer.request.get(BASE+'/api/workspace/inspections?month='+DATA['month']+'&store='+DATA['stores'][1]['id']).json()['records'];assert not rs;passed('store-scoped viewer cannot read other store')
 headers={'Origin':BASE}
 record=editor.request.get(BASE+'/api/workspace/campaigns?id='+DATA['campaignId']).json()['records'][0]
 payload={**record,'version':record['workspace_version']}
 assert viewer.request.put(BASE+'/api/workspace/campaigns',data=payload,headers=headers).status==403
 assert editor.request.put(BASE+'/api/workspace/campaigns',data=payload,headers={'Origin':'https://example.invalid'}).status==403;passed('read-only mutation and cross-origin request rejected')
 create={'name':'[Vue 測試] 自動驗收活動','start_date':DATA['month']+'-01','end_date':DATA['month']+'-28','campaign_type':'promotion','is_active':True,'requestId':str(uuid.uuid4())}
 first=editor.request.post(BASE+'/api/workspace/campaigns',data=create,headers=headers); second=editor.request.post(BASE+'/api/workspace/campaigns',data=create,headers=headers)
 assert first.status==201 and second.status==200 and first.json()['record']['id']==second.json()['record']['id'];passed('idempotent create retry')
 a=editor.request.put(BASE+'/api/workspace/campaigns',data=payload,headers=headers); b=editor.request.put(BASE+'/api/workspace/campaigns',data=payload,headers=headers);assert a.status==200 and b.status==409;passed('stale version rejected')
 page=editor.new_page(); errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(BASE,wait_until='networkidle');expect(page.get_by_role('heading',name='開始今天的營運作業')).to_be_visible()
 page.get_by_label('新頁預設門市').select_option(DATA['stores'][0]['id']);page.get_by_role('button',name='巡店列表',exact=True).click();expect(panel(page).locator('tbody tr')).to_have_count(1,timeout=30000);expect(panel(page).get_by_role('combobox',name='門市',exact=True)).to_have_value(DATA['stores'][0]['id'])
 tab1=page.get_by_role('tab').first.get_attribute('id');page.get_by_label('新頁預設門市').select_option(DATA['stores'][1]['id']);page.get_by_role('button',name='巡店列表',exact=True).click();expect(panel(page).locator('tbody tr')).to_have_count(1,timeout=30000);expect(panel(page).get_by_role('combobox',name='門市',exact=True)).to_have_value(DATA['stores'][1]['id']);page.locator('#'+tab1).click();expect(panel(page).get_by_role('combobox',name='門市',exact=True)).to_have_value(DATA['stores'][0]['id']);passed('independent tabs and default store isolation')
 page.screenshot(path=str(ROOT/'.tmp-check/inspections-verified.png'),full_page=True)
 page.get_by_role('button',name='活動管理',exact=True).click();expect(panel(page).locator('tbody tr')).not_to_have_count(0,timeout=30000)
 list_tab=page.get_by_role('tab',selected=True).get_attribute('id')
 panel(page).get_by_role('row').filter(has_text='[Vue 測試] 門市營運活動').get_by_role('button',name='編輯',exact=True).click();expect(panel(page).get_by_label('活動名稱',exact=False)).to_have_value('[Vue 測試] 門市營運活動',timeout=30000)
 edit_tab=page.get_by_role('tab',selected=True).get_attribute('id');panel(page).get_by_label('活動名稱',exact=False).fill('[Vue 測試] 保留草稿驗收')
 page.locator('#'+tab1).click();page.locator('#'+edit_tab).click();expect(panel(page).get_by_label('活動名稱',exact=False)).to_have_value('[Vue 測試] 保留草稿驗收');passed('draft survives tab switches')
 page.get_by_role('button',name='關閉 活動 · [Vue 測試] 保留草稿驗收',exact=True).click();expect(page.get_by_role('dialog')).to_be_visible();page.get_by_role('button',name='繼續編輯',exact=True).click();expect(panel(page).get_by_label('活動名稱',exact=False)).to_have_value('[Vue 測試] 保留草稿驗收');passed('cancel dirty close retains draft')
 # Open a second editor for same activity, then update first and attempt stale second.
 page.locator('#'+list_tab).click();panel(page).get_by_role('row').filter(has_text='[Vue 測試] 門市營運活動').get_by_role('button',name='編輯',exact=True).click();expect(panel(page).get_by_label('活動名稱',exact=False)).to_have_value('[Vue 測試] 門市營運活動',timeout=30000);edit2=page.get_by_role('tab',selected=True).get_attribute('id');panel(page).get_by_label('活動名稱',exact=False).fill('[Vue 測試] 舊版本草稿')
 page.locator('#'+edit_tab).click();panel(page).get_by_role('button',name='儲存活動',exact=True).click();expect(panel(page).get_by_role('status')).to_have_text('已儲存活動資料',timeout=30000)
 page.locator('#'+edit2).click();panel(page).get_by_role('button',name='儲存活動',exact=True).click();expect(page.get_by_role('heading',name='活動已被更新')).to_be_visible(timeout=30000);page.get_by_role('button',name='返回編輯',exact=True).click();expect(panel(page).get_by_label('活動名稱',exact=False)).to_have_value('[Vue 測試] 舊版本草稿');passed('concurrent editors show conflict and preserve losing draft')
 page.screenshot(path=str(ROOT/'.tmp-check/conflict.png'),full_page=True)
 # Close stale editor by discarding, then restore sample using current API version.
 page.get_by_role('button',name='關閉 活動 · [Vue 測試] 舊版本草稿',exact=True).click();page.get_by_role('button',name='放棄修改並關閉',exact=True).click();expect(page.locator('#'+edit2)).to_have_count(0)
 latest=editor.request.get(BASE+'/api/workspace/campaigns?id='+DATA['campaignId']).json()['records'][0];latest['name']='[Vue 測試] 門市營運活動';latest['version']=latest['workspace_version'];assert editor.request.put(BASE+'/api/workspace/campaigns',data=latest,headers=headers).status==200
 # New activity validation, close-save failure and beforeunload.
 page.get_by_role('button',name='活動管理',exact=True).click();expect(panel(page).get_by_role('button',name='新增活動')).to_be_visible();panel(page).get_by_role('button',name='新增活動').click();panel(page).get_by_label('活動名稱',exact=False).fill('[Vue 測試] 尚未填寫日期')
 page.get_by_role('button',name='關閉 活動 · [Vue 測試] 尚未填寫日期',exact=True).click();page.get_by_role('button',name='全部儲存後關閉',exact=True).click();expect(page.get_by_role('dialog')).to_contain_text('尚未儲存成功');page.get_by_role('button',name='繼續編輯',exact=True).click();expect(panel(page).get_by_label('活動名稱',exact=False)).to_have_value('[Vue 測試] 尚未填寫日期');passed('validation failure prevents close')
 seen=[]
 page.on('dialog',lambda dialog:(seen.append(dialog.type),dialog.dismiss()))
 try: page.reload(timeout=5000)
 except: pass
 assert 'beforeunload' in seen;passed('browser unload warning while dirty')
 # Mobile view with drawer and form.
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(ROOT/'.tmp-check/mobile-form.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile horizontal overflow'
 page.get_by_role('button',name='切換導覽').click();expect(page.get_by_role('button',name='巡店列表',exact=True)).to_be_visible();page.screenshot(path=str(ROOT/'.tmp-check/mobile-nav.png'),full_page=True);page.get_by_role('button',name='關閉導覽').click();passed('mobile layout and drawer')
 page.set_viewport_size({'width':1440,'height':950});page.get_by_role('button',name='切換深色模式').click();page.screenshot(path=str(ROOT/'.tmp-check/dark-form.png'),full_page=True);passed('dark theme')
 assert not errors,errors;passed('no browser runtime errors')
 browser.close()
(ROOT/'.tmp-check/workspace-test-results.json').write_text(json.dumps({'passed':RESULTS},ensure_ascii=False,indent=2),encoding='utf-8')

