import csv,io,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';fixture=json.loads(Path('.tmp-check/birthday-save-fixture.json').read_text(encoding='utf-8'));a=next(a for a in json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts'] if a['key']=='navigation');expect.set_options(timeout=30000)
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,accept_downloads=True,extra_http_headers={'Origin':B});assert c.request.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok
 page=c.new_page();page.goto('/workspace/index.html');page.locator('.sidebar').hover();page.locator('.nav-search input').fill('生日');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='員工生日匯入 新版',exact=True).click();panel=page.locator('[role=tabpanel]:visible')
 with page.expect_download() as download:panel.get_by_role('button',name='下載 CSV 範本',exact=True).click()
 path=Path('.tmp-check/birthday-template-download.csv');download.value.save_as(path)
 rows=list(csv.reader(io.StringIO(path.read_text(encoding='utf-8-sig'))));assert rows[0]==['員編','姓名','生日(YYYY-MM-DD)'];codes={r['employee_code'] for r in fixture};selected=[r for r in rows[1:] if r[0] in codes];assert len(selected)==2
 first=next(r for r in selected if r[0]==fixture[0]['employee_code']);assert first[1]=="'"+fixture[0]['employee_name']
 second=next(r for r in selected if r[0]==fixture[1]['employee_code']);assert second[1]==fixture[1]['employee_name']
 buffer=io.StringIO();writer=csv.writer(buffer);writer.writerow(rows[0]);writer.writerows([[r[0],r[1],'2000-02-29'] for r in selected]);panel.locator('input[type=file]').set_input_files({'name':'roundtrip.csv','mimeType':'text/csv','buffer':buffer.getvalue().encode('utf-8')});expect(panel.get_by_role('button',name='確認更新 2 位員工生日',exact=True)).to_be_enabled()
 for r in fixture:expect(panel.get_by_role('cell',name=r['employee_name'],exact=True)).to_be_visible()
 panel.get_by_role('button',name='確認更新 2 位員工生日',exact=True).click();page.get_by_role('dialog').get_by_role('button',name='確認送出',exact=True).click();expect(panel.locator('.notice[role=status]')).to_contain_text('已更新 2 位員工')
 employees=c.request.get('/api/workspace/employees').json()['employees'];assert len([e for e in employees if e['employee_code'] in codes and e['birthday']=='2000-02-29'])==2
 path.unlink();print('PASS actual template download, CSV comma/quote safety, formula-prefix roundtrip, literal apostrophe preservation and birthday save/readback');browser.close()
