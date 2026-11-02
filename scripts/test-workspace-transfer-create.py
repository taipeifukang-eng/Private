import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';f=json.loads(Path('.tmp-check/transfer-roles-fixture.json').read_text());expect.set_options(timeout=30000)
with sync_playwright() as p:
    browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1440,'height':1000},extra_http_headers={'Origin':B})
    user=next(u for u in f['users'] if u['key']=='create')
    assert c.request.post('/api/workspace/login',data={'email':user['email'],'password':user['password']}).ok
    data={'employee_code':'VTC'+f['created'][0][:8],'employee_name':'調店新增驗證','from_store_id':f['stores'][0]['id'],'to_store_id':f['stores'][1]['id'],'notes':'新增測試\n第二行'}
    body={'requestId':f['created'][0],'data':data}
    assert c.request.get('/api/workspace/transfers/create').ok
    assert c.request.post('/api/workspace/transfers/create',data=body,headers={'Origin':'https://invalid.example'}).status==403
    assert c.request.post('/api/workspace/transfers/create',data={**body,'data':{**data,'to_store_id':data['from_store_id']}}).status==400
    r=c.request.post('/api/workspace/transfers/create',data=body);assert r.ok,r.text()
    assert c.request.post('/api/workspace/transfers/create',data=body).json()['alreadyCreated'] is True
    assert c.request.post('/api/workspace/transfers/create',data={**body,'data':{**data,'notes':'changed'}}).status==409
    limited=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});u=next(u for u in f['users'] if u['key']=='confirm')
    assert limited.post('/api/workspace/login',data={'email':u['email'],'password':u['password']}).ok
    assert limited.get('/api/workspace/transfers/create').status==403
    assert limited.post('/api/workspace/transfers/create',data=body).status==403
    page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    # Fixed fixture ID makes UI cleanup exact, including failures after the server commits.
    page.add_init_script('crypto.randomUUID = () => '+json.dumps(f['created'][1]))
    page.goto('/workspace/index.html');page.locator('.sidebar').hover();page.locator('.nav-search input').fill('調店申請');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='調店申請 新版',exact=True).click()
    panel=page.locator('[role=tabpanel]:visible');panel.get_by_role('button',name='新增調店申請',exact=True).click();form=panel.locator('.transfer-create')
    form.get_by_label('員編',exact=True).fill(data['employee_code']+'U');form.get_by_label('姓名',exact=True).fill('調店新增畫面驗證')
    form.get_by_label('原任職門市',exact=True).select_option(data['from_store_id']);form.get_by_label('新任職門市',exact=True).select_option(data['to_store_id']);form.get_by_label('備註',exact=True).fill(data['notes'])
    form.get_by_role('button',name='取消新增',exact=True).click();page.get_by_role('dialog').get_by_role('button',name='繼續填寫').click();expect(form.get_by_label('姓名',exact=True)).to_have_value('調店新增畫面驗證')
    page.screenshot(path='.tmp-check/transfer-create-desktop.png');page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.tmp-check/transfer-create-mobile.png');page.set_viewport_size({'width':1440,'height':1000})
    form.get_by_role('button',name='核對並送出',exact=True).click();page.get_by_role('dialog').get_by_role('button',name='返回修改').click();form.get_by_role('button',name='核對並送出',exact=True).click();page.get_by_role('dialog').get_by_role('button',name='確認送出',exact=True).click()
    expect(panel.locator('.notice[role=status]')).to_contain_text('已送出');expect(panel.locator('tbody')).to_contain_text('調店新增畫面驗證')
    rows=c.request.get('/api/workspace/transfers?status=pending').json()['rows'];saved=[r for r in rows if r['id'] in f['created']];assert len(saved)==2
    assert all(r['created_by']==user['id'] and r['effective_date'] is None and r['movement_history_id'] is None for r in saved)
    assert not errors,errors
    print('PASS transfer create: real permissions/catalog, invalid stores, Origin, idempotency/conflict, UI cancel/review/submit/readback and mobile layout')
    browser.close()
