import json,subprocess,os,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright
B='http://localhost:3002';M='2099-11'
subprocess.run(['node','scripts/test-workspace-monthly-fixtures.cjs','check'],check=True)
subprocess.run(['node','scripts/test-workspace-monthly-excel.cjs'],check=True)
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(base_url=B)
 assert c.request.post('/api/workspace/login',data={'email':os.environ.get('WORKSPACE_TEST_ACCOUNT','administrator'),'password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 store=c.request.get('/api/workspace/monthly?month='+M).json()['stores'][0]['id']
 def get(op,kind=''):
  r=c.request.get(f'/api/workspace/monthly/tools?store={store}&month={M}&op={op}&kind={kind}');assert r.ok,(r.status,r.text());return r.json()
 def post(op,**data):return c.request.post('/api/workspace/monthly/tools',data={'store':store,'month':M,'op':op,**data},headers={'Origin':B})
 try:
  employee={'employee_code':'WK-MONTH-CHECK','employee_name':'月結驗證暫存','position':'專員','employment_type':'full_time','monthly_status':'full_month','work_days':30,'work_hours':0,'is_pharmacist':False}
  request_id=str(uuid.uuid4());r=post('manual',employee=employee,requestId=request_id);assert r.ok,(r.status,r.text());print('manual PASS')
  assert post('manual',employee=employee,requestId=request_id).ok
  assert post('manual',employee=employee,requestId=str(uuid.uuid4())).status==409
  print('manual retry/duplicate PASS')
  updates={k:0 for k in ['total_staff_count','admin_staff_count','newbie_count','business_days','total_gross_profit','total_customer_count','prescription_addon_only_count','regular_prescription_count','chronic_prescription_count']};updates.update(total_staff_count=1,business_days=30,total_gross_profit=90000,total_customer_count=900)
  r=post('stats',updates=updates,version=None);assert r.ok,(r.status,r.text());print('stats PASS')
  meta=get('meta');r=post('supportHours',version=meta['version'],updates={'support_to_other_stores_hours':2.5,'support_from_other_stores_hours':3});assert r.ok,(r.status,r.text());print('support hours PASS')
  assert post('supportHours',version=meta['version'],updates={'support_to_other_stores_hours':99,'support_from_other_stores_hours':99}).status==409
  samples={'support':{'bonus_amount':123},'transport':{'monthly_transport_expense':90,'transport_expense_notes':'測試往返'},'talent':{'cultivation_bonus':200,'cultivation_target':'測試對象'},'spring':{'attendance_date':'2099-11-01','category':'專員','bonus_amount':1500},'meal':{'record_date':'11/01','work_hours':'09:00-18:00','meal_period':'中餐','employee_type':'非藥師'}}
  for kind,values in samples.items():
   data=get('allowance',kind);row={**employee,**values}
   r=post('allowance',kind=kind,records=[row],expected=data['expected']);assert r.ok,(kind,r.status,r.text());print(kind,'save PASS')
   after=get('allowance',kind);assert len(after['records'])==1
   stale=post('allowance',kind=kind,records=[row],expected=data['expected']);assert stale.status==409,(kind,stale.status,stale.text())
   invalid=post('allowance',kind=kind,records=[{**row,'employee_name':''}],expected=after['expected']);assert invalid.status==400
   assert get('allowance',kind)['expected']==after['expected']
  for kind,path,key in [('stats','monthly-stats.xlsx','file'),('performance','monthly-performance.xlsx','file1')]:
   r=c.request.post('/api/workspace/monthly/tools',multipart={'kind':kind,'month':M,key:{'name':path,'mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':Path('.tmp-check/'+path).read_bytes()}},headers={'Origin':B})
   assert r.ok,(kind,r.status,r.text());result=r.json();assert result.get('success',True),(kind,result)
   assert not result.get('errors'),result
   if kind=='stats':assert result['details']['success']==1 and result['details']['failed']==0,result
   else:assert result['updated']==1,result
   print(kind,'Excel import PASS')
  assert post('pdf').ok;print('PDF data PASS')
  r=c.request.post('/api/workspace/monthly',data={'action':'submit','store':store,'month':M},headers={'Origin':B});assert r.ok,(r.status,r.text());print('submit PASS')
  assert post('manual',employee=employee,requestId=str(uuid.uuid4())).status==409
  assert post('allowance',kind='support',records=[],expected=get('allowance','support')['expected']).status==409
  assert c.request.post('/api/workspace/monthly/tools',data={'op':'pdf','month':M,'store':store},headers={'Origin':'https://invalid.test'}).status==403
  assert c.request.get(f'/api/workspace/monthly/tools?op=meta&month={M}&store=00000000-0000-0000-0000-000000000000').status==403
  print('locked month, origin and store guards PASS')
 finally:
  b.close();subprocess.run(['node','scripts/test-workspace-monthly-fixtures.cjs','clean'],check=True)
