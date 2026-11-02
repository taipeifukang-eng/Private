"""Real DEV previews; SQL transaction regression covers writes. UI save responses are simulated."""
import os,uuid,json,io
from pathlib import Path
import subprocess
from datetime import datetime
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';expect.set_options(timeout=60000)
def excel(rows):
 encoded=json.dumps(rows,default=lambda v:'#DATE:'+v.isoformat())
 js="const X=require('xlsx'),fs=require('fs');const rows=JSON.parse(fs.readFileSync(0,'utf8'));for(const r of rows)if(typeof r[4]==='string'&&r[4].startsWith('#DATE:'))r[4]=new Date(r[4].slice(6));const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.aoa_to_sheet([['門市代號','員編','姓名','職位','到職日期'],...rows]),'員工資料');process.stdout.write(X.write(b,{type:'buffer',bookType:'xlsx'}));"
 return subprocess.run(['node','-e',js],input=encoded.encode('utf-8'),capture_output=True,check=True).stdout

with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1500,'height':1000});c.set_default_timeout(60000)
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 stores=c.request.get('/api/workspace/employee-import').json()['stores'];store=stores[0]
 code='UI'+uuid.uuid4().hex[:10].upper();valid=excel([[int(store['store_code']),code,'匯入預覽測試','專員',datetime(2026,10,30)]])
 def preview(content):return c.request.post('/api/workspace/employee-import',headers={'Origin':B},multipart={'file':{'name':'employees.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':content}})
 r=preview(valid);assert r.ok,r.text();data=r.json();assert data['valid'],data;assert data['rows'][0]['row']==2 and data['rows'][0]['start_date']=='2026-10-30' and data['rows'][0]['store_code']==store['store_code']
 invalid=excel([[store['store_code'],code,'測試','專員','2026-02-30'],[store['store_code'],code,'測試','專員','2026/10/30']]);r=preview(invalid);assert r.ok and not r.json()['valid'];assert any(int(e['row'])==2 for e in r.json()['errors']) and any(int(e['row'])==3 for e in r.json()['errors'])
 unknown=preview(excel([['NOT_A_STORE',code,'測試','專員','2026/10/30']]));assert not unknown.json()['valid']
 employee=c.request.get('/api/workspace/employees').json()['employees'][0];duplicate=preview(excel([[store['store_code'],employee['employee_code'],employee['employee_name'],'專員','2026/10/30']]));assert not duplicate.json()['valid']
 anon=p.request.new_context(base_url=B);assert anon.get('/api/workspace/employee-import').status==401;anon.dispose()
 assert c.request.put('/api/workspace/employee-import',headers={'Origin':'https://invalid.example'},data={'rows':data['rows'],'requestId':str(uuid.uuid4())}).status==403
 session=c.request.get('/api/workspace/session').json();group=next(g['label'] for g in session['navigation'] if any(i.get('kind')=='employee-import' for i in g['items']))
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html');page.locator(f'.module-trigger[title="{group}"]').hover();page.locator('.nav-item[title="批次匯入員工"]').click();expect(page.get_by_role('heading',name='批次匯入員工',exact=True)).to_be_visible();assert '/workspace/index.html' in page.url and '/admin/import-employees' not in page.url
 with page.expect_download() as dl:page.get_by_role('button',name='下載 Excel 範本').click()
 dl.value.save_as('.tmp-check/employee-import-template.xlsx');headers=subprocess.run(['node','-e',"const X=require('xlsx');const b=X.readFile('.tmp-check/employee-import-template.xlsx');process.stdout.write(JSON.stringify(X.utils.sheet_to_json(b.Sheets[b.SheetNames[0]],{header:1})[0]));"],capture_output=True,check=True).stdout;assert json.loads(headers)==['門市代號','員編','姓名','職位','到職日期']
 page.get_by_label('上傳員工 Excel').set_input_files({'name':'invalid.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':invalid});expect(page.get_by_text('第 2 列：',exact=False).first).to_be_visible();expect(page.get_by_role('button',name='確認匯入 2 位員工')).to_be_disabled()
 page.get_by_label('上傳員工 Excel').set_input_files({'name':'valid.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':valid});page.get_by_role('dialog',name='取代目前匯入內容？').get_by_role('button',name='預覽新檔案').click();expect(page.get_by_role('button',name='確認匯入 1 位員工')).to_be_enabled()
 page.screenshot(path='.tmp-check/employee-import-desktop.png');page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/employee-import-mobile.png');assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
 requests=[]
 def save(route):
  if route.request.method!='PUT':route.continue_();return
  payload=route.request.post_data_json;requests.append(payload)
  if len(requests)==1:route.fulfill(status=503,json={'error':'模擬斷線，請重試'})
  else:route.fulfill(json={'success':True,'imported':1,'requestId':payload['requestId']})
 page.route('**/api/workspace/employee-import',save)
 for i in range(2):
  page.get_by_role('button',name='確認匯入 1 位員工').click();page.get_by_role('dialog',name='確認批次新增員工').get_by_role('button',name='確認送出').click()
  if i==0:expect(page.get_by_role('alert')).to_contain_text('模擬斷線')
 expect(page.get_by_text('已成功匯入 1 位員工。',exact=True)).to_be_visible();assert requests[0]==requests[1]
 assert not errors,errors
 print('PASS real xlsx preview/date/numeric store/duplicate validation, auth/origin, native nav/template, invalid block, replace dialog, retry request identity, success UI, desktop/mobile; no persisted employee fixtures')
 browser.close()
