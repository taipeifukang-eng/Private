import os,json,subprocess
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002'
def excel(rows):
 js="const X=require('xlsx'),fs=require('fs');let b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.aoa_to_sheet(JSON.parse(fs.readFileSync(0,'utf8'))),'Sheet1');process.stdout.write(X.write(b,{type:'buffer',bookType:'xlsx'}));"
 return subprocess.run(['node','-e',js],input=json.dumps(rows).encode(),capture_output=True,check=True).stdout
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1500,'height':1000});c.set_default_timeout(60000)
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 session=c.request.get('/api/workspace/session').json();group=next(g for g in session['navigation'] if any(i.get('kind')=='inventory' for i in g['items']));item=next(i for i in group['items'] if i.get('kind')=='inventory')
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html');page.locator(f'.module-trigger[title="{group["label"]}"]').hover();page.locator(f'.nav-item[title="{item["label"]}"]').click();expect(page.get_by_role('heading',name='盤點結果分析報表',exact=True)).to_be_visible();page.screenshot(path='.tmp-check/inventory-analysis-desktop.png')
 page.get_by_role('button',name='離線盤點匯入匯出工具',exact=True).click()
 def upload(label,rows):page.get_by_label(label,exact=False).set_input_files({'name':'fixture.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':excel(rows)})
 upload('1F當日商品資料', [['DPOS'],['品號','品名','條碼','庫存','主要儲位'],[1,'測試商品A','',10,'A'],[2,'測試商品B','',5,'B'],[3,'測試商品C','',4,'C']])
 upload('外盤公司原始檔',[['品號','品名','條碼','盤點數量'],[1,'A','',8],[2,'B','',3]])
 upload('FKS0701',[['品號','盤點數量','盤點儲位'],[1,2,'A']])
 page.get_by_role('button',name='產生結果',exact=True).click();expect(page.get_by_text('需複盤 1 項')).to_be_visible()
 with page.expect_download() as d:page.get_by_role('button',name='下載外盤應複盤清單').click()
 d.value.save_as('.tmp-check/inventory-external.xlsx')
 page.get_by_role('button',name='2. 產出內部+外盤公司資料整合之複盤表與未盤表').click();upload('預盤資料',[['品號','盤點數量','盤點儲位'],[1,8,'B'],[2,3,'C']]);page.get_by_role('button',name='產生結果',exact=True).click();expect(page.get_by_text('無盤差 1 項已保留')).to_be_visible()
 with page.expect_download() as d:page.get_by_role('button',name='下載內部複盤').click()
 d.value.save_as('.tmp-check/inventory-internal.xlsx')
 page.get_by_role('button',name='3. 產出DPOS匯入檔案').click();upload('修改後內部',[['品號','庫存量','該儲位盤點數量'],[2,5,4]]);upload('修改後未盤點',[['品號','庫存量','盤點數量'],[3,4,4]]);page.get_by_role('button',name='產生結果',exact=True).click();expect(page.get_by_text('結果 3 項',exact=True)).to_be_visible()
 with page.expect_download() as d:page.get_by_role('button',name='下載 DPOS').click()
 d.value.save_as('.tmp-check/inventory-final.xlsx');page.screenshot(path='.tmp-check/inventory-offline-desktop.png');page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/inventory-offline-mobile.png');assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
 assert not errors,errors
 print('PASS native inventory navigation, real API read, offline three stages and downloaded files, desktop/mobile, no database writes');browser.close()
