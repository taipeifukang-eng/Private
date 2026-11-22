"""DEV end-to-end campaign fixture; deletes its campaign and receipts in finally."""
import os,json,uuid,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
expect.set_options(timeout=60000)
B='http://localhost:3002';tag='DEV活動驗證-'+uuid.uuid4().hex[:8];cid=None
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1500,'height':1000});c.set_default_timeout(60000)
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 session=c.request.get('/api/workspace/session').json();group=next(g['label'] for g in session['navigation'] if any(i.get('kind')=='campaigns' for i in g['items']))
 def tools(resource,**params):
  r=c.request.get('/api/workspace/campaign-tools',params={'resource':resource,'campaign_id':cid,**params});assert r.ok,(resource,r.status,r.json().get('error'));return r.json()
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  page.goto('/workspace/index.html');page.locator(f'.module-trigger[title="{group}"]').hover();page.locator('.nav-item[title="活動管理"]').click()
  page.get_by_role('button',name='門市設定',exact=True).click()
  settings=page.get_by_role('dialog',name='門市活動設定',exact=True)
  select=settings.get_by_label('門市',exact=True);expect(select.locator('option')).to_have_count(4);select.select_option(index=1)
  settings.get_by_label('備註',exact=True).fill('未儲存設定驗證');settings.get_by_role('button',name='關閉',exact=True).click()
  page.get_by_role('dialog',name='放棄活動修改？').get_by_role('button',name='放棄修改',exact=True).click();expect(settings).to_have_count(0)
  page.get_by_role('button',name='特殊日期',exact=True).click();special=page.get_by_role('dialog',name='特殊日期',exact=True);expect(special.get_by_label('日期',exact=True)).to_be_visible();special.get_by_role('button',name='關閉',exact=True).click()
  tabs=page.locator('.tab-strip [role=tab]').count()
  page.get_by_role('button',name='新增活動',exact=True).click();dialog=page.get_by_role('dialog',name='新增活動',exact=True)
  expect(dialog).to_be_visible();page.screenshot(path='.tmp-check/campaign-create-desktop.png');assert page.locator('.tab-strip [role=tab]').count()==tabs
  dialog.get_by_label('活動名稱',exact=False).fill('未儲存草稿');dialog.get_by_role('button',name='關閉',exact=True).click()
  page.get_by_role('dialog',name='放棄活動修改？').get_by_role('button',name='繼續編輯').click();expect(dialog.get_by_label('活動名稱',exact=False)).to_have_value('未儲存草稿')
  dialog.get_by_label('活動名稱',exact=False).fill(tag);dialog.get_by_label('開始日期',exact=False).fill('2026-11-01');dialog.get_by_label('結束日期',exact=False).fill('2026-11-30')
  with page.expect_response(lambda r:'/api/workspace/campaigns' in r.url and r.request.method=='POST') as result:dialog.get_by_role('button',name='儲存活動',exact=True).click()
  response=result.value;assert response.ok,(response.status,response.json());cid=response.json()['record']['id'];expect(dialog).to_have_count(0)
  row=page.get_by_role('row').filter(has_text=tag);expect(row).to_be_visible();row.get_by_role('button',name='編輯',exact=True).click()
  edit=page.get_by_role('dialog',name='編輯活動',exact=True);expect(edit.get_by_label('活動名稱',exact=False)).to_have_value(tag);edit.get_by_role('button',name='關閉',exact=True).click()
  row.get_by_role('button',name='活動規劃／排程',exact=True).click()
  nav=page.get_by_role('navigation',name='活動規劃分區');expect(nav).to_be_visible()
  stores=tools('stores')['data'];a,b=stores[:2]
  page.screenshot(path='.tmp-check/campaign-calendar-desktop.png')
  page.get_by_role('button',name='自動排程',exact=True).click();auto=page.get_by_role('dialog',name='套用自動排程？');expect(auto).to_contain_text('可安排');auto.get_by_role('button',name='套用至草稿').click()
  page.get_by_role('button',name='儲存所有排程變更',exact=True).click();page.get_by_role('dialog',name='儲存所有排程變更？').get_by_role('button',name='確認',exact=True).click()
  expect(page.get_by_text('已儲存所有排程變更',exact=True)).to_be_visible();print('create/modal/schedule PASS',flush=True);assert len(tools('schedules')['schedules'])==len(stores)
  page.get_by_label('安排門市',exact=True).select_option(a['id']);page.get_by_label('活動日期',exact=True).fill('2026-11-12');page.get_by_role('button',name='安排／移動門市').click()
  page.get_by_role('button',name='取消排程變更').click();page.get_by_role('dialog',name='放棄未儲存的修改？').get_by_role('button',name='確認',exact=True).click()
  expect(page.get_by_role('button',name='儲存所有排程變更')).to_be_disabled()
  for label in ['督導','店長','盤點組人員']:
   page.get_by_role('button',name='發布給'+label,exact=True).click();page.get_by_role('dialog',name='更新活動發布對象？').get_by_role('button',name='確認更新').click();expect(page.get_by_role('button',name='取消發布給'+label,exact=True)).to_be_visible()
  nav.get_by_role('button',name='工作清單',exact=True).click();page.get_by_role('button',name='新增前置工作',exact=True).click()
  d=page.get_by_role('dialog',name='新增前置工作');d.get_by_label('工作事項').fill('確認活動物料');d.get_by_label('安排人員').fill('驗證人員');d.get_by_role('button',name='儲存',exact=True).click();expect(d).to_have_count(0)
  assert len(tools('checklist')['data'])==1
  nav.get_by_role('button',name='設備車次',exact=True).click();page.get_by_role('button',name='新增設備車次',exact=True).click()
  d=page.get_by_role('dialog',name='新增設備車次');d.get_by_label('起點',exact=True).fill('林森街倉庫');d.get_by_label('目的地',exact=True).fill(a['store_name']);d.get_by_role('button',name='儲存',exact=True).click();expect(d).to_have_count(0);assert len(tools('trips')['data'])==1
  nav.get_by_role('button',name='門市細節／人力',exact=True).click();storeRow=page.get_by_role('row').filter(has_text=a['store_name']);storeRow.get_by_role('button',name='門市細節／工作回報').click()
  d=page.get_by_role('dialog',name=a['store_code']+' '+a['store_name']+' · 活動規劃',exact=True);expect(d.get_by_label('外場廠商',exact=True)).to_be_visible();d.get_by_label('外場廠商',exact=True).fill('交易驗證廠商');d.get_by_role('button',name='儲存門市配置').click();expect(d.get_by_text('門市配置已儲存',exact=True)).to_be_visible()
  assert tools('details',store_id=a['id'])['data'][0]['outdoor_vendor']=='交易驗證廠商'
  d.get_by_role('button',name='本店與支援人力',exact=True).click();d.get_by_role('button',name='從月度人員重新載入').click();page.get_by_role('dialog',name='重新載入月度人員？').get_by_role('button',name='載入月度人員').click()
  expect(d.get_by_role('button',name='儲存本店人員',exact=True)).to_be_enabled();d.get_by_role('button',name='儲存本店人員',exact=True).click();expect(d.get_by_text('本店人員已儲存',exact=True)).to_be_visible();assert len(tools('ownStaff',store_id=a['id'])['data'])>0
  d.get_by_label('額外支援人數',exact=True).fill('2');d.get_by_label('督導人數',exact=True).fill('1');d.get_by_role('button',name='儲存預估人數').click();expect(d.get_by_text('預估人數已儲存',exact=True)).to_be_visible()
  d.get_by_role('button',name='新增支援需求',exact=True).click();r=page.get_by_role('dialog',name='支援門市需求');r.get_by_label('支援門市',exact=True).select_option(b['id']);r.get_by_role('button',name='儲存需求',exact=True).click();expect(r).to_have_count(0)
  assert len(tools('requests',requesting_store_id=a['id'])['data'])==1
  d.get_by_role('button',name='工作完成回報',exact=True).click();d.get_by_label('已完成',exact=True).check();d.get_by_label('店長回報',exact=True).fill('驗證已備妥');d.get_by_role('button',name='儲存此項回報').click();expect(d.get_by_text('工作回報已儲存',exact=True)).to_be_visible();d.get_by_role('button',name='關閉門市規劃').click();expect(d).to_have_count(0)
  for name,label,value in [('行銷部','活動內容','活動規劃驗證'),('商品部','商品供應說明','供應規劃驗證')]:
   nav.get_by_role('button',name=name,exact=True).click();page.get_by_label(label,exact=True).fill(value);page.get_by_role('button',name='儲存並發布',exact=True).click();expect(page.get_by_text('已儲存並發布'+name+'內容',exact=True)).to_be_visible()
  dept=tools('departments')['data'];assert dept['marketing_content']=='活動規劃驗證' and dept['merchandise_supply_content']=='供應規劃驗證'
  nav.get_by_role('button',name='規劃預覽',exact=True).click();expect(page.get_by_role('button',name='列印／匯出 PDF',exact=True)).to_be_enabled();page.evaluate('window.print=()=>{window.__printCalled=true}');page.get_by_role('button',name='列印／匯出 PDF',exact=True).click();assert page.evaluate('window.__printCalled===true')
  page.screenshot(path='.tmp-check/campaign-preview-desktop.png');page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/campaign-preview-mobile.png');assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
  assert not errors,errors
  print('PASS real Vue create/edit modal, dirty close, automatic scheduling/save/cancel, 3 audiences, checklist/trip creation, store detail, monthly staff replacement, headcount/support request/completion, department publication, preview/print, desktop/mobile')
 except Exception:
  page.screenshot(path='.tmp-check/campaign-ui-failure.png');print('Browser errors:',errors,flush=True);raise
 finally:
  if cid:
   latest=c.request.get('/api/workspace/campaigns',params={'id':cid}).json()['records'];
   if latest:
    assert latest[0]['name']==tag
    r=c.request.delete('/api/workspace/campaigns',params={'id':cid,'version':latest[0]['workspace_version']},headers={'Origin':B});assert r.ok,(r.status,r.text())
   uuid.UUID(cid)
   Path('.tmp-check/campaign-fixture-clean.sql').write_text("DELETE FROM workspace_campaign_requests WHERE payload->>'campaign'='"+cid+"'; SELECT count(*) leftovers FROM campaigns WHERE id='"+cid+"';",encoding='utf-8')
   subprocess.run(['node','scripts/dev-cleanup-query.cjs','.tmp-check/campaign-fixture-clean.sql','.tmp-check/campaign-fixture-clean.json'],check=True)
  browser.close()
