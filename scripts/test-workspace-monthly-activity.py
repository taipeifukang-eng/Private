"""Read-only DEV parity and browser checks; no database fixtures or writes."""
import os, json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
B = 'http://localhost:3002'
with sync_playwright() as p:
 b = p.chromium.launch()
 c = b.new_context(base_url=B, viewport={'width':1500,'height':1000})
 c.set_default_timeout(60000);expect.set_options(timeout=60000)
 assert c.request.post('/api/workspace/login', data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']}, headers={'Origin':B}).ok
 page = c.new_page(); errors=[]
 page.on('pageerror', lambda e: errors.append(str(e)))
 page.goto(B+'/workspace/index.html')
 page.locator('.legacy-quick').get_by_role('button',name='每月人員狀態',exact=True).click()
 page.get_by_role('button',name='查詢人員',exact=True).wait_for()
 page.locator('input[type=month]').fill('2026-09')
 page.get_by_role('button',name='查詢人員',exact=True).click()
 page.get_by_text('1,025,908',exact=True).wait_for()
 page.get_by_role('button',name='活動檢視',exact=True).click()
 dialog=page.get_by_role('dialog',name='活動檢視',exact=True)
 with page.expect_response(lambda r:'op=activityDetail' in r.url, timeout=120000) as response:
  dialog.get_by_role('button',name='查看活動規劃',exact=True).first.click()
 result=response.value.json(); assert response.value.ok,result.get('error')
 assert not result['plan']['errors'],result['plan']['errors']
 cid=result['campaign']['id']; ids={r['store_id'] for r in result['schedules']}
 for key,route in [('details','store-details'),('ownStaff','store-own-staff'),('headcount','store-headcount'),('checklist','checklist-items'),('completions','checklist-completions'),('trips','equipment-trips')]:
  old=c.request.get('/api/campaign-'+route+'?campaign_id='+cid).json()['data']
  if key in ['details','ownStaff','headcount','completions']:old=[r for r in old if r['store_id'] in ids]
  assert result['plan'][key]==old,key
 print('Real campaign readers parity PASS; section row counts:',{k:len(v) for k,v in result['plan'].items() if isinstance(v,list)})
 expect(dialog.get_by_role('heading',name='門市活動排程',exact=True)).to_be_visible()
 assert dialog.locator('.calendar-month').count()>=1
 assert dialog.locator('.weekday').all_text_contents()[:7]==list('一二三四五六日')
 for schedule in result['schedules']:
  assert dialog.locator('[data-date="'+schedule['activity_date']+'"] .store-event').filter(has_text=schedule['store']['store_code']).count()==1
 with page.expect_download() as download:dialog.get_by_role('button',name='匯出排程 PDF',exact=True).click()
 download.value.save_as('.tmp-check/monthly-calendar.pdf')
 import fitz
 pdf=fitz.open('.tmp-check/monthly-calendar.pdf');assert len(pdf)==dialog.locator('.calendar-month').count();pdf[0].get_pixmap(matrix=fitz.Matrix(1,1)).save('.tmp-check/monthly-calendar-pdf.png');pdf.close()
 dialog.screenshot(path='.tmp-check/monthly-calendar-desktop.png')
 dialog.locator('.store-event').first.click()
 detail=page.get_by_role('dialog').filter(has=page.get_by_label('門市規劃明細'))
 for title in ['本店活動人員','支援需求與指派人員','人力預估','前置工作清單']:
  expect(detail.get_by_role('heading',name=title,exact=True)).to_be_visible()
 detail.screenshot(path='.tmp-check/monthly-plan-modal.png')
 detail.get_by_role('button',name='關閉門市規劃').click()
 for button,title in [('活動人力查看','活動人力查看'),('前置 Check List','前置 Check List')]:
  dialog.get_by_role('button',name=button,exact=True).click();overview=page.get_by_role('dialog',name=title,exact=True);expect(overview).to_be_visible();overview.get_by_role('button',name='關閉總覽').click()
 expect(dialog.get_by_role('button',name='設備車次',exact=True)).to_have_count(0)
 expect(dialog.get_by_role('button',name='支援請求／分配',exact=True)).to_have_count(0)
 dialog.get_by_role('button',name='活動人力查看',exact=True).click();people=page.get_by_role('dialog',name='活動人力查看',exact=True)
 expect(people.get_by_role('tab',name='人員配置',exact=True)).to_have_attribute('aria-selected','true')
 people.get_by_role('tab',name='支援請求／分配',exact=True).click();expect(people.get_by_role('tabpanel',name='支援請求／分配')).to_be_visible()
 expect(people.get_by_role('tabpanel',name='人員配置')).to_have_count(0)
 people.screenshot(path='.tmp-check/monthly-people-support.png')
 people.get_by_role('tab',name='支援請求／分配',exact=True).press('ArrowLeft');expect(people.get_by_role('tab',name='人員配置',exact=True)).to_be_focused()
 expect(people.get_by_role('tabpanel',name='人員配置')).to_be_visible();people.get_by_role('button',name='關閉總覽').click()
 for dept in ['行銷部','商品部']:
  dialog.get_by_role('button',name=dept,exact=True).click();d=page.get_by_role('dialog',name=dept+'規劃',exact=True);expect(d).to_be_visible();d.get_by_role('button',name='關閉部門規劃').click()
 page.set_viewport_size({'width':390,'height':844});dialog.locator('.calendar-month').first.scroll_into_view_if_needed();dialog.screenshot(path='.tmp-check/monthly-calendar-mobile.png')
 assert dialog.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
 dialog.get_by_role('button',name='返回活動清單',exact=True).click();dialog.get_by_label('活動年度').fill('2099');expect(dialog.get_by_text('此年度尚無可查看的活動。')).to_be_visible();dialog.get_by_label('活動年度').fill('2026')
 simulated=json.loads(json.dumps(result));simulated['plan']['errors']={'events':'特殊日期讀取失敗，請重試'}
 page.route('**/api/workspace/monthly/tools?*op=activityDetail*',lambda route:route.fulfill(json=simulated))
 dialog.get_by_role('button',name='查看活動規劃',exact=True).first.click();expect(dialog.get_by_role('alert')).to_contain_text('特殊日期');page.unroute_all(behavior='wait');dialog.get_by_role('button',name='重新讀取規劃').click();expect(dialog.get_by_role('alert')).to_have_count(0,timeout=120000)
 dialog.get_by_role('button',name='返回活動清單',exact=True).click()
 sample=json.loads(json.dumps(result));sid=sample['schedules'][0]['store_id'];date=sample['schedules'][0]['activity_date'];sample['schedules'][0]['store'].update(supervisor_id='sample',supervisor_name='圖例測試督導')
 sample['plan'].update({'events':[{'id':'e','event_date':date,'description':'測試特殊日期','is_blocked':True}],
 'ownStaff':[{'id':'o','store_id':sid,'employee_code':'UI001','employee_name':'本店測試人員','position':'店長'}],
 'requests':[{'id':'r','requesting_store_id':sid,'requested_count':2,'supporting_store':{'store_code':'UI','store_name':'支援測試店'}}],
 'supportStaff':[{'id':'p','support_request_id':'r','requesting_store_id':sid,'employee_name':'支援測試人員'}],
 'headcount':[{'store_id':sid,'own_staff_count':1,'extra_support_count':2,'supervisor_count':1,'total':4}],
 'checklist':[{'id':'c','task_name':'測試前置事項','notes':'測試規劃備註'}],
 'completions':[{'store_id':sid,'checklist_item_id':'c','is_completed':True,'manager_note':'測試店長回報'}],
 'trips':[{'id':'t','trip_date':date,'set_number':1,'from_location':'測試起點','to_location':'測試終點'}],
 'departments':{'marketing_content':'測試行銷內容','marketing_rules':'測試行銷規則','merchandise_supply_content':'測試商品供應'}})
 page.route('**/api/workspace/monthly/tools?*op=activityDetail*',lambda route:route.fulfill(json=sample));dialog.get_by_role('button',name='查看活動規劃',exact=True).first.click()
 expect(dialog.get_by_label('督導圖例')).to_contain_text('圖例測試督導');expect(dialog.locator('[data-date="'+date+'"]')).to_contain_text('測試特殊日期');expect(dialog.locator('[data-date="'+date+'"]')).to_contain_text('測試起點')
 dialog.get_by_role('button',name='活動人力查看',exact=True).click();ov=page.get_by_role('dialog',name='活動人力查看',exact=True);expect(ov).to_contain_text('支援測試人員');ov.get_by_role('button',name='關閉總覽').click()
 dialog.get_by_role('button',name='前置 Check List',exact=True).click();ov=page.get_by_role('dialog',name='前置 Check List',exact=True);expect(ov).to_contain_text('測試店長回報');ov.get_by_role('button',name='關閉總覽').click()
 for dept,text in [('行銷部','測試行銷內容'),('商品部','測試商品供應')]:
  dialog.get_by_role('button',name=dept,exact=True).click();d=page.get_by_role('dialog',name=dept+'規劃',exact=True);expect(d).to_contain_text(text);d.get_by_role('button',name='關閉部門規劃').click()
 page.set_viewport_size({'width':1500,'height':1000});dialog.screenshot(path='.tmp-check/monthly-calendar-content.png')
 page.unroute_all(behavior='wait');dialog.get_by_role('button',name='關閉',exact=True).click();assert not errors,errors
 print('PASS calendar/date placement, Monday-first, store modal, staff/support/checklist/departments, empty/error/retry, desktop/mobile. Real read-only parity; populated branches simulated without DB writes.')
 b.close()
