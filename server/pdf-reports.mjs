const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

const colors = {
  cream: '#f6f3eb', paper: '#fffefa', forest: '#315e4b', forestSoft: '#e9f1e9',
  gold: '#b88935', goldSoft: '#f6edd9', ink: '#292d28', muted: '#74786f',
  line: '#e4dfd3', white: '#ffffff', red: '#9b4b3a', redSoft: '#f8e9e4',
  blue: '#476b77', blueSoft: '#e8f0f2'
};

const printable = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\x7e\xa0-\xff]/g, ' ');
const pdfString = value => [...printable(value)].map(character => {
  const code = character.charCodeAt(0);
  if (character === '\\' || character === '(' || character === ')') return `\\${character}`;
  return code > 0x7e ? `\\${code.toString(8).padStart(3,'0')}` : character;
}).join('');
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = value => `$${number(value).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
const dateTime = value => new Date(value).toLocaleString('es-MX', { dateStyle:'medium', timeStyle:'short' });
const shortDate = value => new Date(value).toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'2-digit' });
const shortTime = value => new Date(value).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });
const hex = value => value.replace('#','').match(/../g).map(part => (parseInt(part, 16) / 255).toFixed(3)).join(' ');
const estimateWidth = (value, size, bold = false) => printable(value).length * size * (bold ? .56 : .51);
const fit = (value, width, size, bold = false) => {
  const source = printable(value);
  if (estimateWidth(source, size, bold) <= width) return source;
  let result = source;
  while (result.length && estimateWidth(`${result}...`, size, bold) > width) result = result.slice(0, -1);
  return `${result.trimEnd()}...`;
};

function roundedPath(x, y, width, height, radius = 8) {
  const r = Math.min(radius, width / 2, height / 2); const k = .5522848; const c = r * k;
  return `${x+r} ${y} m ${x+width-r} ${y} l ${x+width-r+c} ${y} ${x+width} ${y+r-c} ${x+width} ${y+r} c ${x+width} ${y+height-r} l ${x+width} ${y+height-r+c} ${x+width-r+c} ${y+height} ${x+width-r} ${y+height} c ${x+r} ${y+height} l ${x+r-c} ${y+height} ${x} ${y+height-r+c} ${x} ${y+height-r} c ${x} ${y+r} l ${x} ${y+r-c} ${x+r-c} ${y} ${x+r} ${y} c h`;
}
const rect = (x,y,w,h,fill,stroke = null,radius = 0) => `q ${hex(fill)} rg ${stroke ? `${hex(stroke)} RG 0.8 w` : ''} ${radius ? roundedPath(x,y,w,h,radius) : `${x} ${y} ${w} ${h} re`} ${stroke ? 'B' : 'f'} Q`;
const line = (x1,y1,x2,y2,color = colors.line,width = .7) => `q ${hex(color)} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S Q`;
const text = (value,x,y,size = 9,{ font='F1', color=colors.ink, align='left', maxWidth=0 } = {}) => {
  const bold = font !== 'F1'; const output = maxWidth ? fit(value,maxWidth,size,bold) : printable(value);
  const position = align === 'right' ? x - estimateWidth(output,size,bold) : align === 'center' ? x - estimateWidth(output,size,bold)/2 : x;
  return `q ${hex(color)} rg BT /${font} ${size} Tf 1 0 0 1 ${position.toFixed(2)} ${y} Tm (${pdfString(output)}) Tj ET Q`;
};
function circle(cx, cy, radius, stroke, width = 1, fill = null) {
  const c = radius * .5522848;
  return `q ${fill ? `${hex(fill)} rg` : ''} ${hex(stroke)} RG ${width} w ${cx+radius} ${cy} m ${cx+radius} ${cy+c} ${cx+c} ${cy+radius} ${cx} ${cy+radius} c ${cx-c} ${cy+radius} ${cx-radius} ${cy+c} ${cx-radius} ${cy} c ${cx-radius} ${cy-c} ${cx-c} ${cy-radius} ${cx} ${cy-radius} c ${cx+c} ${cy-radius} ${cx+radius} ${cy-c} ${cx+radius} ${cy} c ${fill ? 'B' : 'S'} Q`;
}
function logo(cx,cy) {
  return [circle(cx,cy,20,colors.gold,1.5), circle(cx,cy,14,colors.gold,.7), line(cx,cy,cx,cy+14,colors.gold,.8), line(cx,cy,cx-12,cy-7,colors.gold,.8), line(cx,cy,cx+12,cy-7,colors.gold,.8), circle(cx-5,cy+5,1.4,colors.gold,.5,colors.gold), circle(cx+7,cy+3,1.4,colors.gold,.5,colors.gold), circle(cx,cy-7,1.4,colors.gold,.5,colors.gold)].join('\n');
}
function header(title, subtitle, settings, generatedAt) {
  const restaurant = settings?.restaurantName || 'Pizzas a la Leña';
  return [
    rect(0,0,PAGE_WIDTH,PAGE_HEIGHT,colors.cream), rect(0,700,PAGE_WIDTH,92,colors.forest), rect(0,696,PAGE_WIDTH,4,colors.gold),
    logo(55,746), text(restaurant,88,754,16,{font:'F3',color:colors.white,maxWidth:210}), text('RESTAURANTE',89,737,7,{font:'F2',color:colors.gold}),
    text(title,570,752,18,{font:'F2',color:colors.white,align:'right',maxWidth:245}), text(subtitle,570,733,8,{color:'#dce9df',align:'right',maxWidth:245}),
    text(`Generado: ${dateTime(generatedAt)}`,570,714,7,{color:'#dce9df',align:'right'})
  ].join('\n');
}
function footer(page, total, settings) {
  const phone = settings?.phone || '413-162-86-05';
  return [line(38,43,574,43,colors.line), text(phone,38,27,7,{font:'F2',color:colors.forest}), text('Documento generado por el sistema local',306,27,7,{color:colors.muted,align:'center'}), text(`Página ${page} de ${total}`,574,27,7,{font:'F2',color:colors.forest,align:'right'})].join('\n');
}
function metricCard(x,y,width,label,value,tone = 'green') {
  const palette = tone === 'gold' ? [colors.goldSoft,colors.gold] : tone === 'red' ? [colors.redSoft,colors.red] : [colors.forestSoft,colors.forest];
  return [rect(x,y,width,57,colors.paper,colors.line,8),rect(x+10,y+10,7,37,palette[0],null,3),text(label,x+28,y+36,7,{font:'F2',color:colors.muted,maxWidth:width-38}),text(value,x+28,y+16,15,{font:'F2',color:palette[1],maxWidth:width-38})].join('\n');
}
function sectionTitle(label,title,y) { return `${text(label,40,y+14,7,{font:'F2',color:colors.gold})}\n${text(title,40,y-3,14,{font:'F3',color:colors.ink})}`; }
function tableHeader(columns,y) {
  const commands = [rect(40,y-22,532,24,colors.forest,null,5)];
  columns.forEach(column => commands.push(text(column.label,column.x,y-14,7,{font:'F2',color:colors.white,align:column.align || 'left',maxWidth:column.width})));
  return commands.join('\n');
}
const statusInfo = status => ({ cerrado:['Cerrado',colors.forestSoft,colors.forest], cancelado:['Cancelado',colors.redSoft,colors.red], en_ruta:['En reparto',colors.blueSoft,colors.blue], listo:['Listo',colors.goldSoft,colors.gold], preparando:['Preparando',colors.goldSoft,colors.gold], pendiente:['Pendiente',colors.goldSoft,colors.gold], nuevo:['Abierto',colors.goldSoft,colors.gold], abierto:['Abierto',colors.goldSoft,colors.gold] }[status] || [status || 'Abierto',colors.goldSoft,colors.gold]);
function statusChip(status,x,y,width = 68) { const [label,background,color] = statusInfo(status); return `${rect(x,y-4,width,15,background,null,7)}\n${text(label,x+width/2,y+1,6.5,{font:'F2',color,align:'center',maxWidth:width-8})}`; }
function serviceLabel(order) { return order.type === 'mesa' ? `Mesa ${order.table || ''}` : order.type === 'domicilio' ? 'Domicilio' : 'Recoger aqui'; }
function orderTotal(order) { return number(order.payment?.total || (order.items || []).reduce((sum,item) => sum + number(item.unitPrice) * Math.max(1,number(item.quantity)),0)); }
function orderRows(orders,columns,startY,rowHeight = 21, mode = 'general') {
  const commands = [];
  orders.forEach((order,index) => {
    const y = startY - index * rowHeight;
    commands.push(rect(40,y-rowHeight+2,532,rowHeight,index % 2 ? colors.paper : '#faf8f2'));
    commands.push(text(`#${String(order.number).padStart(3,'0')}`,columns[0].x,y-12,7.5,{font:'F2',color:colors.gold,maxWidth:columns[0].width}));
    commands.push(text(mode === 'cash' ? shortTime(order.createdAt) : shortDate(order.createdAt),columns[1].x,y-12,7.5,{color:colors.muted,maxWidth:columns[1].width}));
    commands.push(text(serviceLabel(order),columns[2].x,y-12,7.5,{font:'F2',maxWidth:columns[2].width}));
    if (mode === 'general') commands.push(text(order.type === 'mesa' ? `${number(order.guests)} comensales` : order.customerName || 'Cliente',columns[3].x,y-12,7.5,{color:colors.muted,maxWidth:columns[3].width}));
    else commands.push(text(order.payment?.method || 'Sin cobro',columns[3].x,y-12,7.5,{color:colors.muted,maxWidth:columns[3].width}));
    commands.push(statusChip(order.status,columns[4].x,y-14,columns[4].width));
    commands.push(text(money(orderTotal(order)),columns[5].x,y-12,7.5,{font:'F2',color:colors.forest,align:'right'}));
    commands.push(line(40,y-rowHeight+2,572,y-rowHeight+2,colors.line,.35));
  });
  return commands.join('\n');
}
function buildPdf(pageBodies,settings,generatedAt) {
  const total = pageBodies.length; const pageIds=[]; const objects=['<< /Type /Catalog /Pages 2 0 R >>',''];
  const fontStart = 3 + total * 2;
  pageBodies.forEach((body,index) => {
    const pageId=3+index*2; const contentId=pageId+1; pageIds.push(pageId);
    const stream = `${body}\n${footer(index+1,total,settings)}`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontStart} 0 R /F2 ${fontStart+1} 0 R /F3 ${fontStart+2} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects[1]=`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${total} >>`;
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>');
  let output='%PDF-1.4\n'; const offsets=[0];
  objects.forEach((object,index)=>{ offsets.push(Buffer.byteLength(output)); output+=`${index+1} 0 obj\n${object}\nendobj\n`; });
  const xref=Buffer.byteLength(output); output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output,'utf8');
}

