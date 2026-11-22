import os,uuid,subprocess,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';expect.set_options(timeout=30000)
with sync_playwright() as p:
 c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B},timeout=60000)
 assert c.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']}).ok
 response=c.get('/api/workspace/relationships');assert response.ok,response.text();initial=response.json();initial_ids={m['id'] for m in initial['members']};assert all(initial['capabilities'].values())
 anon=p.request.new_context(base_url=B);assert anon.get('/api/workspace/relationships').status==401
 assert c.post('/api/workspace/relationships',data={},headers={'Origin':'http://invalid.test'}).status==403
 assert c.post('/api/workspace/relationships',data={}).status==400
 token=uuid.uuid4().hex;code='VUEREL'+token;filename='vue-relationship-'+token+'.xlsx';file=Path('.tmp-check')/filename;member=None
 try:
  form={'member_name':'新版流程測試'+token[:6],'phone':'0000000000','relationship':'測試資料'}
  r=c.post('/api/workspace/relationships',data=form);assert r.ok,r.text();member=r.json()['id'];url='/api/workspace/relationships/'+member
  assert c.post(url+'/reject',data={}).status==400
  r=c.post(url+'/reject',data={'rejection_reason':'測試退回'});assert r.ok,r.text();m=next(m for m in c.get('/api/workspace/relationships').json()['members'] if m['id']==member);assert m['rejection_reason']=='測試退回' and not m['is_approved']
  r=c.post(url+'/approve');assert r.ok,r.text();m=next(m for m in c.get('/api/workspace/relationships').json()['members'] if m['id']==member);assert m['is_approved'] and not m['rejected_at']
  form['member_number']=code;r=c.patch(url,data=form);assert r.ok,r.text();assert c.patch(url,data={**form,'member_number':'different'}).status==409
  js="const X=require('xlsx'),b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.json_to_sheet([{'門市代號':'0002','銷售日期':'2026/09/30 14:30','會員編號':process.argv[2],'品號':'TEST','品名':'臨時驗證商品','數量':2,'金額':123.5}]),'銷售');X.writeFile(b,process.argv[1]);"
  subprocess.run(['node','-e',js,str(file),code],check=True)
  r=c.post('/api/workspace/relationships/sales/import',multipart={'file':{'name':filename,'mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':file.read_bytes()}});assert r.ok,r.text();assert r.json()['imported']==1
  s=c.get('/api/workspace/relationships/sales',params={'member_number':code}).json()['sales'];assert len(s)==1 and s[0]['amount']==123.5 and s[0]['quantity']==2 and s[0]['member_name']==form['member_name']
  # Browser reads temporary member; all browser mutations intercepted.
  browser=p.chromium.launch();bc=browser.new_context(base_url=B,storage_state=c.storage_state(),viewport={'width':1600,'height':1000});page=bc.new_page();page.set_default_timeout(30000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html');page.get_by_role('button',name='選單',exact=True).click();page.locator('.catalog-item[title="關係會員"]').click();expect(page.get_by_role('heading',name='關係會員',exact=True)).to_be_visible();page.get_by_label('搜尋會員').fill(code);row=page.locator('.relationship-page tbody tr:visible').first;expect(row).to_contain_text(form['member_name']);row.get_by_role('button',name='編輯',exact=True).click();d=page.get_by_role('dialog',name='編輯關係會員');expect(d.get_by_label('會員編號',exact=True)).to_be_disabled();d.get_by_label('關係',exact=True).fill('草稿測試');d.get_by_role('button',name='取消',exact=True).click();expect(page.get_by_role('dialog',name='放棄未儲存內容？')).to_be_visible();page.get_by_role('button',name='繼續編輯',exact=True).click()
  writes=[]
  def intercept(route):
   if route.request.method in ['POST','PATCH','DELETE']:
    writes.append(route.request.method);route.fulfill(status=503,json={'error':'模擬儲存失敗，請重試'})
   else:route.continue_()
  page.route('**/api/workspace/relationships**',intercept);d.get_by_role('button',name='儲存修改').click();expect(d.get_by_role('alert')).to_contain_text('模擬儲存失敗');expect(d.get_by_label('關係',exact=True)).to_have_value('草稿測試');d.get_by_role('button',name='取消',exact=True).click();page.get_by_role('button',name='放棄變更').click();page.screenshot(path='.tmp-check/relationships-members.png')
  page.get_by_role('button',name='銷售明細報表',exact=True).click();page.get_by_label('會員編號',exact=True).fill(code);page.get_by_role('button',name='查詢銷售明細').click();expect(page.locator('.sales-total')).to_contain_text('123.5');page.screenshot(path='.tmp-check/relationships-sales.png')
  with page.expect_download() as dl:page.get_by_role('button',name='下載範本',exact=True).click()
  assert dl.value.suggested_filename.endswith('.xlsx')
  page.get_by_role('button',name='匯入銷售明細 Excel').click();upload=page.get_by_role('dialog',name='匯入銷售明細',exact=True);upload.get_by_label('銷售明細 Excel').set_input_files(str(file));upload.get_by_role('button',name='確認匯入').click();expect(upload.get_by_role('alert')).to_contain_text('模擬儲存失敗');expect(upload).to_contain_text(filename);upload.get_by_role('button',name='取消',exact=True).click();page.get_by_role('button',name='放棄變更').click();page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/relationships-mobile.png');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors;browser.close()
  r=c.delete(url);assert r.ok,r.text();member=None;assert len(c.get('/api/workspace/relationships/sales',params={'member_number':code}).json()['sales'])==1
  print('PASS real DEV create/reject/approve/edit/member-number lock, xlsx import and sales lookup, deletion retains sales; native UI tab/dialog/dirty/failure/file retention/template download/desktop/mobile; 401/Origin403/validation400',flush=True)
 finally:
  if member:
   assert member not in initial_ids;r=c.delete('/api/workspace/relationships/'+member);assert r.ok,r.text()
  assert {m['id'] for m in c.get('/api/workspace/relationships').json()['members']}==initial_ids
  sql=Path('.tmp-check/relationship-cleanup.sql');sql.write_text("DELETE FROM public.relationship_sales_imports WHERE file_name = '"+filename+"';",encoding='utf-8');subprocess.run(['node','scripts/dev-cleanup-query.cjs',str(sql).replace('\\','/'),'.tmp-check/relationship-cleanup.json'],check=True)
  assert c.get('/api/workspace/relationships/sales',params={'member_number':code}).json()['sales']==[]
  print('PASS temporary member and imported sales removed; existing member IDs unchanged',flush=True)
