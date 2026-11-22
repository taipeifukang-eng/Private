import os,uuid,subprocess,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';A='/api/workspace/employee-purchases';expect.set_options(timeout=30000)
with sync_playwright() as p:
 c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B},timeout=60000)
 assert c.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']}).ok
 def ok(r):
  assert r.ok,(r.status,r.text());return r.json()
 assert p.request.new_context(base_url=B).get(A+'?year_month=2099-11').status==401
 assert c.post(A+'/import',headers={'Origin':'http://invalid.test'}).status==403
 assert c.get(A+'?year_month=2099-99').status==400
 initial=ok(c.get(A+'?year_month=2099-11'));assert initial['total_count']==0 and initial['latest_batch'] is None
 token=uuid.uuid4().hex;filename='vue-purchases-'+token+'.xlsx';file=Path('.tmp-check')/filename
 def make(mixed=False,single=False):
  js="const X=require('xlsx'),b=X.utils.book_new(),rows=[['GridBand1'],['門市代號','銷售日期','銷售序號','會員編號','會員名稱','品號','品名','數量','總金額','毛利'],['0002','2099/11/10','1','FK0008','測試人員','TEST1','員購驗證品',2,200,30]];if(process.argv[3]!=='single')rows.push(['0003',process.argv[2]==='mixed'?'2099/12/11':'2099/11/11','2','VUEUNMATCH','未比對測試','TEST2','員購驗證品二',1,100,20]);X.utils.book_append_sheet(b,X.utils.aoa_to_sheet(rows),'POS');X.writeFile(b,process.argv[1]);"
  subprocess.run(['node','-e',js,str(file),'mixed' if mixed else 'normal','single' if single else 'two'],check=True)
 def upload():return c.post(A+'/import',multipart={'file':{'name':filename,'mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':file.read_bytes()}})
 try:
  make(mixed=True);assert upload().status==400;assert ok(c.get(A+'?year_month=2099-11'))['total_count']==0
  make();result=ok(upload());assert result['imported']==2 and result['matched']==1 and result['total_amount']==300 and result['year_month']=='2099-11'
  data=ok(c.get(A+'?year_month=2099-11'));assert data['total_count']==2 and data['total_amount']==300 and len(data['rows'])==2
  employee=next(x for x in data['rows'] if x['employee_code']=='FK0008');detail=ok(c.get(A+'/employee-details',params={'year_month':'2099-11','employee_code':employee['employee_code']}));assert detail['total_amount']==200 and detail['total_quantity']==2 and detail['details'][0]['product_code']=='TEST1'
  filtered=ok(c.get(A,params={'year_month':'2099-11','position':employee['employee_position']}));assert all(x['employee_position']==employee['employee_position'] for x in filtered['rows'])
  browser=p.chromium.launch();bc=browser.new_context(base_url=B,storage_state=c.storage_state(),viewport={'width':1600,'height':1000});page=bc.new_page();page.set_default_timeout(30000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('/workspace/index.html');page.get_by_role('button',name='選單',exact=True).click();page.locator('.catalog-item[title="員工購物管理"]').click();expect(page.get_by_role('heading',name='員工購物管理',exact=True)).to_be_visible();page.get_by_label('月份',exact=True).fill('2099-11');page.get_by_role('button',name='查詢員購',exact=True).click();expect(page.locator('.purchase-page tbody tr')).to_have_count(2)
  page.get_by_role('button',name='消費總額 ↕',exact=True).click();expect(page.locator('.purchase-page tbody tr').first).to_contain_text('200');page.get_by_role('button',name='消費總額 ↓',exact=True).click();expect(page.locator('.purchase-page tbody tr').first).to_contain_text('100')
  page.locator('.purchase-page tbody tr').filter(has_text='FK0008').get_by_role('button',name='查看明細').click();d=page.get_by_role('dialog');expect(d).to_contain_text('員購驗證品');page.screenshot(path='.tmp-check/purchases-detail.png');d.get_by_role('button',name='關閉',exact=True).click()
  page.get_by_label('職稱篩選').select_option(employee['employee_position']);expect(page.locator('.purchase-page tbody tr')).to_have_count(len(filtered['rows']));expect(page.get_by_label('職稱篩選')).to_be_enabled();page.locator('.purchase-page h1').scroll_into_view_if_needed();page.screenshot(path='.tmp-check/purchases-list.png')
  page.get_by_role('button',name='匯入 POS Excel',exact=True).click();d=page.get_by_role('dialog',name='匯入 POS Excel',exact=True);d.get_by_label('POS Excel 檔案').set_input_files(str(file));expect(d.get_by_role('button',name='匯入並覆蓋銷售月份資料')).to_be_disabled();d.locator('input[type=checkbox]').check()
  page.route('**/api/workspace/employee-purchases/import',lambda route:route.fulfill(status=503,json={'error':'模擬失敗保留檔案'}));d.get_by_role('button',name='匯入並覆蓋銷售月份資料').click();expect(d.get_by_role('alert')).to_contain_text('模擬失敗');expect(d).to_contain_text(filename);d.get_by_role('button',name='取消',exact=True).click();expect(page.get_by_role('dialog',name='放棄尚未匯入的檔案？')).to_be_visible();page.get_by_role('button',name='放棄檔案').click()
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/purchases-mobile.png');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors;browser.close()
  make(single=True);result=ok(upload());after=ok(c.get(A+'?year_month=2099-11'));assert after['total_count']==1 and after['total_amount']==200
  print('PASS real XLSX import/replacement, cross-month rejection, employee/detail/position totals, access guards; native sorting/filter/dialog/failed-upload-retention/dirty/mobile')
 finally:
  sql=Path('.tmp-check/purchases-cleanup.sql');sql.write_text("BEGIN; DELETE FROM public.employee_purchase_sales WHERE batch_id IN (SELECT id FROM public.employee_purchase_import_batches WHERE file_name='"+filename+"'); DELETE FROM public.employee_purchase_import_batches WHERE file_name='"+filename+"'; COMMIT;",encoding='utf-8');subprocess.run(['node','scripts/dev-cleanup-query.cjs',str(sql).replace('\\','/'),'.tmp-check/purchases-cleanup.json'],check=True)
  after=ok(c.get(A+'?year_month=2099-11'));assert after['total_count']==0 and after['latest_batch'] is None;print('PASS test month cleared')