export function generalReportPdf({ settings, orders = [], rawMaterials = [], generatedAt = new Date() }) {
  const paid=orders.filter(order=>order.paid); const captured=paid.reduce((sum,order)=>sum+orderTotal(order),0); const open=orders.filter(order=>!['cerrado','cancelado'].includes(order.status)).length; const cancelled=orders.filter(order=>order.status==='cancelado').length;
  const firstCapacity=21, nextCapacity=26; const groups=[]; let cursor=0;
  groups.push(orders.slice(cursor,cursor+firstCapacity)); cursor+=firstCapacity;
  while(cursor<orders.length){groups.push(orders.slice(cursor,cursor+nextCapacity));cursor+=nextCapacity;}
  const columns=[{label:'FOLIO',x:48,width:40},{label:'FECHA',x:100,width:55},{label:'SERVICIO',x:165,width:92},{label:'CLIENTE / MESA',x:265,width:112},{label:'ESTADO',x:405,width:70},{label:'TOTAL',x:558,width:66,align:'right'}];
  const pages=groups.map((group,pageIndex)=>{
    const commands=[header('Reporte general','Historial de operación',settings,generatedAt)];
    if(pageIndex===0){
      commands.push(sectionTitle('RESUMEN CONSOLIDADO','Actividad registrada',665));
      commands.push(text(`Pedidos y ventas guardados localmente hasta ${dateTime(generatedAt)}.`,40,642,8,{color:colors.muted}));
      commands.push(metricCard(40,574,124,'PEDIDOS',String(orders.length)));
      commands.push(metricCard(176,574,124,'COBRADOS',String(paid.length)));
      commands.push(metricCard(312,574,124,'VENTA CAPTURADA',money(captured),'gold'));
      commands.push(metricCard(448,574,124,'MATERIAS PRIMAS',String(rawMaterials.length)));
      commands.push(sectionTitle('DETALLE','Pedidos registrados',548));
      commands.push(tableHeader(columns,519));
      commands.push(group.length ? orderRows(group,columns,497,21) : text('No hay pedidos registrados para mostrar.',306,470,10,{color:colors.muted,align:'center'}));
      commands.push(text(`Abiertos: ${open}   |   Cancelados: ${cancelled}`,572,546,7,{font:'F2',color:colors.muted,align:'right'}));
    } else {
      commands.push(sectionTitle('CONTINUACION','Pedidos registrados',665));
      commands.push(tableHeader(columns,635));
      commands.push(orderRows(group,columns,613,21));
    }
    return commands.join('\n');
  });
  return buildPdf(pages,settings,generatedAt);
}

