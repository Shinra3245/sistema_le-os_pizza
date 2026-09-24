import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dataDir = await mkdtemp(path.join(tmpdir(), 'pizzas-pos-'));
const port = 4198;
let processServer;
let cookie = '';
let csrfToken = '';

const call = async (route, options = {}) => {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { 'content-type':'application/json', cookie, ...(options.headers || {}) };
  if (options.csrf !== false && ['POST','PUT','PATCH','DELETE'].includes(method) && csrfToken) headers['x-csrf-token'] = csrfToken;
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const type = response.headers.get('content-type') || '';
  const body = type.includes('json') ? await response.json() : await response.text();
  if (body?.csrfToken) csrfToken = body.csrfToken;
  return { response, body };
};

const pizzaItem = (boot, overrides = {}) => {
  const product = boot.catalog.find(item => item.kind === 'pizza' && item.active !== false);
  const size = boot.settings.pizzaSizes.find(item => item.active !== false);
  return { productId:product.id, quantity:1, note:'', configuration:{ type:'pizza', size:size.id, mode:'completa', leftProductId:product.id, rightProductId:product.id, cheeseRim:false }, ...overrides };
};

const dishItem = (product, overrides = {}) => ({
  productId:product.id, quantity:1, note:'',
  configuration:{
    type:'dish',
    choices:Object.fromEntries((product.choiceGroups || []).filter(group => !(product.category === 'hamburguesas' && group.label === 'Queso')).map(group => [group.label,group.options[0]])),
    variant:product.variants?.[0]?.label || '', excludedIngredients:[]
  },
  ...overrides
});

before(async () => {
  processServer = spawn(process.execPath, ['server/server.mjs'], { cwd:process.cwd(), env:{ ...process.env, DATA_DIR:dataDir, PORT:String(port) } });
  await new Promise((resolve, reject) => {
    const timer=setTimeout(()=>reject(new Error('El servidor de prueba no inició.')),5000);
    processServer.stdout.on('data', data => { if (String(data).includes('listo en')) { clearTimeout(timer); resolve(); } });
    processServer.on('error',reject);
  });
  let result=await call('/api/auth/setup',{method:'POST',body:JSON.stringify({username:'pizzas',password:'Prueba-segura1'})});
  assert.equal(result.response.status,201);
  result=await call('/api/bootstrap');
  assert.equal(result.response.status,200);
  assert.match(csrfToken,/^[a-f0-9]{64}$/);
  result=await call('/api/cash/open',{method:'POST',body:JSON.stringify({openingCash:100,note:'prueba'})});
  assert.equal(result.response.status,201);
});

after(async () => { processServer?.kill(); await rm(dataDir,{recursive:true,force:true}); });

test('reconstruye productos y precios, separa estaciones y cumple el flujo de domicilio', async () => {
  const boot=(await call('/api/bootstrap')).body;
  const burger=boot.catalog.find(product=>product.category==='hamburguesas');
  const drink=boot.catalog.find(product=>product.category==='bebidas');
  const items=[pizzaItem(boot,{unitPrice:-500,name:'Manipulado'}),dishItem(burger,{unitPrice:-500,station:'Resto'}),dishItem(drink,{unitPrice:-500})];
  const created=await call('/api/orders',{method:'POST',body:JSON.stringify({type:'domicilio',customerName:'Cliente prueba',phone:'9999999999',address:'Calle 1',items})});
  assert.equal(created.response.status,201);
  assert.equal(created.body.phone,'999-999-9999');
  assert.deepEqual(created.body.tickets.map(ticket=>ticket.station),['Pizzas','Platillos','Bebidas']);
  assert.ok(created.body.items.every(item=>item.unitPrice>0));
  assert.ok(created.body.items.every(item=>item.station!=='Resto'));

  const addition=await call(`/api/orders/${created.body.id}`,{method:'PATCH',body:JSON.stringify({addItems:true,items:[dishItem(burger)]})});
  assert.equal(addition.response.status,200);
  assert.equal(addition.body.items.length,4);
  assert.equal(addition.body.items.at(-1).station,'Platillos');
  const earlyPayment=await call(`/api/orders/${created.body.id}`,{method:'PATCH',body:JSON.stringify({payment:{method:'Efectivo',received:9999,tipType:'ninguna',tipValue:0}})});
  assert.equal(earlyPayment.response.status,409);
  const prepared=await call(`/api/orders/${created.body.id}`,{method:'PATCH',body:JSON.stringify({finishAllTickets:true})});
  assert.ok(prepared.body.tickets.every(ticket=>ticket.status==='listo'));
  const dispatched=await call(`/api/orders/${created.body.id}`,{method:'PATCH',body:JSON.stringify({dispatchDelivery:true})});
  assert.equal(dispatched.body.status,'en_ruta');
  const settled=await call(`/api/orders/${created.body.id}`,{method:'PATCH',body:JSON.stringify({payment:{method:'Efectivo',received:9999,tipType:'ninguna',tipValue:0}})});
  assert.equal(settled.body.status,'cerrado');
  assert.equal(settled.body.paid,true);
  assert.ok(settled.body.payment.total>0);
});

