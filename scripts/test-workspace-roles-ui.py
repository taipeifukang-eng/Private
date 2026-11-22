import os,re
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';expect.set_options(timeout=60000)
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(base_url=B,viewport={'width':1600,'height':1000});c.set_default_timeout(60000)
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 data=c.request.get('/api/workspace/roles').json();target=data['roles'][0]
 session=c.request.get('/api/workspace/session').json();group=next(g for g in session['navigation'] if any(i.get('kind')=='roles' for i in g['items']))
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html');page.get_by_role('button',name='選單',exact=True).click();page.locator('.catalog-item[title="角色權限管理"]').click();expect(page.get_by_role('heading',name='角色權限管理',exact=True)).to_be_visible()
 page.get_by_label('搜尋角色').fill(target['code']);page.locator('.roles-page tbody tr').filter(has_text=target['name']).first.get_by_role('button',name='查看／設定').click();dialog=page.get_by_role('dialog',name=target['name']+' · 角色設定');expect(dialog).to_be_visible();dialog.get_by_role('button',name='權限設定',exact=True).click();expect(dialog.get_by_label('搜尋權限')).to_be_visible();dialog.get_by_label('搜尋權限').fill('user.user');expect(dialog.locator('.permission').first).to_be_visible();page.screenshot(path='.tmp-check/roles-permissions-desktop.png')
 writes=[]
 def intercept(route):
  if route.request.method in ['POST','PATCH','DELETE']:
   writes.append({'method':route.request.method,'data':route.request.post_data_json if route.request.post_data else None,'url':route.request.url})
   if route.request.url.endswith('/permissions') and len([w for w in writes if w['url'].endswith('/permissions')])==1:route.fulfill(status=409,json={'error':'這個角色的權限已被其他管理者更新，請重新載入後再調整'})
   else:route.fulfill(json={'success':True,'message':'測試儲存成功'})
  else:route.continue_()
 page.route('**/api/workspace/roles**',intercept)
 checkbox=dialog.locator('.permission input').first;checkbox.click()
 if page.get_by_role('dialog',name='確認授予權限').count():page.get_by_role('button',name='確認授予',exact=True).click()
 dialog.get_by_role('button',name='檢視變更並儲存').click();page.get_by_role('button',name='確認儲存權限').click();expect(dialog.get_by_role('alert')).to_contain_text('其他管理者');expect(dialog.get_by_role('button',name='檢視變更並儲存')).to_be_enabled();assert 'expectedPermissionIds' in writes[-1]['data']
 dialog.get_by_role('button',name='關閉',exact=True).click();expect(page.get_by_role('dialog',name='放棄未儲存變更')).to_be_visible();page.get_by_role('button',name='繼續編輯').click();dialog.get_by_role('button',name='檢視變更並儲存').click();page.get_by_role('button',name='確認儲存權限').click();expect(dialog.get_by_role('button',name='檢視變更並儲存')).to_be_disabled()
 dialog.get_by_role('button',name='使用者指派',exact=True).click();expect(dialog.get_by_label('批次指派員工編號')).to_be_visible();dialog.get_by_label('批次指派員工編號').fill('FAKE001, FAKE002');dialog.get_by_role('button',name='指派使用者',exact=True).click();expect(dialog.get_by_label('批次指派員工編號')).to_have_value('');assert writes[-1]['data']['employee_codes']==['FAKE001','FAKE002'];dialog.get_by_role('button',name='關閉',exact=True).click();expect(dialog).to_have_count(0)
 page.get_by_label('搜尋角色').fill('');page.screenshot(path='.tmp-check/roles-desktop.png');page.get_by_role('button',name='新增角色',exact=True).click();new=page.get_by_role('dialog',name='新增角色',exact=True);new.get_by_label('角色名稱').fill('僅介面測試');new.get_by_label('角色代碼').fill('ui_test');new.get_by_role('button',name='儲存角色').click();expect(new).to_have_count(0)
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/roles-mobile.png');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors
 print('PASS native role navigation, list/search, real permission read, mocked conflict/retry keeps draft, dirty close confirmation, batch assignment payload, creation dialog, desktop/mobile no overflow/runtime errors',flush=True)
 b.close()
