import os,json
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002'
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(base_url=B,viewport={'width':1500,'height':1050});c.set_default_timeout(60000)
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 session=c.request.get('/api/workspace/session').json();g=next(g for g in session['navigation'] if any(i.get('kind')=='inventory' for i in g['items']));n=next(i for i in g['items'] if i.get('kind')=='inventory')
 # Real authorization/read is checked independently; UI mutations below are intercepted.
 response=c.request.get('/api/workspace/inventory?year_month=2026-09');assert response.ok,response.text()
 batch={'id':'batch-1','store_code':'0002','store_name':'測試報表','inventory_order_no':'INV-001','report_label':'第一次盤點','report_kind':'INITIAL','report_round':1,'row_count':2,'source_file_name':'UI fixture.xlsx','imported_at':'2026-10-30'}
 items=[{'id':'one','product_code':'00000001','product_name':'商品甲','category_code':'02','category_name':'保健','unit':'瓶','storage_location_1':'A','stock_qty':10,'stock_amount':1000,'difference_qty':-2,'difference_amount_member':-300,'cost':-200,'difference_reason':''},{'id':'two','product_code':'00000002','product_name':'商品乙','category_code':'01','category_name':'排除分類','unit':'盒','storage_location_1':'B','stock_qty':5,'stock_amount':500,'difference_qty':1,'difference_amount_member':150,'cost':100,'difference_reason':''}]
 writes=[];failed=False
 def route(r):
  global failed
  q=parse_qs(urlparse(r.request.url).query)
  if r.request.method=='GET':
   rows=[dict(i) for i in items]
   if q.get('view')==['recount_changes']:
    for i in rows:i.update(initial_difference_qty=-2,initial_cost=-200,recount_difference_qty=-1,recount_cost=-100,difference_qty_delta=1,cost_delta=100)
   r.fulfill(json={'success':True,'batches':[batch],'items':rows if q.get('batch_id') else [],'selected_batch_id':q.get('batch_id',[''])[0],'category_summary':[{'category_code':'02','category_name':'保健','row_count':1,'total_difference_qty':-2,'positive_cost_total':0,'negative_cost_total':-200.5,'net_cost_total':-200.5,'stock_amount_total':1000.5,'row_count':1,'shortage_count':1,'surplus_count':0}],'non_excluded_summary':{'positive_cost_total':0,'negative_cost_total':-200.5,'net_cost_total':-200.5,'stock_amount_total':1000.5,'row_count':1,'shortage_count':1,'surplus_count':0},'difference_reason_cost_threshold':100,'can_manage_difference_reason_threshold':True});return
  writes.append({'method':r.request.method,'body':r.request.post_data})
  if r.request.method=='PATCH':
   body=r.request.post_data_json
   if body['action']=='update_reason' and not failed:failed=True;r.fulfill(status=503,json={'error':'測試斷線'});return
  r.fulfill(json={'success':True,'imported_batches':1,'imported_rows':2,'replaced_batches':0})
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/api/workspace/inventory?*',route);page.route('**/api/workspace/inventory',route)
 page.goto('/workspace/index.html');page.locator(f'.module-trigger[title="{g["label"]}"]').hover();page.locator(f'.nav-item[title="{n["label"]}"]').click();expect(page.get_by_label('商品甲 盤差原因',exact=True)).to_be_visible()
 expect(page.get_by_text('統計筆數 1 筆',exact=True)).to_be_visible();expect(page.get_by_text('成本佔比 -20.04%',exact=True)).to_be_visible();page.get_by_role('button',name='成本排序',exact=True).click();expect(page.get_by_role('columnheader').filter(has=page.get_by_role('button',name='成本排序',exact=True))).to_have_attribute('aria-sort','ascending');page.get_by_role('button',name='成本排序',exact=True).click();expect(page.get_by_role('columnheader').filter(has=page.get_by_role('button',name='成本排序',exact=True))).to_have_attribute('aria-sort','descending')
 cards=page.get_by_role('region',name='分類統計');card=cards.locator('.category-card').first;expect(card).to_contain_text('-201');expect(card).to_contain_text('1,001');card.click();expect(card).to_have_attribute('aria-pressed','true');card.click();expect(card).to_have_attribute('aria-pressed','false');cards.get_by_role('button',name='收折分類').click();expect(card).to_have_count(0);cards.get_by_role('button',name='展開分類').click();expect(card).to_be_visible()
 page.locator('.page-heading').get_by_role('button',name='匯入盤點 Excel',exact=True).click();dialog=page.get_by_role('dialog',name='匯入盤點 Excel',exact=True);dialog.get_by_label('盤點 Excel 檔案',exact=True).set_input_files('.tmp-check/inventory-external.xlsx');dialog.get_by_role('button',name='確認匯入',exact=True).click();expect(dialog).to_have_count(0)
 expect(page.get_by_role('button',name='匯入爭議再次盤點',exact=True)).to_be_enabled();page.get_by_role('button',name='匯入爭議再次盤點',exact=True).click();dialog=page.get_by_role('dialog',name='匯入爭議再次盤點',exact=True);expect(dialog).to_contain_text('0002 測試報表');dialog.get_by_label('爭議再次盤點 Excel 檔案',exact=True).set_input_files('.tmp-check/inventory-external.xlsx');dialog.get_by_role('button',name='確認匯入',exact=True).click();expect(dialog).to_have_count(0)
 posts=[w for w in writes if w['method']=='POST'];assert len(posts)==2;assert 'recount_parent_batch_id' not in posts[0]['body'];assert 'recount_parent_batch_id' in posts[1]['body'] and 'batch-1' in posts[1]['body']
 page.get_by_role('button',name='填寫盤差原因',exact=False).click();expect(page.get_by_label('商品乙 盤差原因',exact=True)).to_have_count(0);page.get_by_role('button',name='填寫盤差原因',exact=False).click()
 page.get_by_label('商品甲 盤差原因',exact=True).fill('已查核');page.get_by_role('button',name='儲存盤差原因',exact=True).click();expect(page.get_by_role('dialog',name='儲存未完成')).to_be_visible();page.get_by_role('button',name='返回編輯').click();expect(page.get_by_label('商品甲 盤差原因')).to_have_value('已查核');page.get_by_role('button',name='儲存盤差原因',exact=True).click();expect(page.get_by_text('盤差原因已儲存',exact=True)).to_be_visible()
 page.get_by_label('門檻',exact=True).fill('150');page.get_by_role('button',name='儲存門檻',exact=True).click();expect(page.get_by_text('門檻已儲存',exact=True)).to_be_visible()
 with page.expect_download() as d:page.get_by_role('button',name='匯出原因 Excel').click()
 d.value.save_as('.tmp-check/inventory-reasons.xlsx');page.get_by_label('匯入盤差原因',exact=True).set_input_files('.tmp-check/inventory-reasons.xlsx');expect(page.get_by_text('已載入 2 筆原因，請核對後儲存')).to_be_visible()
 # Imported values match current drafts, so the view remains switchable.
 page.get_by_label('報表檢視',exact=False).select_option('recount_changes');expect(page.get_by_role('columnheader',name='第一次盤差量')).to_be_visible();page.get_by_label('報表檢視',exact=False).select_option('merged');expect(page.get_by_label('商品甲 盤差原因',exact=True)).to_have_count(0)
 page.get_by_label('報表檢視',exact=False).select_option('batch');expect(page.get_by_label('商品甲 盤差原因',exact=True)).to_be_visible();page.screenshot(path='.tmp-check/inventory-analysis-data-desktop.png');page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/inventory-analysis-data-mobile.png');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.locator('.batch-information').get_by_role('button',name='刪除',exact=True).click();page.get_by_role('dialog',name='刪除盤點批次').get_by_role('button',name='取消',exact=True).click();assert not any(w['method']=='DELETE' for w in writes)
 page.locator('.batch-information').get_by_role('button',name='刪除',exact=True).click();page.get_by_role('button',name='確認刪除',exact=True).click();expect(page.get_by_role('dialog',name='刪除盤點批次')).to_have_count(0);assert any(w['method']=='DELETE' for w in writes)
 assert not errors,errors
 print('PASS real DEV report access; simulated analysis filters, threshold PATCH, reason export/import/save failure recovery, merged/recount views, delete cancel/confirm, responsive render; no database writes');b.close()