test('rechaza metadatos incompletos, productos inexistentes y cantidades inválidas', async () => {
  const boot=(await call('/api/bootstrap')).body;
  const burger=boot.catalog.find(product=>product.category==='hamburguesas');
  const item=dishItem(burger);
  for (const payload of [
    {type:'domicilio',customerName:'',phone:'9999999999',address:'Calle 1',items:[item]},
    {type:'domicilio',customerName:'Cliente',phone:'123',address:'Calle 1',items:[item]},
    {type:'domicilio',customerName:'Cliente',phone:'9999999999',address:'',items:[item]},
    {type:'mesa',table:'999',guests:2,items:[item]},
    {type:'mesa',table:'2',guests:0,items:[item]},
    {type:'recoger',customerName:'Cliente',phone:'9999999999',items:[{productId:'no-existe',quantity:1,unitPrice:-500,configuration:{type:'dish'}}]},
    {type:'recoger',customerName:'Cliente',phone:'9999999999',items:[dishItem(burger,{quantity:-3})]}
  ]) {
    const result=await call('/api/orders',{method:'POST',body:JSON.stringify(payload)});
    assert.ok([400,409].includes(result.response.status),JSON.stringify(result.body));
  }
});

test('permite alitas o boneless mitad de un sabor y mitad de otro', async () => {
  const boot=(await call('/api/bootstrap')).body;
  const wings=boot.catalog.find(product=>product.category==='alitas_boneless');
  const presentation=wings.choiceGroups.find(group=>group.label==='Presentación').options[0];
  const flavors=wings.choiceGroups.find(group=>group.label==='Sabor').options;
  const item=dishItem(wings,{configuration:{type:'dish',choices:{Presentación:presentation,Sabor:'dato manipulado'},flavorMode:'mitades',leftFlavor:flavors[1],rightFlavor:flavors[3],excludedIngredients:[]}});
  const created=await call('/api/orders',{method:'POST',body:JSON.stringify({type:'mesa',table:'5',guests:2,items:[item]})});
  assert.equal(created.response.status,201);
  assert.equal(created.body.items[0].unitPrice,wings.price);
  assert.match(created.body.items[0].details,new RegExp(`${flavors[1]} / ${flavors[3]}`));
  assert.equal(created.body.items[0].configuration.flavorMode,'mitades');
  assert.equal(created.body.items[0].configuration.leftFlavor,flavors[1]);
  assert.equal(created.body.items[0].configuration.rightFlavor,flavors[3]);
  const cancelled=await call(`/api/orders/${created.body.id}`,{method:'PATCH',body:JSON.stringify({cancellation:{reason:'Fin de prueba mitad y mitad'}})});
  assert.equal(cancelled.response.status,200);
});

test('impide estados libres, doble mesa, pago anticipado y solicitudes sin CSRF', async () => {
  const boot=(await call('/api/bootstrap')).body;
  const item=pizzaItem(boot);
  const created=await call('/api/orders',{method:'POST',body:JSON.stringify({type:'mesa',table:'3',guests:2,items:[item]})});
  assert.equal(created.response.status,201);
  const duplicate=await call('/api/orders',{method:'POST',body:JSON.stringify({type:'mesa',table:'3',guests:4,items:[item]})});
  assert.equal(duplicate.response.status,409);
  const freeStatus=await call(`/api/orders/${created.body.id}`,{method:'PATCH',body:JSON.stringify({status:'cerrado',paid:true})});
  assert.equal(freeStatus.response.status,400);
  const earlyPayment=await call(`/api/orders/${created.body.id}`,{method:'PATCH',body:JSON.stringify({payment:{method:'Tarjeta',tipType:'ninguna',tipValue:0}})});
  assert.equal(earlyPayment.response.status,409);
  const noCsrf=await call(`/api/orders/${created.body.id}`,{method:'PATCH',csrf:false,body:JSON.stringify({finishAllTickets:true})});
  assert.equal(noCsrf.response.status,403);
  const cancelled=await call(`/api/orders/${created.body.id}`,{method:'PATCH',body:JSON.stringify({cancellation:{reason:'Prueba de control'}})});
  assert.equal(cancelled.body.status,'cancelado');
});

