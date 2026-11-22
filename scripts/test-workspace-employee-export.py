import json,io
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from types import SimpleNamespace
class Sheet:
 def __init__(self,content):
  ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
  with ZipFile(io.BytesIO(content)) as z:
   strings=[]
   if 'xl/sharedStrings.xml' in z.namelist():strings=[''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]
   root=ET.fromstring(z.read('xl/worksheets/sheet1.xml'));self.rows=[];self.cells={}
   for row in root.findall('s:sheetData/s:row',ns):
    values=[]
    for c in row.findall('s:c',ns):
     value=c.findtext('s:v',None,ns);kind=c.get('t')
     if kind=='s':value=strings[int(value)]
     if kind=='inlineStr':value=''.join(c.find('s:is',ns).itertext())
     cell=SimpleNamespace(value=value,data_type='f' if c.find('s:f',ns) is not None else 's' if kind in ('s','str','inlineStr') else kind)
     self.cells[c.get('r')]=cell;values.append(value)
    self.rows.append(tuple(values))
  self.max_row=len(self.rows)
 def values(self):return self.rows
 def __getitem__(self,key):return self.cells[key]
 def __iter__(self):return iter([[self.cells[k] for k in self.cells]])

from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts'];expect.set_options(timeout=30000)
labels={'active':'在職','resigned':'離職','full_month':'整月在職','new_hire':'新進','leave_of_absence':'留職停薪','leave_without_pay':'留職停薪','transferred_in':'調入','transferred_out':'調出','promoted':'升職','support_rotation':'支援卡班','dual_store_manager':'擔任雙店長','leave_return':'留停復職'}
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1440,'height':1000});a=next(a for a in accounts if a['key']=='navigation');assert c.request.post('/api/workspace/login',data={'email':a['email'],'password':a['password']},headers={'Origin':B}).ok
 real=c.request.get('/api/workspace/employees').json();page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def open_directory():
  page.goto('/workspace/index.html');page.locator('.sidebar').hover();page.locator('.nav-search input').fill('員工名冊');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='員工名冊 新版',exact=True).click()
 def download():
  with page.expect_download() as info:page.locator('[role=tabpanel]:visible').get_by_role('button',name='匯出篩選結果 Excel',exact=True).click()
  d=info.value;sheet=Sheet(Path(d.path()).read_bytes());d.delete();return sheet
 open_directory();panel=page.locator('[role=tabpanel]:visible');expect(panel.locator('tbody tr').first).to_be_visible();sheet=download();actual=sheet.values();assert actual[0]==('員編','姓名','當前職位','狀態','到職日','生日')
 expected=[(e['employee_code'],e['employee_name'],e['current_position'] or None,labels.get(e['current_status'],e['current_status']) or ('在職' if e['is_active'] else '離職'),e['start_date'] or None,e['birthday'] or None) for e in real['employees']]
 # Empty strings may be represented as None by Excel readers.
 normalize=lambda row:tuple(v if v!='' else None for v in row)
 assert [normalize(r) for r in actual[1:]]==expected
 selected=real['employees'][0];panel.get_by_label('搜尋員工',exact=True).fill(selected['employee_code']);sheet=download();assert all(selected['employee_code'].lower() in ' '.join(str(v or '') for v in r[:3]).lower() for r in sheet.values()[1:])
 page.screenshot(path='.tmp-check/employee-export-desktop.png');page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.tmp-check/employee-export-mobile.png')
 # Explicit API fixture: exercise > one page and literal spreadsheet content without DB writes.
 rows=[{'employee_code':str(i).zfill(6),'employee_name':'=1+1' if i==0 else '匯出測試'+str(i),'current_position':'專員','current_status':'full_month','is_active':True,'start_date':'2020-02-29','birthday':'1990-01-02'} for i in range(205)]
 page.route('**/api/workspace/employees',lambda route:route.fulfill(json={**real,'employees':rows,'total':205,'active':205}));page.set_viewport_size({'width':1440,'height':1000});open_directory();expect(panel.get_by_text('符合 205 / 205 位員工',exact=True)).to_be_visible();expect(panel.locator('tbody tr')).to_have_count(100);panel.get_by_role('button',name='下一頁',exact=True).click();sheet=download();assert sheet.max_row==206;assert sheet['A2'].value=='000000' and sheet['A2'].data_type=='s';assert sheet['B2'].value=='=1+1' and sheet['B2'].data_type=='s';assert sheet['E2'].value=='2020-02-29';assert sheet['D2'].value=='整月在職';assert all(cell.data_type!='f' for row in sheet for cell in row)
 panel.get_by_label('搜尋員工',exact=True).fill('不存在的員工');expect(panel.get_by_role('button',name='匯出篩選結果 Excel',exact=True)).to_be_disabled();assert not errors,errors
 print('PASS real Excel matches directory/filter; 205-row fixture exports all pages, text codes/dates/literal formula names, empty state and responsive layout');browser.close()
