import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';fixture=json.loads(Path('.tmp-check/employee-create-api-fixture.json').read_text());a=next(a for a in json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts'] if a['key']=='navigation');expect.set_options(timeout=30000)
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1440,'height':1000},extra_http_headers={'Origin':B});assert c.request.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html');page.locator('.sidebar').hover();page.locator('.nav-search input').fill('新增員工');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='新增員工 新版',exact=True).click();panel=page.locator('[role=tabpanel]:visible')
 panel.get_by_label('員編',exact=True).fill(fixture['code'].lower());panel.get_by_label('姓名',exact=True).fill('Vue 員工新增畫面驗證');panel.get_by_label('當前職位',exact=True).select_option(label='專員');panel.get_by_label('生日',exact=True).fill('1990-02-03');panel.get_by_label('到職日',exact=True).fill('2026-10-01')
 page.get_by_role('button',name='關閉 新增員工',exact=True).click();expect(page.get_by_role('dialog')).to_contain_text('確認提交');page.get_by_role('dialog').get_by_role('button',name='繼續編輯',exact=True).click();expect(panel.get_by_label('姓名',exact=True)).to_have_value('Vue 員工新增畫面驗證')
 panel.get_by_role('button',name='核對並新增',exact=True).click();expect(page.get_by_role('dialog')).to_contain_text(fixture['code']);page.get_by_role('dialog').get_by_role('button',name='返回修改',exact=True).click()
 page.screenshot(path='.tmp-check/employee-create-desktop.png');page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.tmp-check/employee-create-mobile.png')
 panel.get_by_role('button',name='核對並新增',exact=True).click();page.get_by_role('dialog').get_by_role('button',name='確認新增',exact=True).click();expect(panel.locator('.notice[role=status]')).to_contain_text('已新增 '+fixture['code']);expect(panel.get_by_label('姓名',exact=True)).to_be_disabled()
 employees=c.request.get('/api/workspace/employees').json()['employees'];matches=[e for e in employees if e['employee_code']==fixture['code']];assert len(matches)==1 and matches[0]['birthday']=='1990-02-03' and matches[0]['current_position']=='專員'
 page.get_by_role('button',name='關閉 員工已新增 · Vue 員工新增畫面驗證',exact=True).click();expect(page.get_by_role('dialog')).to_have_count(0);assert not errors,errors
 print('PASS employee create UI: independent draft, dirty close, confirmation/cancel, mobile, real create/readback and clean close');browser.close()