export function cashCloseReportPdf({ settings, session, report, orders = [], generatedAt = new Date() }) {
  const data=report || {}; const totalCollected=number(data.totalSales ?? Object.values(data.methodTotals || {}).reduce((sum,value)=>sum+number(value),0)); const expectedTurnTotal=number(data.expectedTurnTotal ?? number(session.openingCash)+totalCollected); const difference=number(data.difference); const balanceLabel=difference===0?'Caja exacta':difference>0?'Sobrante':'Faltante';
  const firstCapacity=15,nextCapacity=26,groups=[]; let cursor=0;
  groups.push(orders.slice(cursor,cursor+firstCapacity)); cursor+=firstCapacity;
  while(cursor<orders.length){groups.push(orders.slice(cursor,cursor+nextCapacity));cursor+=nextCapacity;}
  const columns=[{label:'FOLIO',x:48,width:40},{label:'HORA',x:100,width:55},{label:'SERVICIO',x:165,width:92},{label:'PAGO',x:265,width:112},{label:'ESTADO',x:405,width:70},{label:'TOTAL',x:558,width:66,align:'right'}];
  const pages=groups.map((group,pageIndex)=>{
    const commands=[header('Corte de caja','Resumen privado del turno',settings,generatedAt)];
    if(pageIndex===0){
      commands.push(sectionTitle('TURNO CERRADO','Resumen del día',665));
      commands.push(text(`${dateTime(session.openedAt)} - ${dateTime(session.closedAt)}   |   Responsable: ${session.closedBy || session.openedBy || 'admin'}`,40,642,8,{color:colors.muted,maxWidth:530}));
      commands.push(metricCard(40,574,124,'FONDO CAMBIO',money(session.openingCash)));
      commands.push(metricCard(176,574,124,'VENTAS COBRADAS',money(totalCollected),'gold'));
      commands.push(metricCard(312,574,124,'TOTAL TURNO',money(expectedTurnTotal),'gold'));
      commands.push(metricCard(448,574,124,'EFECTIVO CONTADO',money(data.countedCash),difference<0?'red':'green'));
      commands.push(rect(40,474,258,82,colors.paper,colors.line,8)); commands.push(text('PAGOS Y MOVIMIENTOS',54,538,7,{font:'F2',color:colors.gold}));
      commands.push(text('Efectivo',54,520,8,{color:colors.muted}),text(money(data.methodTotals?.Efectivo),282,520,8,{font:'F2',color:colors.forest,align:'right'}));
      commands.push(text('Tarjeta',54,504,8,{color:colors.muted}),text(money(data.methodTotals?.Tarjeta),282,504,8,{font:'F2',color:colors.forest,align:'right'}));
      commands.push(text('Transferencia',54,488,8,{color:colors.muted}),text(money(data.methodTotals?.Transferencia),282,488,8,{font:'F2',color:colors.forest,align:'right'}));
      commands.push(rect(314,474,258,82,difference<0?colors.redSoft:colors.forestSoft,null,8)); commands.push(text('ARQUEO FINAL',328,538,7,{font:'F2',color:difference<0?colors.red:colors.forest}));
      commands.push(text(balanceLabel,328,510,13,{font:'F3',color:difference<0?colors.red:colors.forest}),text(money(Math.abs(difference)),556,508,15,{font:'F2',color:difference<0?colors.red:colors.forest,align:'right'}));
      commands.push(text(`Efectivo esperado: ${money(data.expectedCash)}`,328,490,7,{font:'F2',color:colors.muted,maxWidth:225}));
      commands.push(text(`Comisiones: ${money(data.cardFees)}   |   Propinas: ${money(data.tips)}`,328,478,6.5,{color:colors.muted,maxWidth:225}));
      commands.push(sectionTitle('OPERACIONES','Pedidos del turno',451)); commands.push(text(`${orders.length} pedidos   |   ${data.paidOrders||0} cobrados   |   ${data.cancelledOrders||0} cancelados   |   ${data.openOrders||0} abiertos`,572,448,7,{font:'F2',color:colors.muted,align:'right'}));
      commands.push(tableHeader(columns,422)); commands.push(group.length?orderRows(group,columns,400,21,'cash'):text('No se registraron pedidos durante este turno.',306,380,10,{color:colors.muted,align:'center'}));
    } else {
      commands.push(sectionTitle('CONTINUACION','Pedidos del turno',665)); commands.push(tableHeader(columns,635)); commands.push(orderRows(group,columns,613,21,'cash'));
    }
    return commands.join('\n');
  });
  return buildPdf(pages,settings,generatedAt);
}
