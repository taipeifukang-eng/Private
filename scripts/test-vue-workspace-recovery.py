import json, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path.cwd();DATA=json.loads((ROOT/'.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'));BASE='http://localhost:5173';RESULTS=[]
def passed(s): RESULTS.append(s);print('PASS '+s,flush=True)
def login(ctx,key='editor'):
 a=next(a for a in DATA['accounts'] if a['key']==key)
 assert ctx.request.post(BASE+'/api/workspace/login',data={'email':a['email'],'password':a['password']},headers={'Origin':BASE}).status==200
def panel(p):return p.locator('[role=tabpanel]:visible')
def revoke_viewer(active):
 source="""require('@next/env').loadEnvConfig(process.cwd(),true);const e=process.env;if(new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname!=='mjpdfpxqttbhzeimmtqr.supabase.co')throw Error('DEV mismatch');const c=require('@supabase/supabase-js').createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});(async()=>{const r=await c.from('roles').update({is_active:ACTIVE}).eq('code','vue_workspace_viewer');if(r.error)process.exitCode=1;})();""".replace('ACTIVE','true' if active else 'false')
 subprocess.run(['node','-e',source],check=True,capture_output=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);ctx=b.new_context(viewport={'width':1366,'height':900});login(ctx);page=ctx.new_page();page.goto(BASE,wait_until='networkidle');expect(page.get_by_role('heading',name='開始今天的營運作業')).to_be_visible()
 record=ctx.request.get(BASE+'/api/workspace/campaigns?id='+DATA['campaignId']).json()['records'][0]
 statuses=page.evaluate("""async record=>await Promise.all([1,2].map(()=>fetch('/api/workspace/campaigns',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...record,version:record.workspace_version})}).then(r=>r.status)))""",record)
 assert sorted(statuses)==[200,409];passed('simultaneous compare-and-swap writes yield one winner')
 page.get_by_role('button',name='巡店列表',exact=True).click();expect(panel(page).locator('tbody tr')).to_have_count(2,timeout=30000)
 panel(page).get_by_role('textbox',name='月份',exact=True).fill('2099-12');panel(page).get_by_role('button',name='查詢紀錄').click();expect(panel(page).get_by_role('heading',name='這個月份沒有巡店紀錄')).to_be_visible(timeout=30000);passed('empty query is distinct from failure')
 page.route('**/api/workspace/inspections?*',lambda r:r.abort());panel(page).get_by_role('button',name='重新整理').click();expect(panel(page).get_by_role('alert')).to_contain_text('連線中斷',timeout=30000)
 page.unroute('**/api/workspace/inspections?*');panel(page).get_by_role('textbox',name='月份',exact=True).fill(DATA['month']);panel(page).get_by_role('button',name='查詢紀錄').click();expect(panel(page).locator('tbody tr')).to_have_count(2,timeout=30000);passed('network failure and successful retry')
 for suffix in ['一','二']:
  page.get_by_role('button',name='活動管理',exact=True).click();panel(page).get_by_role('button',name='新增活動').click();panel(page).get_by_label('活動名稱',exact=False).fill('[Vue 測試] 批次關閉'+suffix);panel(page).get_by_label('開始日期',exact=False).fill(DATA['month']+'-02');panel(page).get_by_label('結束日期',exact=False).fill(DATA['month']+'-20')
 page.locator('summary[aria-label="頁籤管理"]').click();page.get_by_role('button',name='關閉全部頁籤',exact=True).click();expect(page.get_by_role('dialog').locator('li')).to_have_count(2);page.get_by_role('button',name='繼續編輯',exact=True).click();expect(page.get_by_role('tab')).to_have_count(5);passed('batch close lists both drafts and cancel preserves all tabs')
 # Close all, save both drafts, then verify fresh reopening.
 page.get_by_role('button',name='關閉全部頁籤',exact=True).click();page.get_by_role('button',name='全部儲存後關閉',exact=True).click();expect(page.get_by_role('dialog')).to_have_count(0,timeout=30000);expect(page.get_by_role('tab')).to_have_count(0);passed('batch save completes before tabs are destroyed')
 page.get_by_role('button',name='活動管理',exact=True).click();expect(panel(page).locator('tbody tr')).not_to_have_count(0,timeout=30000);panel(page).get_by_role('button',name='新增活動').click();expect(panel(page).get_by_label('活動名稱',exact=False)).to_have_value('');passed('reopened form has no abandoned cache')
 # keyboard modal focus and expiry preserve draft until explicit logout.
 panel(page).get_by_label('活動名稱',exact=False).fill('[Vue 測試] 過期保留草稿');ctx.clear_cookies();assert ctx.request.get(BASE+'/api/workspace/session').status==401
 page.evaluate("window.dispatchEvent(new Event('focus'))");expect(page.locator('.session-notice')).to_contain_text('登入已過期',timeout=30000);expect(page.locator('.work-page:visible .edit-form')).not_to_be_visible();passed('expired session conceals data and disables editing')
 page.get_by_role('button',name='離開並重新登入').click();expect(page.get_by_role('dialog')).to_contain_text('[Vue 測試] 過期保留草稿');page.keyboard.press('Escape');expect(page.get_by_role('dialog')).to_have_count(0);passed('expiry logout still asks before discarding drafts')
 page.get_by_role('button',name='離開並重新登入').click();page.get_by_role('button',name='放棄修改並登出').click();expect(page.get_by_role('heading',name='登入測試工作區')).to_be_visible(timeout=30000);passed('expired session can log out and return to login')
 viewer=b.new_context();login(viewer,'viewer')
 try:
  revoke_viewer(False);assert viewer.request.get(BASE+'/api/workspace/inspections?month='+DATA['month']).status==403;passed('role revocation enforced without relogin')
 finally:revoke_viewer(True)
 denied=b.new_context(viewport={'width':390,'height':844});login(denied,'denied');dp=denied.new_page();dp.goto(BASE,wait_until='networkidle');expect(dp.get_by_text('你目前沒有巡店或活動管理權限。')).to_be_visible();dp.screenshot(path=str(ROOT/'.tmp-check/no-access-mobile.png'),full_page=True);passed('no-access user sees explicit permission state')
 b.close()
(ROOT/'.tmp-check/workspace-recovery-results.json').write_text(json.dumps({'passed':RESULTS},ensure_ascii=False,indent=2),encoding='utf-8')