test('no publica código fuente ni metadatos y aplica cabeceras de seguridad', async () => {
  for (const route of ['/package.json','/.git/config','/src/react/App.jsx']) {
    const result=await call(route);
    assert.equal(result.response.status,404,route);
  }
  const page=await call('/');
  assert.equal(page.response.status,200);
  assert.equal(page.response.headers.get('x-frame-options'),'DENY');
  assert.match(page.response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});

test('serializa escrituras concurrentes y conserva permisos privados', async () => {
  const payload={rawMaterials:[{id:'harina',name:'Harina',category:'Secos',stock:12}],categories:['Secos']};
  const writes=await Promise.all(Array.from({length:12},()=>call('/api/raw-materials',{method:'PUT',body:JSON.stringify(payload)})));
  assert.ok(writes.every(result=>result.response.status===200),writes.map(result=>result.response.status).join(','));
  assert.equal((await stat(path.join(dataDir,'restaurante.json'))).mode & 0o777,0o600);
  assert.equal((await stat(path.join(dataDir,'auth.json'))).mode & 0o777,0o600);
  assert.equal((await stat(dataDir)).mode & 0o777,0o700);
  const audit=await readFile(path.join(dataDir,'audit.jsonl'),'utf8');
  assert.match(audit,/"action":"inventory.update"/);
  assert.doesNotMatch(audit,/Prueba-segura1/);
});

test('limita intentos repetidos de acceso', async () => {
  for (let attempt=0;attempt<5;attempt+=1) {
    const failed=await call('/api/auth/login',{method:'POST',body:JSON.stringify({username:'pizzas',password:'Incorrecta1X'})});
    assert.equal(failed.response.status,401);
  }
  const blocked=await call('/api/auth/login',{method:'POST',body:JSON.stringify({username:'pizzas',password:'Incorrecta1X'})});
  assert.equal(blocked.response.status,429);
  assert.ok(Number(blocked.response.headers.get('retry-after'))>0);
});

test('valida catálogo, exportaciones y cierre de caja con ventas digitales', async () => {
  let boot=(await call('/api/bootstrap')).body;
  const invalidCatalog=await call('/api/catalog',{method:'PUT',body:JSON.stringify({catalog:[...boot.catalog,{...boot.catalog[0]}]})});
  assert.equal(invalidCatalog.response.status,400);
  const order=await call('/api/orders',{method:'POST',body:JSON.stringify({type:'mesa',table:'4',guests:2,items:[pizzaItem(boot)]})});
  assert.equal(order.response.status,201);
  await call(`/api/orders/${order.body.id}`,{method:'PATCH',body:JSON.stringify({finishAllTickets:true})});
  const paid=await call(`/api/orders/${order.body.id}`,{method:'PATCH',body:JSON.stringify({payment:{method:'Tarjeta',tipType:'ninguna',tipValue:0}})});
  assert.equal(paid.response.status,200);
  assert.equal(paid.body.payment.total,Math.round(paid.body.payment.subtotal*1.04));
  const pdf=await call('/api/export/pdf');
  assert.equal(pdf.response.status,200); assert.match(pdf.response.headers.get('cache-control'),/no-store/); assert.match(pdf.body,/^%PDF/);
  const excel=await call('/api/export/excel');
  assert.equal(excel.response.status,200); assert.match(excel.response.headers.get('cache-control'),/no-store/); assert.match(excel.body,/Workbook/);
  boot=(await call('/api/bootstrap')).body;
  const session=boot.activeCashSession;
  const payments=boot.orders.filter(entry=>entry.paid&&entry.payment?.cashSessionId===session.id).map(entry=>entry.payment);
  const cashSales=payments.filter(payment=>payment.method==='Efectivo').reduce((sum,payment)=>sum+payment.total,0);
  const totalSales=payments.reduce((sum,payment)=>sum+payment.total,0);
  const close=await call('/api/cash/close',{method:'POST',body:JSON.stringify({countedCash:session.openingCash+cashSales})});
  assert.equal(close.response.status,200);
  assert.equal(close.body.report.expectedCash,session.openingCash+cashSales);
  assert.equal(close.body.report.expectedTurnTotal,session.openingCash+totalSales);
  assert.equal(close.body.report.difference,0);
  const reportPdf=await call(`/api/cash-sessions/${session.id}/report.pdf`);
  assert.equal(reportPdf.response.status,200);
  assert.match(reportPdf.body,/TOTAL TURNO/);
});
