import json,re,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path.cwd();D=json.loads((ROOT/'.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'));F=json.loads((ROOT/'.tmp-check/five-module-fixtures.json').read_text());BASE='http://localhost:3002';results=[];target=int(time.time())%100000
def passed(t):results.append(t);print('PASS '+t,flush=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);ctx=b.new_context(viewport={'width':1440,'height':950});a=next(x for x in D['accounts'] if x['key']=='navigation');headers={'Origin':BASE}
 assert ctx.request.post(BASE+'/api/workspace/login',data={'email':a['email'],'password':a['password']},headers=headers).ok
 session=ctx.request.get(BASE+'/api/workspace/session').json();kinds={i.get('kind') for g in session['navigation'] for i in g['items']};assert {'monthly','inspections','campaigns','performance','inventory'}.issubset(kinds);passed('five priority menus are native Vue kinds')
 # Authorization fails before any data access, including writes.
 v=b.new_context();a=next(x for x in D['accounts'] if x['key']=='viewer');assert v.request.post(BASE+'/api/workspace/login',data={'email':a['email'],'password':a['password']},headers=headers).ok
 for module in ['monthly?month=2026-10','performance?year=2026','inventory?year_month=2026-10']:
  assert v.request.get(BASE+'/api/workspace/'+module).status==403
 for module in ['monthly','performance','inventory']:
  assert v.request.post(BASE+'/api/workspace/'+module,data={},headers=headers).status==403
 passed('limited account cannot read or write new modules')
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(BASE+'/workspace/index.html',wait_until='networkidle');expect(page.get_by_role('heading',name='開始今天的營運作業')).to_be_visible();page.get_by_label('新頁預設門市').select_option(F['store'])
 def open_module(label):
  page.get_by_label('搜尋功能').fill(label);page.get_by_role('navigation').get_by_role('button',name=re.compile('^'+label)).click();return page.locator('[role=tabpanel]:visible')
 panel=open_module('每月人員狀態');expect(panel.get_by_text('Vue 人員測試',exact=True)).to_be_visible(timeout=60000);panel.get_by_role('button',name='編輯出勤').click();edit=page.locator('[role=tabpanel]:visible');expect(edit.get_by_role('button',name='儲存出勤資料')).to_be_visible(timeout=30000);edit.get_by_label('備註',exact=True).fill('Vue 原生測試草稿');title=page.get_by_role('tab',selected=True).inner_text();open_module('業績管理');page.get_by_role('tab',name=re.compile('^人員 · Vue 人員測試')).click();expect(page.locator('[role=tabpanel]:visible').get_by_label('備註',exact=True)).to_have_value('Vue 原生測試草稿');passed('monthly draft survives cross-module switching')
 page.get_by_role('button',name='關閉 人員 · Vue 人員測試',exact=True).click();expect(page.get_by_role('dialog')).to_be_visible();page.get_by_role('button',name='繼續編輯').click();page.locator('[role=tabpanel]:visible').get_by_role('button',name='儲存出勤資料').click();expect(page.locator('[role=tabpanel]:visible').get_by_text('已儲存',exact=True)).to_be_visible(timeout=30000);passed('monthly close confirmation and real save')
 r=ctx.request.get(BASE+f'/api/workspace/monthly?month=2026-10&store={F["store"]}').json();row=next(r for r in r['records'] if r['id']==F['staff']);body={'action':'save','store':F['store'],'month':'2026-10','id':row['id'],'version':row['updated_at'],'updates':{'work_days':row['work_days'],'work_hours':row['work_hours'],'notes':'Vue 原生測試資料'}}
 assert ctx.request.post(BASE+'/api/workspace/monthly',data=body,headers=headers).ok;assert ctx.request.post(BASE+'/api/workspace/monthly',data=body,headers=headers).status==409;passed('monthly stale write rejected atomically')
 panel=open_module('業績管理');expect(panel.locator('tbody tr')).to_have_count(12,timeout=30000);panel.locator('tbody tr').first.get_by_role('button',name='編輯',exact=True).click();editor=page.locator('[role=tabpanel]:visible');expect(editor.get_by_role('button',name='儲存業績')).to_be_visible(timeout=30000);editor.get_by_label('毛利目標',exact=True).fill(str(target));editor.get_by_role('button',name='儲存業績').click();expect(editor.get_by_text('已儲存',exact=True)).to_be_visible(timeout=30000);passed('performance month edited and saved from Vue form')
 perf=ctx.request.get(BASE+f'/api/workspace/performance?year=2026&store_id={F["store"]}').json();row=next(r for r in perf['records'] if r['month']==1);assert row['monthly_gross_profit_target']==target
 assert ctx.request.post(BASE+'/api/workspace/performance',data=row,headers=headers).ok;assert ctx.request.post(BASE+'/api/workspace/performance',data=row,headers=headers).status==409;passed('performance conflict rejects stale version')
 panel=open_module('盤點管理');expect(panel.get_by_role('button',name='查詢盤點')).to_be_enabled(timeout=30000);panel.get_by_text('匯入盤點 Excel',exact=True).click();panel.get_by_label('盤點 Excel 檔案').set_input_files(str(ROOT/'.tmp-check/vue-native-inventory.xlsx'));panel.get_by_role('button',name='匯入報表').click();expect(panel.get_by_text('盤點報表已匯入',exact=True)).to_be_visible(timeout=60000);expect(panel.get_by_text('Vue 測試品',exact=False)).to_be_visible();panel.get_by_label('Vue 測試品 盤差原因').fill('Vue 盤差原因測試');panel.get_by_role('button',name='儲存盤差原因').click();expect(panel.get_by_text('盤差原因已儲存')).to_be_visible(timeout=30000);passed('inventory workbook import and difference reason save')
 with page.expect_download() as download:panel.get_by_role('button',name='匯出目前明細').click()
 assert download.value.suggested_filename.endswith('.csv');passed('inventory visible detail export')
 page.screenshot(path=str(ROOT/'.tmp-check/five-inventory.png'),full_page=True)
 panel=open_module('巡店列表');expect(panel.get_by_role('button',name='查看明細').first).to_be_visible(timeout=30000);panel.get_by_role('button',name='查看明細').first.click();expect(page.locator('[role=tabpanel]:visible').get_by_role('heading',name='巡店紀錄明細')).to_be_visible();passed('inspection details open in native work tab')
 panel=open_module('活動管理');expect(panel.get_by_role('button',name='門市排程').first).to_be_visible(timeout=30000);panel.get_by_role('button',name='門市排程').first.click();schedule=page.locator('[role=tabpanel]:visible');expect(schedule.get_by_role('heading',name='活動門市排程')).to_be_visible();expect(schedule.get_by_role('button',name='重新整理')).to_be_enabled(timeout=30000);schedule.get_by_label('門市',exact=True).select_option(F['store']);schedule.get_by_label('活動日期').fill('2026-10-28');schedule.get_by_role('button',name='儲存排程').click();expect(schedule.get_by_text('排程已儲存',exact=True)).to_be_visible(timeout=30000);passed('campaign schedule saved in native tab')
 assert len(ctx.pages)==1 and page.locator('iframe').count()==0 and '/workspace/index.html' in page.url;passed('five modules never leave shell or embed legacy UI')
 panel=open_module('每月人員狀態');expect(panel.get_by_text('Vue 人員測試',exact=True)).to_be_visible(timeout=30000);page.screenshot(path=str(ROOT/'.tmp-check/five-monthly.png'),full_page=True)
 page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');page.screenshot(path=str(ROOT/'.tmp-check/five-mobile.png'),full_page=True);assert not errors,errors;passed('desktop and mobile no page overflow or browser errors')
 b.close()
(ROOT/'.tmp-check/five-modules-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
