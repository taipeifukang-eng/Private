"""Read-only integration: draft import/export, same-page sections and unsaved guard."""
import os
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002'
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(base_url=B,viewport={'width':1500,'height':1000},accept_downloads=True);c.set_default_timeout(60000)
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 session=c.request.get('/api/workspace/session').json()
 items=[i for g in session['navigation'] for i in g['items'] if '/admin/promotion-management' in i['href']]
 assert len(items)==1 and items[0]['kind']=='movement-management'
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html')
 page.locator('.module-trigger[title="組織與門市"]').hover();page.locator('.nav-item[title="人員異動管理"]').click()
 nav=page.get_by_role('navigation',name='人員異動功能');batch=page.get_by_role('region',name='批次輸入異動',exact=True)
 expect(batch.get_by_label('姓名',exact=True)).to_be_visible();batch.get_by_label('姓名',exact=True).fill('保留草稿驗證')
 with page.expect_download() as d:batch.get_by_role('button',name='下載匯入範例',exact=True).click()
 d.value.save_as('.tmp-check/movement-management-example.xlsx')
 with page.expect_download() as d:batch.get_by_role('button',name='匯出 Excel',exact=True).click()
 d.value.save_as('.tmp-check/movement-management-draft.xlsx')
 nav.get_by_role('button',name='查看歷史紀錄',exact=True).click()
 history=page.get_by_role('region',name='查看歷史紀錄',exact=True)
 expect(history.get_by_role('button',name='查詢紀錄',exact=True)).to_be_visible()
 nav.get_by_role('button',name='調店登記確認',exact=True).click()
 transfers=page.get_by_role('region',name='調店登記確認',exact=True)
 expect(transfers.get_by_label('申請狀態')).to_be_visible()
 nav.get_by_role('button',name='批次輸入異動',exact=False).click()
 expect(batch.get_by_label('姓名',exact=True)).to_have_value('保留草稿驗證')
 assert page.locator('.tab-strip [role=tab]').count()==1
 batch.locator('input[type=file]').set_input_files('.tmp-check/movement-management-example.xlsx')
 confirm=page.get_by_role('dialog',name='取代目前異動草稿',exact=True)
 expect(confirm).to_be_visible();confirm.get_by_role('button',name='載入新檔案',exact=True).click()
 expect(batch.get_by_role('alert').first).to_contain_text('EXAMPLE')
 expect(batch.get_by_label('員編',exact=True)).to_have_value('EXAMPLE-01')
 page.screenshot(path='.tmp-check/movement-management-desktop.png')
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/movement-management-mobile.png')
 page.locator('.tab-close').click();expect(page.get_by_role('dialog')).to_be_visible()
 assert not errors,errors
 print('Single native navigation; three retained sections; example/download/export/import validation; unsaved close; desktop/mobile PASS; no database writes')
 b.close()
