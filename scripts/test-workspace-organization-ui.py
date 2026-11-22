import json
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright, expect

B='http://localhost:3002'
a=next(a for a in json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts'] if a['key']=='navigation')
expect.set_options(timeout=30000)
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1440,'height':1000},extra_http_headers={'Origin':B})
 assert c.request.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('/workspace/index.html');page.locator('.sidebar').hover();page.locator('.nav-search input').fill('公司組織');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='公司組織 新版',exact=True).click()
 panel=page.locator('[role=tabpanel]:visible');panel.get_by_role('button',name='新增組織單位',exact=True).click()
 panel=page.locator('[role=tabpanel]:visible');code='VORG-UI-'+uuid4().hex[:8].upper()
 panel.get_by_label('單位代碼',exact=True).fill(code);panel.get_by_label('單位名稱',exact=True).fill('Vue 組織介面驗證');panel.get_by_label('類型',exact=True).select_option('company')
 page.get_by_role('tab',name='公司組織',exact=True).click();page.locator('[role=tab][title="新增組織單位"]').click();expect(panel.get_by_label('單位代碼',exact=True)).to_have_value(code)
 with page.expect_response(lambda r:'/api/workspace/organization' in r.url and r.request.method=='POST') as response:
  panel.get_by_role('button',name='儲存組織資料',exact=True).click()
 r=response.value;assert r.ok,r.status;unit_id=r.json()['id'];Path('.tmp-check/organization-ui-fixture.json').write_text(json.dumps({'id':unit_id,'code':code}),encoding='utf-8')
 expect(panel.get_by_role('status')).to_contain_text('已儲存')
 page.get_by_role('tab',name='公司組織',exact=True).click();panel=page.locator('[role=tabpanel]:visible');panel.get_by_role('button',name='重新載入',exact=True).click();panel.get_by_label('搜尋單位或人員').fill(code);expect(panel.locator('.unit-button')).to_have_count(1);panel.locator('.unit-button').click();expect(panel.get_by_role('complementary')).to_contain_text('Vue 組織介面驗證')
 panel.get_by_role('button',name='設定主管',exact=True).click();panel=page.locator('[role=tabpanel]:visible');expect(panel.get_by_role('heading',name='設定主管',exact=True)).to_be_visible();expect(panel.locator('.people-list .person').first).to_be_visible();panel.locator('.people-list input').first.check();expect(panel.locator('.manager-row')).to_have_count(1)
 panel.get_by_role('button',name='儲存組織資料',exact=True).click();page.get_by_role('dialog').get_by_role('button',name='確認儲存',exact=True).click();expect(panel.get_by_role('status')).to_contain_text('已儲存');catalog=c.request.get('/api/workspace/organization').json();assert len(next(u for u in catalog['units'] if u['id']==unit_id)['managers'])==1;panel.locator('.manager-row select').select_option('deputy_manager')
 page.get_by_role('button',name='關閉 主管 · Vue 組織介面驗證',exact=True).click();expect(page.get_by_role('dialog')).to_be_visible();page.get_by_role('button',name='放棄修改並關閉',exact=True).click()
 page.get_by_role('tab',name='公司組織',exact=True).click();panel=page.locator('[role=tabpanel]:visible');panel.get_by_role('button',name='重新載入',exact=True).click();expect(panel.get_by_role('button',name='調整層級',exact=True)).to_be_enabled();panel.get_by_role('button',name='調整層級',exact=True).click();panel.locator('.hierarchy-fields input').fill('5');expect(panel.get_by_role('button',name='儲存層級',exact=True)).to_be_enabled();panel.get_by_role('button',name='儲存層級',exact=True).click();expect(panel.get_by_role('status')).to_contain_text('層級已儲存')
 page.screenshot(path='.tmp-check/organization-desktop.png');page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.tmp-check/organization-mobile.png');assert not errors,errors
 print('PASS native organization navigation, create/save, independent draft, tree search/details, manager assignment persisted/read back and unsaved role close discard, hierarchy save and mobile width')
 browser.close()
