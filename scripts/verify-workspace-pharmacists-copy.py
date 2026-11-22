import os,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';expect.set_options(timeout=30000)
with sync_playwright() as p:
 c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B},timeout=60000)
 assert c.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']}).ok
 r=c.post('/api/workspace/pharmacists/master?year=2026');assert r.ok,r.text();rows=r.json()['data'];assert len(rows)==9 and sum(x['status']=='active' for x in rows)==8
 payload=json.loads(Path('.tmp-check/pharmacist-copy-2026/payload.json').read_text(encoding='utf-8'));fee=payload['pharmacist_annual_fees'][0];code=fee['employee_code']
 browser=p.chromium.launch();bc=browser.new_context(base_url=B,storage_state=c.storage_state(),viewport={'width':1600,'height':1000});page=bc.new_page();page.set_default_timeout(30000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('/workspace/index.html');page.get_by_role('button',name='選單',exact=True).click();page.locator('.catalog-item[title="藥師管理"]').click();page.get_by_role('button',name='藥師主檔',exact=True).click();expect(page.locator('.pharmacists-page tbody tr')).to_have_count(8)
 page.locator('.pharmacists-page select').last.select_option('');expect(page.locator('.pharmacists-page tbody tr')).to_have_count(9);page.screenshot(path='.tmp-check/pharmacist-copy-2026/master.png')
 row=page.locator('.pharmacists-page tbody tr').filter(has_text=code);row.get_by_role('button',name='有效繳費紀錄',exact=True).click();dialog=page.get_by_role('dialog');expect(dialog.locator('tbody tr')).not_to_have_count(0);dialog.get_by_role('button',name='查看證明',exact=True).first.click();proof=page.get_by_role('dialog',name='繳費證明',exact=True);expect(proof).to_be_visible()
 if proof.locator('img').count():
  expect(proof.locator('img')).to_be_visible();page.wait_for_function("Array.from(document.querySelectorAll('dialog img')).some(i=>i.complete && i.naturalWidth>0)")
 page.screenshot(path='.tmp-check/pharmacist-copy-2026/proof.png');assert not errors,errors;browser.close();print('PASS API 9 records; UI active8/all9; fee dialog and proof preview; no runtime errors')
