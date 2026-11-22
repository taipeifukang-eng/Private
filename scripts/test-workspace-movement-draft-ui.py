import json
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts'];expect.set_options(timeout=30000)
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1440,'height':1000});a=next(a for a in accounts if a['key']=='navigation');assert c.request.post('/api/workspace/login',data={'email':a['email'],'password':a['password']},headers={'Origin':B}).ok
 catalog=c.request.get('/api/workspace/movement-validation').json();store=catalog['stores'][0]['id'];code='VDU'+uuid4().hex[:12].upper();before=c.request.get('/api/workspace/employees').json()['employees']
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html');page.locator('.sidebar').hover();page.locator('.nav-search input').fill('批次異動驗證');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='批次異動驗證 新版',exact=True).click();panel=page.locator('[role=tabpanel]:visible')
 panel.get_by_label('員編',exact=True).fill(code);panel.get_by_label('姓名',exact=True).fill('畫面草稿測試');panel.get_by_label('任職門市／組織',exact=True).select_option(store);panel.get_by_label('生效日期',exact=True).fill('2026-08-01');panel.get_by_label('生日',exact=True).fill('2000-02-29');panel.get_by_role('button',name='驗證 1 筆異動',exact=True).click();expect(panel.get_by_role('status')).to_contain_text('1 筆查核通過，尚未儲存')
 panel.get_by_role('button',name='新增一列',exact=True).click();panel.get_by_label('異動類型',exact=True).select_option('store_transfer');expect(panel.get_by_label('原任職門市',exact=True)).to_be_visible();expect(panel.get_by_label('生日',exact=True)).to_have_count(0);panel.get_by_role('button',name='驗證 2 筆異動',exact=True).click();expect(panel.get_by_role('alert')).to_contain_text('第 2 列');panel.get_by_role('button',name='移除此列',exact=True).click();page.get_by_role('dialog').get_by_role('button',name='保留',exact=True).click();expect(panel.get_by_role('heading',name='第 2 列',exact=True)).to_be_visible()
 panel.get_by_role('navigation',name='異動草稿列',exact=True).get_by_role('button').first.click();expect(panel.get_by_label('員編',exact=True)).to_have_value(code);page.get_by_role('button',name='關閉 批次異動驗證',exact=True).click();expect(page.get_by_role('dialog')).to_contain_text('目前是驗證草稿');page.get_by_role('dialog').get_by_role('button',name='繼續編輯',exact=True).click();expect(panel.get_by_label('員編',exact=True)).to_have_value(code)
 # Failed import after explicit replace confirmation must preserve current rows.
 panel.locator('input[type=file]').set_input_files({'name':'bad.xlsx','mimeType':'application/octet-stream','buffer':b'not an excel workbook'});expect(page.get_by_role('dialog')).to_contain_text('取代目前異動草稿');page.get_by_role('dialog').get_by_role('button',name='載入新檔案',exact=True).click();expect(panel.get_by_role('button',name='驗證 2 筆異動',exact=True)).to_be_enabled();expect(panel.locator('p[role=alert]')).to_be_visible();expect(panel.get_by_label('員編',exact=True)).to_have_value(code)
 panel.get_by_role('navigation',name='異動草稿列',exact=True).get_by_role('button').nth(1).click();panel.get_by_role('button',name='移除此列',exact=True).click();page.get_by_role('dialog').get_by_role('button',name='確認移除',exact=True).click();panel.get_by_role('button',name='驗證 1 筆異動',exact=True).click();expect(panel.get_by_role('status')).to_contain_text('1 筆查核通過，尚未儲存')
 panel.get_by_label('備註',exact=True).fill('第一行\n第二行')
 with page.expect_download() as info:panel.get_by_role('button',name='下載範本',exact=True).click()
 template=info.value
 with ZipFile(template.path()) as z:
  root=ET.fromstring(z.read('xl/worksheets/sheet1.xml'));assert len(root.findall('{*}sheetData/{*}row'))==1
 template.delete()
 with page.expect_download() as info:panel.get_by_role('button',name='匯出草稿',exact=True).click()
 draft=info.value;content=Path(draft.path()).read_bytes();draft.delete()
 panel.get_by_label('姓名',exact=True).fill('暫時改名');panel.locator('input[type=file]').set_input_files({'name':'draft.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':content});page.get_by_role('dialog').get_by_role('button',name='載入新檔案',exact=True).click();expect(panel.get_by_role('status')).to_contain_text('1 筆查核通過，尚未儲存');expect(panel.get_by_label('姓名',exact=True)).to_have_value('畫面草稿測試');expect(panel.get_by_label('備註',exact=True)).to_have_value('第一行\n第二行');expect(panel.get_by_role('heading',name='第 1 列 · Excel 第 2 列',exact=True)).to_be_visible()
 page.screenshot(path='.tmp-check/movement-draft-desktop.png');page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.tmp-check/movement-draft-mobile.png')
 assert c.request.get('/api/workspace/employees').json()['employees']==before;assert c.request.get('/api/workspace/employees?history='+code).json()['history']==[];assert not errors,errors
 print('PASS movement draft UI: real validation, row switching, type-specific fields, errors, removal cancel, dirty close, failed import preservation, mobile and no writes');browser.close()
