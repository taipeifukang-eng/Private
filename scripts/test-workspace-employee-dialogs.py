"""DEV read-only UI checks; simulated PUT responses avoid changing copied staff."""
import os
from playwright.sync_api import sync_playwright, expect
B='http://localhost:3002'
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(base_url=B,viewport={'width':1500,'height':1000})
 c.set_default_timeout(60000)
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('/workspace/index.html');page.locator('.module-trigger[title="組織與門市"]').hover();page.locator('.nav-item[title="員工管理"]').click()
 page.get_by_label('搜尋員工',exact=True).fill('FK0008')
 page.get_by_role('button',name='異動歷程',exact=True).click()
 history=page.get_by_role('dialog',name='員工異動歷程',exact=True)
 expect(history).to_be_visible();expect(history.get_by_label('紀錄類型')).to_be_visible()
 history.get_by_role('button',name='關閉',exact=True).click()
 expect(page.get_by_label('搜尋員工',exact=True)).to_have_value('FK0008')
 assert page.locator('.tab-strip [role=tab]').count()<=1
 page.get_by_role('button',name='編輯',exact=True).click()
 edit=page.get_by_role('dialog',name='編輯員工',exact=True)
 name=edit.get_by_label('姓名',exact=True);expect(name).to_be_enabled()
 expect(edit.get_by_label('員編',exact=True)).to_have_attribute('readonly','')
 original=name.input_value();name.fill(original+'測')
 expect(edit.get_by_text('姓名與有填寫的職位將同步更新',exact=False)).to_be_visible()
 page.screenshot(path='.tmp-check/employee-edit-desktop.png')
 state={'success':False}
 def save(route):
  if route.request.method=='PUT':
   route.fulfill(status=200 if state['success'] else 409,json={'success':True} if state['success'] else {'error':'員工資料已變更，草稿已保留。'})
  else:route.continue_()
 page.route('**/api/workspace/employees/edit',save)
 edit.get_by_role('button',name='儲存變更',exact=True).click()
 expect(edit.get_by_role('alert')).to_contain_text('草稿已保留')
 expect(name).to_have_value(original+'測')
 edit.get_by_role('button',name='取消',exact=True).click()
 discard=page.get_by_role('dialog',name='放棄尚未儲存的員工資料？',exact=True)
 expect(discard).to_be_visible();discard.get_by_role('button',name='繼續編輯',exact=True).click()
 page.set_viewport_size({'width':390,'height':844});edit.screenshot(path='.tmp-check/employee-edit-mobile.png')
 state['success']=True;edit.get_by_role('button',name='儲存變更',exact=True).click()
 expect(edit).to_have_count(0);expect(page.get_by_label('搜尋員工',exact=True)).to_have_value('FK0008')
 page.unroute_all(behavior='wait')
 # Direct invalid update must fail before any database mutation.
 detail=c.request.get('/api/workspace/employees/edit?employee=FK0008').json()
 assert 'expected' in detail
 assert c.request.put('/api/workspace/employees/edit',data={'data':{'employee_code':'FK0008','employee_name':''}},headers={'Origin':B}).status==400
 assert not errors,errors
 print('History dialog, filter preservation, edit form, conflict draft, discard, simulated save, desktop/mobile PASS; no persistent staff writes')
 b.close()
