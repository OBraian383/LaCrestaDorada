/* La Cresta Dorada: lógica de la app. Sin dependencias; Firebase se carga desde su CDN oficial.
   Estructura de este archivo:
   1. Utilidades y funciones puras (interpretar texto, calcular caja, resumir)
   2. Modelo de datos y escritura (movimientos, saldos, anulación, rectificación)
   3. Pantallas (Anotar, Cuentas, Caja, Historial, Resumen, Ajustes)
   4. Respaldo y restauración
   5. Identidad y conexión con Firestore */
(function(){
'use strict';

/*PURE-START*/
// ---------- constantes ----------
// Medios para registros NUEVOS. Débito y crédito solo existen en registros históricos y se conservan tal cual.
const MEDIOS = [['efectivo','Efectivo'],['transferencia','Transferencia / electrónico'],['fiado','Fiado']];
const MEDIO_KEYS = ['efectivo','transferencia','debito','credito','fiado'];
const MEDIO_TXT = { efectivo:'Efectivo', transferencia:'Transferencia', debito:'Débito', credito:'Crédito', fiado:'Fiado' };
const MEDIOS_COBRO = MEDIOS.filter(m => m[0] !== 'fiado');
const EGRESOS = [['gasto','Gasto operativo'],['compra','Compra de mercadería'],['retiro','Retiro personal'],['proveedor','Pago a proveedor'],['otro','Otro egreso']];
const EGR_TXT = Object.fromEntries(EGRESOS);
const DEF_CFG = {
  responsables:[
    {id:'propietario', nombre:'Kevin', cats:['avicolas','bebidas']},
    {id:'hermano', nombre:'Ramiro', cats:['cigarrillos','gas']},
    {id:'madre', nombre:'Mamá', cats:['general']}
  ],
  categorias:[
    {id:'general', nombre:'Mercadería general'},{id:'avicolas', nombre:'Avícolas'},{id:'bebidas', nombre:'Bebidas'},
    {id:'cigarrillos', nombre:'Cigarrillos'},{id:'gas', nombre:'Garrafas de gas'},{id:'otros', nombre:'Otros'}
  ],
  cuentas:[{id:'propietario', nombre:'Kevin'},{id:'hermano', nombre:'Ramiro'},{id:'madre', nombre:'Mamá'},{id:'otra', nombre:'Otra'}]
};
const NOMBRES_VIEJOS = ['Madre','Propietario','Hermano','Cuenta del propietario','Cuenta del hermano'];
const DIA_MS = 86400000;

const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const round2 = n => Math.round(n * 100) / 100;

function parseMonto(raw){
  let s = String(raw).trim().replace(/[^\d.,]/g,'').replace(/[.,]+$/,'');
  if (!s) return NaN;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g,'').replace(',','.');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',','.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g,'');
  else s = s.replace(/,/g,'');
  return parseFloat(s);
}
/* Importe escrito a mano, con signo posible. Devuelve {v, neg} o null si no es un número válido. */
function leerImporte(raw){
  const t = String(raw == null ? '' : raw).trim();
  if (!t) return null;
  const neg = /^[\s(]*[-−–]/.test(t) || /^\(.*\)$/.test(t);
  const v = parseMonto(t);
  if (!isFinite(v) || v <= 0 || v > 1e9) return null;
  return { v: round2(v), neg };
}
function cyrb53(str){
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++){
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ---------- interpretar el texto estilo chat ----------
const RE_MSG = /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([ap])\.?\s*m\.?)?\]?\s*(?:-\s*)?([^:]+?):\s(.*)$/i;
const RE_SYS = /^\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/;
const RE_ALIAS = /\((?:alias|transf(?:erencia)?|a nombre de)[\s:]+([^)]+)\)/i;
function tcase(s){ return s !== s.toLowerCase() ? s : s.replace(/(^|\s)(\S)/g,(m,a,b)=>a+b.toUpperCase()); }
function limpiarNombre(s){ return tcase(String(s).replace(/^[\s\-–:,.•*]+|[\s\-–:,.•*]+$/g,'').replace(/\s+/g,' ')); }
function limpiarDesc(s){ return String(s).replace(/^[\s\-–•*]+|[\s\-–:,•*]+$/g,'').replace(/\s+/g,' '); }

function splitMessages(text, fechaBase){
  const lines = String(text).replace(/\r/g,'').replace(/[‎‏]/g,'').replace(/[  ]/g,' ').split('\n');
  const msgs = []; let cur = null; let conFecha = false;
  for (const raw of lines){
    const line = raw.trim();
    const m = RE_MSG.exec(line);
    if (m){
      conFecha = true;
      let y = +m[3]; if (y < 100) y += 2000;
      let h = +m[4];
      if (m[6]){ const p = m[6].toLowerCase() === 'p'; if (p && h < 12) h += 12; if (!p && h === 12) h = 0; }
      const f = new Date(y, +m[2]-1, +m[1], h, +m[5]).getTime();
      cur = { fecha: f, autorChat: m[7].trim(), lineas: [], conFecha: true };
      msgs.push(cur);
      if (m[8].trim()) cur.lineas.push(m[8].trim());
      continue;
    }
    if (RE_SYS.test(line)){ cur = null; continue; }
    if (!line){ if (!conFecha) cur = null; continue; }
    if (!cur){ cur = { fecha: fechaBase, autorChat: null, lineas: [], conFecha: false }; msgs.push(cur); }
    cur.lineas.push(line);
  }
  return msgs;
}
function interpretar(msg){
  const entries = [], avisos = [];
  const items = []; const pagos = [];
  let cliente = null, hayDebe = false;
  for (const raw of msg.lineas){
    let l = raw;
    if (/omitid|mensaje eliminado|elimin[oó] este mensaje/i.test(l) && !/\$/.test(l)) continue;
    let titular = null;
    l = l.replace(RE_ALIAS,(_,t)=>{ titular = t.trim(); return ' '; }).trim();
    if (!l) continue;
    const mp = /^(.+?)\s+(?:pag[oó]|abon[oó]|entreg[oó]|dej[oó]|transfiri[oó])\s+(?:de\s+|con\s+)?\$?\s*(\d[\d.,]*)\s*(.*)$/i.exec(l);
    if (mp){
      const monto = parseMonto(mp[2]);
      if (isFinite(monto) && monto > 0){
        pagos.push({ nombre: limpiarNombre(mp[1]), monto, titular, medio: (titular || /transfiri/i.test(l)) ? 'transferencia' : 'efectivo' });
        continue;
      }
    }
    if (!/\$\s*\d/.test(l)){
      const d1 = /^(.+?)[\s:,\-–]*\bdebe\b[.!\s]*$/i.exec(l);
      if (d1){ cliente = limpiarNombre(d1[1]); hayDebe = true; continue; }
      const d2 = /^debe[:\s]+(.+)$/i.exec(l);
      if (d2){ cliente = limpiarNombre(d2[1]); hayDebe = true; continue; }
      avisos.push('No encontré un precio con $ en: «' + l + '»');
      continue;
    }
    const mi = /^(.*?)\$\s*(\d[\d.,]*)(.*)$/.exec(l);
    let desc = mi[1]; const monto = parseMonto(mi[2]); const resto = mi[3];
    if (!isFinite(monto)){ avisos.push('No pude leer el precio en: «' + l + '»'); continue; }
    if (/\bdebe\b/i.test(resto)){
      hayDebe = true;
      const n = limpiarNombre(resto.replace(/\bdebe\b/ig,''));
      if (n) cliente = n;
    } else if (/\bdebe\b/i.test(desc)){
      hayDebe = true;
      const n = limpiarNombre(desc.replace(/\bdebe\b.*$/i,''));
      if (n) cliente = n;
      desc = 'Deuda anterior';
    } else if (!limpiarDesc(desc) && limpiarDesc(resto)){
      desc = resto;
    }
    items.push({ d: limpiarDesc(desc) || 'Sin detalle', m: monto, titular });
  }
  for (const p of pagos){
    entries.push({ tipo:'pago', items:[{d:'Pago', m:p.monto}], total:p.monto, clienteNombre:p.nombre, medio:p.medio, titular:p.titular });
  }
  if (hayDebe){
    if (!cliente) avisos.push('Falta el nombre de quien debe en este grupo de líneas.');
    else if (!items.length) avisos.push('«' + cliente + ' debe» no tiene productos con precio.');
    else {
      const total = items.reduce((a,i)=>a+i.m,0);
      entries.push({ tipo:'fiado', items: items.map(i=>({d:i.d, m:i.m})), total, clienteNombre:cliente, medio:null, titular:null });
    }
  } else {
    for (const it of items){
      entries.push({ tipo:'venta', items:[{d:it.d, m:it.m}], total:it.m, clienteNombre:null, medio: it.titular ? 'transferencia' : 'efectivo', titular: it.titular || null });
    }
  }
  return { entries, avisos };
}

// ---------- cálculos ----------
/* Efecto de un movimiento en la cuenta corriente del cliente. */
function efectoSaldo(m){
  if (m.anulado || !m.clienteId) return 0;
  return m.tipo === 'fiado' ? m.total : m.tipo === 'pago' ? -m.total : 0;
}
/* Partes de un movimiento por responsable/categoría (hoy una sola; listo para varias). */
function partesDe(m){
  const r = Array.isArray(m.reparto) ? m.reparto.filter(p => p && Number(p.importe) > 0) : [];
  return r.length ? r.map(p => ({ resp:p.resp || '', cat:p.cat || '', importe:Number(p.importe) }))
                  : [{ resp:m.resp || '', cat:m.cat || '', importe:m.total }];
}
/* Lo cobrado al momento de una venta fiada, por id de la venta. */
function recibidoPorRef(movs){
  const mp = new Map();
  for (const m of movs) if (!m.anulado && m.tipo === 'pago' && m.origen === 'venta' && m.ref) mp.set(m.ref, (mp.get(m.ref)||0) + m.total);
  return mp;
}
const cero4 = () => ({ efectivo:0, transferencia:0, debito:0, credito:0 });
/* Caja de un conjunto de movimientos (ya sin anulados). */
function calcularCaja(movs){
  const r = { ventas:0, nVentas:0, porMedio:cero4(), fiadas:0, cobros:0, cobrosMedio:cero4(),
              egr:{gasto:0,compra:0,retiro:0,proveedor:0,otro:0}, egrTotal:0, egrMedio:cero4() };
  const rec = recibidoPorRef(movs);
  for (const m of movs){
    if (m.anulado) continue;
    if (m.tipo === 'venta'){ r.ventas += m.total; r.nVentas++; if (r.porMedio[m.medio] != null) r.porMedio[m.medio] += m.total; }
    else if (m.tipo === 'fiado'){ r.ventas += m.total; r.nVentas++; r.fiadas += Math.max(0, m.total - (rec.get(m.id) || 0)); }
    else if (m.tipo === 'pago'){
      if (m.origen === 'venta'){ if (r.porMedio[m.medio] != null) r.porMedio[m.medio] += m.total; }
      else { r.cobros += m.total; if (r.cobrosMedio[m.medio] != null) r.cobrosMedio[m.medio] += m.total; }
    } else if (m.tipo === 'egreso'){
      const k = r.egr[m.sub] != null ? m.sub : 'otro';
      r.egr[k] += m.total; r.egrTotal += m.total;
      if (r.egrMedio[m.medio] != null) r.egrMedio[m.medio] += m.total;
    }
  }
  const redondear = o => { for (const k in o) o[k] = round2(o[k]); };
  r.ventas = round2(r.ventas); r.fiadas = round2(r.fiadas); r.cobros = round2(r.cobros); r.egrTotal = round2(r.egrTotal);
  redondear(r.porMedio); redondear(r.cobrosMedio); redondear(r.egr); redondear(r.egrMedio);
  r.ingresoEfectivo = round2(r.porMedio.efectivo + r.cobrosMedio.efectivo);
  r.egrOperativos = round2(r.egr.gasto + r.egr.compra + r.egr.proveedor + r.egr.otro);
  return r;
}
function efectivoEsperado(caja, fondo){ return round2((Number(fondo) || 0) + caja.ingresoEfectivo - caja.egrMedio.efectivo); }
/* Resumen por responsable y categoría. */
function resumir(movs){
  const vivos = movs.filter(m => !m.anulado);
  const caja = calcularCaja(vivos);
  const rec = recibidoPorRef(vivos);
  const resp = {}, cat = {};
  const get = (o,k) => o[k] || (o[k] = { ventas:0, fiado:0, cobros:0, egr:0, retiros:0 });
  for (const m of vivos){
    for (const p of partesDe(m)){
      const r = get(resp, p.resp || '-'), c = get(cat, p.cat || '-');
      const ratio = m.total ? p.importe / m.total : 1;
      if (m.tipo === 'venta' || m.tipo === 'fiado'){
        r.ventas += p.importe; c.ventas += p.importe;
        if (m.tipo === 'fiado'){ const pend = Math.max(0, m.total - (rec.get(m.id) || 0)) * ratio; r.fiado += pend; c.fiado += pend; }
      } else if (m.tipo === 'pago' && m.origen !== 'venta'){ r.cobros += p.importe; c.cobros += p.importe; }
      else if (m.tipo === 'egreso'){
        if (m.sub === 'retiro'){ r.retiros += p.importe; c.retiros += p.importe; } else { r.egr += p.importe; c.egr += p.importe; }
      }
    }
  }
  return { caja, resp, cat };
}

// ---------- distribución por responsable ----------
const esDistribuible = m => !m.anulado && (m.tipo === 'venta' || m.tipo === 'fiado' || m.tipo === 'egreso');
/* Una asignación vale solo si sus partes suman exactamente el total del movimiento. */
function asigValida(m, a){
  if (!a || a.estado !== 'asignado' || !Array.isArray(a.partes) || !a.partes.length) return false;
  const s = a.partes.reduce((x, p) => x + (Number(p.importe) || 0), 0);
  return Math.abs(s - m.total) < 0.005;
}
/* Reparte los movimientos de un conjunto entre columnas. Lo que no tiene asignación válida queda pendiente.
   Nada se cuenta dos veces: cada movimiento aporta su total, repartido en partes, o queda pendiente. */
function distribuir(movs, asigs, respIds){
  const col = {}; respIds.forEach(id => { col[id] = { ing:0, egr:0, n:0, items:[] }; });
  const pend = [], desact = [];
  for (const m of movs){
    if (!esDistribuible(m)) continue;
    const a = asigs.get(m.id);
    if (asigValida(m, a)){
      for (const p of a.partes){
        const c = col[p.resp] || (col[p.resp] = { ing:0, egr:0, n:0, items:[] });
        const imp = round2(Number(p.importe));
        if (m.tipo === 'egreso') c.egr += imp; else c.ing += imp;
        c.n++; c.items.push({ m, importe:imp, dividido:a.partes.length > 1 });
      }
    } else { pend.push(m); if (a && a.estado === 'asignado' && a.partes && a.partes.length) desact.push(m.id); }
  }
  for (const k in col){ col[k].ing = round2(col[k].ing); col[k].egr = round2(col[k].egr); col[k].neto = round2(col[k].ing - col[k].egr); }
  return { col, pend, desact };
}
/* Aplica los cobros de deuda de un cliente a sus fiados más antiguos, para saber a qué venta original corresponde cada cobro. */
function aplicarCobros(movsCli){
  const vivos = movsCli.filter(m => !m.anulado);
  const ini = new Map();
  vivos.forEach(m => { if (m.tipo === 'pago' && m.origen === 'venta' && m.ref) ini.set(m.ref, (ini.get(m.ref) || 0) + m.total); });
  const orden = (a, b) => a.fecha - b.fecha || a.creado - b.creado;
  const fiados = vivos.filter(m => m.tipo === 'fiado').sort(orden).map(m => ({ m, resta:round2(m.total - (ini.get(m.id) || 0)) }));
  const res = new Map();
  for (const c of vivos.filter(m => m.tipo === 'pago' && m.origen !== 'venta').sort(orden)){
    let rest = c.total; const partes = [];
    for (const f of fiados){
      if (rest <= 0.004) break; if (f.resta <= 0.004) continue;
      const x = Math.min(rest, f.resta); f.resta = round2(f.resta - x); rest = round2(rest - x); partes.push({ fiado:f.m, importe:round2(x) });
    }
    if (rest > 0.004) partes.push({ fiado:null, importe:round2(rest) });
    res.set(c.id, partes);
  }
  return res;
}
/*PURE-END*/

// ---------- utilidades de pantalla ----------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf = new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:0,maximumFractionDigits:2});
const money = n => nf.format(round2(n)).replace(/ /g,' ');
const compacto = n => n >= 1000 ? (n/1000).toFixed(n >= 10000 ? 0 : 1).replace('.',',') + ' mil' : String(Math.round(n));
const pl = (n,a,b) => n + ' ' + (n === 1 ? a : b);
const dayKey = ms => { const d = new Date(ms); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const startOfDay = ms => { const d = new Date(ms); d.setHours(0,0,0,0); return d.getTime(); };
const keyToMs = k => { const p = String(k).split('-').map(Number); return new Date(p[0], p[1]-1, p[2]).getTime(); };
const fmtDia = ms => new Date(ms).toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'});
const fmtHora = ms => new Date(ms).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false});
const fmtCorta = ms => new Date(ms).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});
const fmtFechaHora = ms => fmtCorta(ms) + ' ' + fmtHora(ms);
function etiquetaDia(ms){
  const k = dayKey(ms), hoy = Date.now();
  if (k === dayKey(hoy)) return 'Hoy';
  const ay = new Date(hoy); ay.setDate(ay.getDate()-1);
  return k === dayKey(ay.getTime()) ? 'Ayer' : fmtDia(ms);
}
const vacio = (t, d) => '<div class="vacio"><b>' + esc(t) + '</b>' + esc(d) + '</div>';
const opts = (arr, sel, vacioTxt) => (vacioTxt != null ? '<option value="">' + esc(vacioTxt) + '</option>' : '') +
  arr.map(a => '<option value="' + esc(a[0]) + '"' + (a[0] === sel ? ' selected' : '') + '>' + esc(a[1]) + '</option>').join('');

// ---------- estado ----------
const S = {
  db:null, nombre:'', code:'', canWrite:true, arrancando:false, fatal:false, pendM:false, pendC:false,
  cfg: JSON.parse(JSON.stringify(DEF_CFG)),
  movs:new Map(), extra:new Map(), mapa:new Map(), lista:[], recPorRef:new Map(),
  clientes:new Map(), cierres:[], deuda:0, ventana:0,
  view:'anotar', cliSel:null, cliMovs:[], unCli:null, modo:'fiado', verAlDia:false, anulando:null,
  F:{ tipo:'venta', medio:'efectivo', id:null, sinMotivo:false },
  H:{ limit:100, cargados:new Set(), cargando:false },
  R:{ periodo:'hoy' }, C:{ dia:'', fondoTocado:false, abierto:null, cargados:new Set() },
  parsed:null, guardando:false, edit:null, restaurar:null,
  sync:{ movs:false, clientes:false }, timer:null,
  uid:'', perfiles:new Map(), prefs:{ recordar:true }, perfilReg:false, pendPerfil:'', prefsAplicadas:false,
  asig:new Map(), asigExtra:new Map(), asigAll:new Map(), asigDias:new Set(), cliCache:new Map(), cliTry:new Map(), arts:new Map(), artHtml:'',
  D:{ sel:'pend', rect:false, motivo:'', motivoTxt:'', split:null, last:null }
};
let toastT = null;
function setEstado(s, txt){ $('#estado').dataset.s = s; $('#estadoTxt').textContent = txt; }
function toast(msg, err){
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, err ? 6000 : 2600);
}
const respNombre = id => { const r = S.cfg.responsables.find(x => x.id === id); return r ? r.nombre : (id || ''); };
const catNombre = id => { const c = S.cfg.categorias.find(x => x.id === id); return c ? c.nombre : (id || ''); };
const cuentaNombre = id => { const c = S.cfg.cuentas.find(x => x.id === id); return c ? c.nombre : (id || ''); };
const catsDe = resp => {
  const r = S.cfg.responsables.find(x => x.id === resp);
  return r ? r.cats.map(id => [id, catNombre(id)]) : S.cfg.categorias.map(c => [c.id, c.nombre]);
};

// ---------- lectura de documentos ----------
function leerMov(d){
  const x = d.data() || {};
  const tipo = ['venta','fiado','pago','egreso'].includes(x.tipo) ? x.tipo : 'venta';
  const tot = Math.abs(Number(x.total) || 0);
  let importe = Number(x.importe);
  if (x.importe == null || !isFinite(importe)) importe = tipo === 'egreso' ? -tot : tot;
  const items = Array.isArray(x.items) ? x.items.map(i => ({ d:String((i && i.d) || ''), m:Number(i && i.m) || 0 })) : [];
  const desc = typeof x.desc === 'string' ? x.desc : (typeof x.detalle === 'string' && x.detalle ? x.detalle : items.map(i => i.d).filter(Boolean).join(' · '));
  let medio = x.medio;
  if (tipo === 'fiado') medio = 'fiado'; else if (!MEDIO_KEYS.includes(medio) || medio === 'fiado') medio = 'efectivo';
  const creado = Number(x.creado) || 0;
  const s = k => (typeof x[k] === 'string' && x[k]) ? x[k] : '';
  return {
    id:d.id, tipo, sub: tipo === 'egreso' ? (EGR_TXT[x.sub] ? x.sub : 'otro') : '',
    fecha:Number(x.fecha) || 0, creado, modificado:Number(x.modificado) || creado,
    por:s('por'), porUid:s('porUid'), desc, detalles:s('detalles'), importe, total:Math.abs(importe), medio, items,
    clienteId:x.clienteId || null, clienteNombre:s('clienteNombre'),
    resp:s('resp'), cat:s('cat'), reparto:Array.isArray(x.reparto) ? x.reparto : [],
    titular:s('titular'), alias:s('alias'), cuentaId:s('cuentaId'), retiroPor:s('retiroPor'),
    ref:x.ref || null, origen: x.origen || (tipo === 'pago' ? 'deuda' : ''),
    anulado:x.anulado === true, anuladoPor:s('anuladoPor'), anuladoEn:Number(x.anuladoEn) || 0, cascada:x.anuladoCascada === true,
    historial:Array.isArray(x.historial) ? x.historial : [], autorChat:s('autorChat'), clave:s('clave')
  };
}
function leerCliente(d){
  const x = d.data() || {};
  return { id:d.id, nombre:(typeof x.nombre === 'string' && x.nombre) ? x.nombre : 'Sin nombre',
    saldo:Number(x.saldo) || 0, saldoOk:x.saldoOk === true, ultimo:Number(x.ultimo) || 0, obs:typeof x.obs === 'string' ? x.obs : '',
    provisorio:x.provisorio === true, fusionadoEn:x.fusionadoEn || null, creado:Number(x.creado) || 0 };
}
function derivar(){
  const mapa = new Map(S.extra); S.movs.forEach((m,k) => mapa.set(k,m));
  S.mapa = mapa;
  S.lista = [...mapa.values()].sort((a,b) => b.fecha - a.fecha || b.creado - a.creado);
  S.recPorRef = recibidoPorRef(S.lista);
  let d = 0; S.clientes.forEach(c => { if (!c.fusionadoEn && c.saldo > 0) d += c.saldo; });
  S.deuda = round2(d);
}
function aplicarConfig(docs){
  const g = docs.find(d => d.id === 'general');
  const x = g && g.data();
  const cfg = JSON.parse(JSON.stringify(DEF_CFG));
  if (x){
    if (Array.isArray(x.responsables)) for (const r of x.responsables){
      const base = cfg.responsables.find(b => b.id === r.id);
      if (base && typeof r.nombre === 'string' && r.nombre.trim() && !NOMBRES_VIEJOS.includes(r.nombre.trim())) base.nombre = r.nombre.trim();
    }
    if (Array.isArray(x.cuentas) && x.cuentas.length){
      const cu = x.cuentas.filter(c => c && c.id && c.nombre).map(c => ({ id:String(c.id), nombre: c.nombre === 'Cuenta del propietario' ? 'Kevin' : c.nombre === 'Cuenta del hermano' ? 'Ramiro' : String(c.nombre) }));
      DEF_CFG.cuentas.forEach(d => { if (!cu.some(c => c.id === d.id)) cu.push({ id:d.id, nombre:d.nombre }); });
      cfg.cuentas = cu;
    }
  }
  S.cfg = cfg;
}

// ---------- escritura ----------
function docMov(o){
  const now = Date.now();
  const imp = round2(o.importe), abs = Math.abs(imp);
  const medio = o.tipo === 'fiado' ? 'fiado' : o.medio;
  return {
    tipo:o.tipo, sub:o.sub || null, fecha:o.fecha || now, creado:now, modificado:now, por:S.nombre || null, porUid:S.uid || null,
    desc:o.desc || '', detalle:o.desc || '', detalles:o.detalles || '',
    items:o.items || [{ d:o.desc || '', m:abs }], total:abs, importe:imp, medio,
    pagos:o.tipo === 'fiado' ? [] : [{ medio, importe:imp }],
    clienteId:o.clienteId || null, clienteNombre:o.clienteNombre || null,
    resp:o.resp || null, cat:o.cat || null,
    reparto:(o.resp || o.cat) ? [{ resp:o.resp || null, cat:o.cat || null, importe:abs }] : [],
    titular:o.titular || null, alias:o.alias || null, cuentaId:o.cuentaId || null, retiroPor:o.retiroPor || null,
    ref:o.ref || null, origen:o.origen || null, anulado:false, historial:[],
    autorChat:o.autorChat || null, clave:o.clave || null, v:2
  };
}
/* Escribe movimientos y actualiza los saldos de los clientes en el mismo lote.
   docs: [{id, data}]; nuevos: Map(clienteId -> {nombre, provisorio}) de clientes a crear. */
function escribir(docs, nuevos){
  const saldos = new Map(), ultimos = new Map();
  for (const d of docs){
    const m = d.data;
    if (!m.clienteId) continue;
    const ef = m.tipo === 'fiado' ? m.total : m.tipo === 'pago' ? -m.total : 0;
    if (ef) saldos.set(m.clienteId, (saldos.get(m.clienteId) || 0) + ef);
    ultimos.set(m.clienteId, Math.max(ultimos.get(m.clienteId) || 0, m.fecha));
  }
  const TAM = 200;
  for (let i = 0; i < docs.length || i === 0; i += TAM){
    const b = S.db.batch();
    docs.slice(i, i + TAM).forEach(d => b.set('movimientos', d.id, d.data));
    if (i + TAM >= docs.length){
      const ids = new Set([...saldos.keys(), ...ultimos.keys()]);
      ids.forEach(cid => {
        const c = S.clientes.get(cid), nv = nuevos && nuevos.get(cid);
        const patch = { ultimo: Math.max(ultimos.get(cid) || 0, c ? c.ultimo : 0) };
        if (saldos.get(cid)) patch.saldo = S.db.inc(round2(saldos.get(cid)));
        if (nv) Object.assign(patch, { nombre:nv.nombre, creado:Date.now(), por:S.nombre || null, saldoOk:true, provisorio:!!nv.provisorio, obs:'' });
        b.merge('clientes', cid, patch);
      });
    }
    b.commit();
  }
}
function existeCliente(nombre){
  const n = norm(nombre);
  const todos = [...S.clientes.values()].filter(c => !c.fusionadoEn);
  for (const c of todos) if (norm(c.nombre) === n) return { nuevo:false, id:c.id, nombre:c.nombre };
  const tk = n.split(' ').filter(Boolean);
  const cand = todos.filter(c => { const ck = norm(c.nombre).split(' '); return tk.length && tk.every(t => ck.some(k => k === t || (t.length >= 3 && k.startsWith(t)))); });
  return cand.length === 1 ? { nuevo:false, id:cand[0].id, nombre:cand[0].nombre, parcial:true } : { nuevo:true, nombre };
}
/* Devuelve el id del cliente; si no existe lo registra en `nuevos` para crearlo. */
function asegurarCliente(nombre, nuevos, provisorio){
  const r = existeCliente(nombre);
  if (!r.nuevo) return { id:r.id, nombre:r.nombre };
  const k = norm(nombre);
  for (const [id, v] of nuevos) if (norm(v.nombre) === k) return { id, nombre:v.nombre };
  const id = S.db.nuevoId('clientes');
  nuevos.set(id, { nombre, provisorio:!!provisorio });
  return { id, nombre };
}
const histEntry = (antes, despues, nota) => ({ fecha:Date.now(), por:S.nombre || null, porUid:S.uid || null, antes:antes || null, despues:despues || null, nota:nota || null });

function cambiarAnulacion(m, anular){
  if (!S.db) return;
  const b = S.db.batch(), now = Date.now();
  const grupo = [m];
  if (m.tipo === 'fiado') S.lista.forEach(x => { if (x.ref === m.id && x.origen === 'venta' && (anular ? !x.anulado : (x.anulado && x.cascada))) grupo.push(x); });
  const deltas = new Map();
  for (const x of grupo){
    const patch = { anulado:anular, modificado:now, historial:S.db.union(histEntry(null, null, anular ? 'Anulado' : 'Restaurado')) };
    if (anular) Object.assign(patch, { anuladoPor:S.nombre || null, anuladoEn:now, anuladoCascada:x !== m });
    else Object.assign(patch, { anuladoCascada:false });
    b.update('movimientos', x.id, patch);
    if (x.clienteId){
      const ef = x.tipo === 'fiado' ? x.total : x.tipo === 'pago' ? -x.total : 0;
      if (ef) deltas.set(x.clienteId, (deltas.get(x.clienteId) || 0) + (anular ? -ef : ef));
    }
  }
  deltas.forEach((dl, cid) => { if (dl) b.merge('clientes', cid, { saldo:S.db.inc(round2(dl)) }); });
  b.commit();
  toast(anular ? (grupo.length > 1 ? 'Anulada junto con su pago inicial.' : 'Anotación anulada.') : 'Anotación restaurada.');
}
/* Rectificación: guarda los valores anteriores en el historial del propio movimiento. */
function rectificar(m, c){
  const antes = {}, desp = {};
  for (const k of Object.keys(c)){
    if (JSON.stringify(c[k]) !== JSON.stringify(m[k] == null ? '' : m[k]) && !(c[k] === '' && !m[k])){ antes[k] = m[k] == null ? '' : m[k]; desp[k] = c[k]; }
  }
  if (!Object.keys(desp).length) return false;
  const now = Date.now(), p = { modificado:now };
  const d = Object.assign({}, m, c);
  if ('desc' in desp){ p.desc = d.desc; p.detalle = d.desc; }
  if ('detalles' in desp) p.detalles = d.detalles;
  if ('importe' in desp || 'desc' in desp){ p.items = [{ d:d.desc, m:Math.abs(d.importe) }]; }
  if ('importe' in desp){ p.importe = d.importe; p.total = Math.abs(d.importe); }
  if ('importe' in desp || 'medio' in desp){ p.medio = m.tipo === 'fiado' ? 'fiado' : d.medio; p.pagos = m.tipo === 'fiado' ? [] : [{ medio:d.medio, importe:d.importe }]; }
  ['sub','titular','alias','cuentaId','retiroPor'].forEach(k => { if (k in desp) p[k] = d[k] || null; });
  if ('resp' in desp || 'cat' in desp || 'importe' in desp){
    p.resp = d.resp || null; p.cat = d.cat || null;
    p.reparto = (d.resp || d.cat) ? [{ resp:d.resp || null, cat:d.cat || null, importe:Math.abs(d.importe) }] : [];
  }
  p.historial = S.db.union(histEntry(antes, desp));
  const b = S.db.batch();
  b.update('movimientos', m.id, p);
  if ('importe' in desp && m.clienteId && !m.anulado){
    const dl = (m.tipo === 'fiado' ? 1 : m.tipo === 'pago' ? -1 : 0) * (Math.abs(d.importe) - m.total);
    if (dl) b.merge('clientes', m.clienteId, { saldo:S.db.inc(round2(dl)) });
  }
  b.commit();
  return true;
}

// ---------- pantalla: Anotar ----------
function medioChips(){
  const lista = S.F.tipo === 'venta' ? MEDIOS : MEDIOS_COBRO;
  if (!lista.some(m => m[0] === S.F.medio)) S.F.medio = 'efectivo';
  $('#oMedios').innerHTML = lista.map(m => '<button type="button" class="chipb" data-act="medio" data-v="' + m[0] + '" aria-pressed="' + (m[0] === S.F.medio) + '">' + esc(m[1]) + '</button>').join('');
}
function aplicarForm(){
  const t = S.F.tipo, med = S.F.medio;
  $$('[data-act="optipo"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === t)));
  medioChips();
  const pref = $('#oPref'); pref.textContent = t === 'egreso' ? '− $' : '$'; pref.className = t === 'egreso' ? 'neg' : '';
  $('#bloqueEgreso').hidden = t !== 'egreso';
  const sub = $('#oSub').value;
  $('#bloqueRetiro').hidden = t !== 'egreso';
  $('#hintEgreso').textContent = t !== 'egreso' ? '' : (sub === 'retiro' ? 'Escribí el importe sin signo: se resta solo de la caja y no cuenta como gasto del negocio. Indicá quién retira.'
    : 'Escribí el importe sin signo: se resta solo. Se descuenta del efectivo o de la cuenta según el medio de salida.');
  $('#bloqueTransf').hidden = med !== 'transferencia';
  $('#wTitular').hidden = t === 'egreso';
  $('#lblCuenta').textContent = t === 'egreso' ? 'Cuenta de origen' : 'Cuenta receptora';
  $('#lblMedio').textContent = t === 'egreso' ? 'Medio de salida' : t === 'cobro' ? 'Medio del cobro' : 'Medio de pago';
  $('#lblDet').innerHTML = (t === 'egreso' ? 'Motivo' : 'Detalles') + ' <span class="muted">(opcional)</span>';
  if (t === 'egreso' && !$('#oRetiro').value){ const r = miResp(); if (r) $('#oRetiro').value = r; }
  const fiado = t === 'venta' && med === 'fiado', cobro = t === 'cobro';
  $('#bloqueCliente').hidden = !(fiado || cobro);
  $('#bloqueRecibido').hidden = !fiado;
  $('#btnSinNombre').hidden = !fiado;
  $('#oArt').placeholder = cobro ? 'Opcional. Ej.: Pago de cuenta' : t === 'egreso' ? 'Ej.: Flete, bolsas, compra de pollos' : 'Ej.: Supremas de pollo 1 kg';
  $('#btnAgregar').textContent = t === 'egreso' ? 'Agregar egreso' : cobro ? 'Registrar cobro' : fiado ? 'Agregar fiado' : 'Agregar';
  actualizarSaldoHint(); actualizarPend();
}
function llenarSelectores(){
  const respSel = '';
  $('#oResp').innerHTML = opts(S.cfg.responsables.map(r => [r.id, r.nombre]), respSel, 'Sin asignar');
  llenarCat();
  const cuentas = S.cfg.cuentas.map(c => [c.id, c.nombre]);
  $('#oCuenta').innerHTML = opts(cuentas, $('#oCuenta').value, 'Sin especificar');
  $('#oSub').innerHTML = opts(EGRESOS, $('#oSub').value || 'gasto');
  $('#oRetiro').innerHTML = opts(S.cfg.responsables.map(r => [r.id, r.nombre]), $('#oRetiro').value, 'Sin especificar');
  $('#oRecMedio').innerHTML = opts(MEDIOS_COBRO, $('#oRecMedio').value || 'efectivo');
  $('#mMedio').innerHTML = opts(MEDIOS_COBRO, $('#mMedio').value || 'efectivo');
  $('#hMedio').innerHTML = opts([...MEDIOS, ['debito','Débito (histórico)'], ['credito','Crédito (histórico)']], $('#hMedio').value, 'Todos');
  $('#hResp').innerHTML = opts(S.cfg.responsables.map(r => [r.id, r.nombre]), $('#hResp').value, 'Todos');
  $('#hCat').innerHTML = opts(S.cfg.categorias.map(c => [c.id, c.nombre]), $('#hCat').value, 'Todas');
}
function llenarCat(){
  const resp = $('#oResp').value;
  const prev = $('#oCat').value, lista = catsDe(resp);
  $('#oCat').innerHTML = opts(lista, lista.some(c => c[0] === prev) ? prev : (resp ? lista[0][0] : ''), 'Sin categoría');
}
function actualizarSaldoHint(){
  const el = $('#hintSaldo');
  if ($('#bloqueCliente').hidden){ el.textContent = ''; return; }
  const n = $('#oCliente').value.trim();
  if (!n){ el.textContent = S.F.tipo === 'cobro' ? 'Elegí el cliente que paga.' : 'Escribí el nombre. Si no existe, se crea su cuenta.'; return; }
  const r = existeCliente(n);
  if (r.nuevo) el.textContent = S.F.tipo === 'cobro' ? 'Ese cliente no tiene cuenta todavía.' : 'Cliente nuevo: se crea su cuenta corriente.';
  else { const c = S.clientes.get(r.id); el.textContent = c.nombre + (c.saldo > 0 ? ' debe ' + money(c.saldo) : c.saldo < 0 ? ' tiene saldo a favor de ' + money(-c.saldo) : ' está al día') + '.'; }
}
function actualizarPend(){
  const el = $('#txtPend');
  if ($('#bloqueRecibido').hidden){ el.textContent = ''; return; }
  const imp = leerImporte($('#oImp').value), rec = $('#oRec').value.trim() ? leerImporte($('#oRec').value) : { v:0 };
  if (!imp){ el.textContent = ''; return; }
  if (!rec){ el.textContent = 'El importe recibido no es válido.'; el.className = 'small debe'; return; }
  el.className = 'small';
  el.textContent = rec.v > imp.v ? 'Lo recibido no puede superar el importe de la operación.' :
    'Total ' + money(imp.v) + ' · recibido ' + money(rec.v) + ' · queda pendiente ' + money(round2(imp.v - rec.v)) + '.';
  if (rec.v > imp.v) el.className = 'small debe';
}
function mostrarError(msg){ const e = $('#oError'); e.textContent = msg || ''; e.hidden = !msg; }
function nuevoIdForm(){ S.F.id = S.db ? S.db.nuevoId('movimientos') : null; }
function agregarOperacion(ev){
  ev.preventDefault();
  if (!S.db || !S.canWrite){ mostrarError('Todavía no hay conexión con la base. Esperá a que diga «Sincronizado».'); return; }
  const t = S.F.tipo, medio = S.F.medio;
  const art = $('#oArt').value.trim().replace(/\s+/g,' ');
  const det = $('#oDet').value.trim();
  const imp = leerImporte($('#oImp').value);
  if (!imp){ mostrarError('Escribí un importe mayor a cero, por ejemplo 2500.'); $('#oImp').focus(); return; }
  if (imp.neg){ mostrarError('Escribí el importe sin signo: en los egresos la app lo resta sola.'); return; }
  if (t !== 'cobro' && !art){ mostrarError('Escribí el artículo o la descripción.'); $('#oArt').focus(); return; }
  const resp = $('#oResp').value, cat = $('#oCat').value;
  const base = { medio, desc:art, detalles:det, resp, cat };
  if (medio === 'transferencia'){
    base.titular = t === 'egreso' ? '' : $('#oTitular').value.trim(); base.cuentaId = $('#oCuenta').value;
  }
  const docs = [], nuevos = new Map();
  const idMov = S.F.id || S.db.nuevoId('movimientos');
  if (t === 'egreso'){
    const sub = $('#oSub').value || 'gasto';
    if (sub === 'retiro' && !$('#oRetiro').value){ mostrarError('Elegí quién hizo el retiro.'); return; }
    if ((sub === 'retiro' || sub === 'otro') && !det && !S.F.sinMotivo){
      S.F.sinMotivo = true; mostrarError('Conviene anotar el motivo en Detalles. Tocá otra vez el botón para guardar sin motivo.'); $('#oDet').focus(); return;
    }
    docs.push({ id:idMov, data:docMov(Object.assign(base, { tipo:'egreso', sub, importe:-imp.v, retiroPor: $('#oRetiro').value || null })) });
  } else if (t === 'cobro'){
    const nom = $('#oCliente').value.trim();
    if (!nom){ mostrarError('Elegí el cliente que paga.'); $('#oCliente').focus(); return; }
    const r = existeCliente(nom);
    if (r.nuevo){ mostrarError('No existe una cuenta con ese nombre. Revisá el nombre o creá antes un fiado.'); return; }
    docs.push({ id:idMov, data:docMov(Object.assign(base, { tipo:'pago', origen:'deuda', desc:art || 'Pago de cuenta corriente', importe:imp.v, clienteId:r.id, clienteNombre:r.nombre })) });
  } else if (medio === 'fiado'){
    const nom = $('#oCliente').value.trim().replace(/\s+/g,' ');
    if (!nom){ mostrarError('Un fiado necesita el cliente. Si todavía no sabés el nombre, tocá «Sin nombre aún».'); $('#oCliente').focus(); return; }
    const rec = $('#oRec').value.trim() ? leerImporte($('#oRec').value) : { v:0 };
    if (!rec){ mostrarError('El importe recibido no es válido.'); return; }
    if (rec.v > imp.v){ mostrarError('Lo recibido no puede ser mayor que el importe de la operación.'); return; }
    const prov = /^sin identificar/i.test(nom);
    const c = asegurarCliente(nom, nuevos, prov);
    docs.push({ id:idMov, data:docMov(Object.assign(base, { tipo:'fiado', importe:imp.v, clienteId:c.id, clienteNombre:c.nombre, medio:'fiado', titular:null, alias:null, cuentaId:null })) });
    if (rec.v > 0){
      docs.push({ id:S.db.nuevoId('movimientos'), data:docMov({ tipo:'pago', origen:'venta', ref:idMov, desc:'Pago inicial: ' + art, importe:rec.v,
        medio:$('#oRecMedio').value || 'efectivo', clienteId:c.id, clienteNombre:c.nombre, resp, cat }) });
    }
  } else {
    docs.push({ id:idMov, data:docMov(Object.assign(base, { tipo:'venta', importe:imp.v })) });
  }
  escribir(docs, nuevos);
  guardarPrefs(t === 'cobro' ? null : medio, t === 'venta' ? cat : null);
  if (medio === 'fiado' && t === 'venta') S.F.medio = prefMedio();
  S.F.sinMotivo = false; mostrarError('');
  ['#oArt','#oImp','#oDet','#oTitular','#oRec'].forEach(s => { $(s).value = ''; });
  if (t === 'cobro' || medio === 'fiado') $('#oCliente').value = '';
  nuevoIdForm(); aplicarForm();
  toast(t === 'egreso' ? 'Egreso agregado.' : t === 'cobro' ? 'Cobro registrado.' : 'Agregado.');
  $('#oArt').focus();
  programar();
}

// ---------- fila de la libreta (Anotar, Historial, Cuentas) ----------
function tipoPill(m){
  if (m.tipo === 'venta') return ['venta','Venta'];
  if (m.tipo === 'fiado') return ['fiado','Fiado'];
  if (m.tipo === 'pago') return ['pago', m.origen === 'venta' ? 'Pago inicial' : 'Cobro'];
  return ['egreso', m.sub === 'retiro' ? 'Retiro' : (EGR_TXT[m.sub] || 'Egreso')];
}
function filaMov(m, o){
  o = o || {};
  const [pc, pt] = tipoPill(m);
  const cli = (m.clienteId && !o.sinCliente) ? '<button class="link" type="button" data-act="cliente" data-id="' + esc(m.clienteId) + '">' + esc((S.clientes.get(m.clienteId) || {}).nombre || m.clienteNombre || 'Cliente') + '</button>' : '';
  let acc = '';
  if (S.canWrite && S.db){
    acc += '<button class="btn-mini" type="button" data-act="editar" data-id="' + esc(m.id) + '">Editar' + (m.historial.filter(h => h.antes).length ? ' (' + m.historial.filter(h => h.antes).length + ')' : '') + '</button>';
    if (m.anulado) acc += '<button class="btn-mini" type="button" data-act="restaurar-mov" data-id="' + esc(m.id) + '">Restaurar</button>';
    else if (S.anulando === m.id) acc += '<span class="conf">¿Anular? <button class="btn-mini peligro" type="button" data-act="anular-si" data-id="' + esc(m.id) + '">Sí</button><button class="btn-mini" type="button" data-act="anular-no">No</button></span>';
    else acc += '<button class="btn-mini" type="button" data-act="anular" data-id="' + esc(m.id) + '">Anular</button>';
  }
  const meta = [fmtHora(m.fecha)]; if (o.fechaCompleta) meta.unshift(fmtCorta(m.fecha));
  if (m.resp) meta.push(respNombre(m.resp) + (m.cat ? ' · ' + catNombre(m.cat) : '')); else if (m.cat) meta.push(catNombre(m.cat));
  const med = m.tipo === 'fiado' ? 'Fiado' : (MEDIO_TXT[m.medio] || m.medio);
  const tr = [m.titular, m.alias && ('alias ' + m.alias), m.cuentaId && cuentaNombre(m.cuentaId)].filter(Boolean).join(' · ');
  let imp = money(m.importe);
  if (m.tipo === 'egreso' && m.importe > 0) imp = money(-m.total);
  let sub = '';
  if (m.tipo === 'fiado'){ const rec = S.recPorRef.get(m.id) || 0; sub = rec ? '<span class="l-meta">recibido ' + money(rec) + ' · pendiente ' + money(round2(m.total - rec)) + '</span>' : ''; }
  const quien = m.autorChat || m.por;
  const det = [m.detalles ? '<span class="l-det">' + esc(m.detalles) + '</span>' : '',
    '<span class="l-meta">' + (m.sub === 'retiro' && m.retiroPor ? 'Retiró ' + esc(respNombre(m.retiroPor)) + ' · ' : '') + (quien ? 'Registró ' + esc(quien) : '') +
      (m.modificado > m.creado + 1000 ? ' · editado ' + esc(fmtFechaHora(m.modificado)) : '') + (m.anulado ? ' · ANULADA' + (m.anuladoPor ? ' por ' + esc(m.anuladoPor) : '') : '') + '</span>',
    acc ? '<div class="acciones">' + acc + '</div>' : ''].join('');
  return '<li class="lib-row' + (m.anulado ? ' anulado' : '') + '">' +
    '<div class="c-art"><div class="l-top"><span class="pill pill-' + pc + '">' + esc(pt) + '</span>' + cli + '</div><b>' + esc(m.desc || 'Sin descripción') + '</b><span class="l-meta">' + esc(meta.join(' · ')) + '</span></div>' +
    '<div class="c-imp"><span class="monto monto-' + (m.tipo === 'egreso' ? 'egreso' : m.tipo) + '">' + imp + '</span>' + sub + '</div>' +
    '<div class="c-med"><span>' + esc(med) + '</span>' + (tr ? '<div class="l-meta">' + esc(tr) + '</div>' : '') + '</div>' +
    '<div class="c-det">' + det + '</div></li>';
}
function renderAnotar(){
  const hoy0 = startOfDay(Date.now());
  const hoy = S.lista.filter(m => m.fecha >= hoy0);
  const vivos = hoy.filter(m => !m.anulado), caja = calcularCaja(vivos);
  $('#hoyResumen').textContent = vivos.length ? 'vendido ' + money(caja.ventas) + ' · egresos ' + money(-caja.egrTotal) : '';
  const lista = hoy.slice(0, 60);
  $('#hoyLista').innerHTML = lista.length ? lista.map(m => filaMov(m)).join('') :
    '<li>' + vacio('Todavía no hay operaciones hoy', 'Completá el formulario de arriba y tocá Agregar. Cada operación aparece acá al instante, también en el otro celular.') + '</li>';
  if (hoy.length > 60) $('#hoyLista').insertAdjacentHTML('beforeend', '<li class="small muted">Y ' + (hoy.length - 60) + ' más. Mirá el Historial.</li>');
  actualizarArticulos();
  $('#dlClientes').innerHTML = [...S.clientes.values()].filter(c => !c.fusionadoEn).map(c => '<option value="' + esc(c.nombre) + '"></option>').join('');
  if (S.parsed) reparse();
}

// ---------- texto pegado / chat ----------
function fechaBase(){
  const v = $('#fecha').value;
  if (!v || v === dayKey(Date.now())) return Date.now();
  return keyToMs(v) + 12 * 3600000;
}
function idImportado(e){ return e.clave ? 'imp-' + cyrb53(e.clave) : null; }
function reparse(){
  const texto = $('#entrada').value;
  if (!texto.trim()){ S.parsed = null; $('#preview').innerHTML = ''; actualizarBoton(); return; }
  const msgs = splitMessages(texto, fechaBase());
  const entries = [], avisos = [];
  for (const msg of msgs){
    const r = interpretar(msg);
    r.entries.forEach((e, k) => {
      e.fecha = msg.fecha + k; e.autorChat = msg.autorChat || '';
      e.clave = msg.conFecha ? [msg.fecha, norm(msg.autorChat), k, e.tipo, norm(e.clienteNombre || ''), e.items.map(i => norm(i.d) + ':' + i.m).join('/')].join('|') : null;
      if (e.clienteNombre) e.cli = existeCliente(e.clienteNombre);
      const id = idImportado(e); e.dup = !!(id && S.mapa.has(id));
      entries.push(e);
    });
    avisos.push(...r.avisos);
  }
  S.parsed = { entries, avisos };
  renderPreview(); actualizarBoton();
}
function renderPreview(){
  const p = S.parsed, box = $('#preview');
  if (!p){ box.innerHTML = ''; return; }
  const nuevos = p.entries.filter(e => !e.dup), c = { venta:0, fiado:0, pago:0 };
  nuevos.forEach(e => { c[e.tipo]++; });
  const dups = p.entries.length - nuevos.length;
  let h = '';
  if (p.entries.length){
    const partes = [];
    if (c.venta) partes.push(pl(c.venta,'venta','ventas')); if (c.fiado) partes.push(pl(c.fiado,'fiado','fiados')); if (c.pago) partes.push(pl(c.pago,'pago','pagos'));
    if (dups) partes.push(pl(dups,'ya cargada','ya cargadas'));
    h += '<p class="resumen-pv">Así lo entendí: ' + esc(partes.join(' · ')) + '</p>';
  }
  p.avisos.slice(0,6).forEach(a => { h += '<p class="aviso">' + esc(a) + '</p>'; });
  if (p.avisos.length > 6) h += '<p class="aviso">Y ' + (p.avisos.length - 6) + ' avisos más.</p>';
  p.entries.slice(0,40).forEach(e => {
    const nom = e.cli ? (e.cli.nuevo ? e.clienteNombre : e.cli.nombre) : '';
    const tp = e.tipo === 'pago' ? 'Cobro' : e.tipo === 'fiado' ? 'Fiado' : 'Venta';
    h += '<article class="card stack' + (e.dup ? '" style="opacity:.6' : '') + '"><div class="l-top"><span class="pill pill-' + (e.tipo === 'pago' ? 'pago' : e.tipo) + '">' + tp + '</span>' +
      (nom ? '<b>' + esc(nom) + '</b>' : '') + (e.cli && e.cli.nuevo ? '<span class="pill pill-egreso">cliente nuevo</span>' : '') + (e.dup ? '<span class="pill pill-egreso">ya cargada</span>' : '') + '</div>' +
      e.items.map(i => '<div class="row" style="justify-content:space-between;flex-wrap:nowrap"><span>' + esc(i.d) + '</span><span class="num">' + money(i.m) + '</span></div>').join('') +
      '<p class="small muted">' + (e.items.length > 1 ? 'Total ' + money(e.total) + ' · ' : '') + (e.tipo === 'fiado' ? 'queda en su cuenta' : (MEDIO_TXT[e.medio] || '') + (e.titular ? ' de ' + esc(e.titular) : '')) +
      (e.autorChat ? ' · ' + esc(e.autorChat) : '') + ' · ' + esc(fmtFechaHora(e.fecha)) + '</p></article>';
  });
  if (p.entries.length > 40) h += '<p class="small muted">Y ' + (p.entries.length - 40) + ' anotaciones más.</p>';
  box.innerHTML = h;
}
function actualizarBoton(){
  if (S.guardando) return;
  const b = $('#btnGuardar'), n = S.parsed ? S.parsed.entries.filter(e => !e.dup).length : 0;
  b.disabled = !n || !S.db || !S.canWrite;
  b.textContent = n ? 'Guardar ' + pl(n,'anotación','anotaciones') : 'Guardar';
}
async function guardarTexto(){
  if (S.guardando || !S.db || !S.parsed) return;
  reparse();
  let todo = S.parsed.entries.filter(e => !e.dup);
  if (!todo.length) return;
  S.guardando = true;
  const b = $('#btnGuardar'); b.disabled = true; b.textContent = 'Revisando duplicados…';
  try {
    // los mensajes anteriores a la ventana en vivo se buscan en la base antes de escribir
    const viejos = todo.filter(e => e.clave && e.fecha < S.ventana);
    if (viejos.length){
      const claves = [...new Set(viejos.map(e => e.clave))], hallados = new Set();
      for (let i = 0; i < claves.length; i += 30){
        const snap = await S.db.get('movimientos', [['clave','in',claves.slice(i, i + 30)]]);
        snap.docs.forEach(d => hallados.add((d.data() || {}).clave));
      }
      todo = todo.filter(e => !(e.clave && hallados.has(e.clave)));
    }
    const nuevos = new Map(), docs = [];
    for (const e of todo){
      let cli = null;
      if (e.clienteNombre){
        if (e.tipo === 'pago' && existeCliente(e.clienteNombre).nuevo && ![...nuevos.values()].some(v => norm(v.nombre) === norm(e.clienteNombre))) cli = asegurarCliente(e.clienteNombre, nuevos, false);
        else cli = asegurarCliente(e.clienteNombre, nuevos, false);
      }
      const resp = '';
      const base = { fecha:e.fecha, autorChat:e.autorChat, clave:e.clave, resp, cat:'' };
      let o;
      if (e.tipo === 'venta') o = Object.assign(base, { tipo:'venta', desc:e.items[0].d, importe:e.total, medio:e.medio, titular:e.titular || null });
      else if (e.tipo === 'fiado') o = Object.assign(base, { tipo:'fiado', desc:e.items.map(i => i.d).join(' · '), items:e.items, importe:e.total, clienteId:cli.id, clienteNombre:cli.nombre,
        detalles: e.items.length > 1 ? e.items.map(i => i.d + ' ' + money(i.m)).join('\n') : '' });
      else o = Object.assign(base, { tipo:'pago', origen:'deuda', desc:'Pago de cuenta corriente', importe:e.total, medio:e.medio, titular:e.titular || null, clienteId:cli.id, clienteNombre:cli.nombre });
      docs.push({ id:idImportado(e) || S.db.nuevoId('movimientos'), data:docMov(o) });
    }
    if (!docs.length){ toast('Todo eso ya estaba cargado.'); }
    else { escribir(docs, nuevos); toast('Guardado: ' + pl(docs.length,'anotación','anotaciones') + '.'); }
    $('#entrada').value = '';
    S.guardando = false; reparse();
  } catch (err){
    toast('No se pudo guardar. Probá de nuevo.', true);
  } finally { S.guardando = false; actualizarBoton(); }
}
const EJEMPLO = ['Supremas de pollo 1kg $9000','Tortillas X5 unidades $1000','Paquete de papel higiénico $2500 (alias Ernesto Ramírez)','',
  'Maple de huevos $6500','Gaseosa 2,25 lt $2800','Marta Gómez debe','','Marta Gómez pagó $3000'].join('\n');

// ---------- pantalla: Cuentas ----------
function renderCuentas(){
  const c = S.cliSel ? S.clientes.get(S.cliSel) : null;
  $('#cuentasLista').hidden = !!c; $('#cuentaDetalle').hidden = !c;
  if (c){ renderDetalle(c); return; }
  const q = norm($('#qCuentas').value);
  let todos = [...S.clientes.values()].filter(x => !x.fusionadoEn);
  const total = todos.length;
  if (q) todos = todos.filter(x => norm(x.nombre).includes(q));
  const deben = todos.filter(x => x.saldo > 0).sort((a,b) => b.saldo - a.saldo);
  const favor = todos.filter(x => x.saldo < 0).sort((a,b) => a.saldo - b.saldo);
  const aldia = todos.filter(x => x.saldo === 0).sort((a,b) => a.nombre.localeCompare(b.nombre,'es'));
  const nDeben = [...S.clientes.values()].filter(x => !x.fusionadoEn && x.saldo > 0).length;
  $('#cuentasResumen').textContent = total ? (S.deuda > 0 ? 'Te deben ' + money(S.deuda) + ' entre ' + pl(nDeben,'cliente','clientes') + '.' : 'Nadie te debe nada ahora.') : '';
  const fila = x => '<button class="cuenta" type="button" data-act="cliente" data-id="' + esc(x.id) + '"><span class="cuenta-n">' + esc(x.nombre) + (x.provisorio ? ' <span class="pill pill-egreso">provisoria</span>' : '') + '</span>' +
    '<span class="cuenta-s">' + (x.ultimo ? 'último movimiento ' + esc(fmtCorta(x.ultimo)) : 'sin movimientos') + '</span>' +
    '<span class="cuenta-m ' + (x.saldo > 0 ? 'debe' : x.saldo < 0 ? 'favor' : 'muted') + '">' + (x.saldo === 0 ? 'Al día' : money(Math.abs(x.saldo))) + '</span></button>';
  let h = '';
  if (!total) h = vacio('Todavía no hay cuentas', 'Se crean solas cuando anotás un fiado: elegí «Fiado» como medio de pago y escribí el nombre del cliente.');
  else if (!todos.length) h = vacio('Sin resultados', 'No hay clientes que coincidan con la búsqueda.');
  else {
    if (deben.length) h += '<div class="stack">' + deben.map(fila).join('') + '</div>';
    if (favor.length) h += '<h3 style="margin-top:6px">Con saldo a favor</h3><div class="stack">' + favor.map(fila).join('') + '</div>';
    if (aldia.length){
      if (S.verAlDia || q) h += '<h3 style="margin-top:6px">Al día</h3><div class="stack">' + aldia.map(fila).join('') + '</div>';
      else h += '<button class="btn btn-ghost" type="button" data-act="verAlDia">Mostrar ' + pl(aldia.length,'cliente al día','clientes al día') + '</button>';
    }
  }
  $('#cuentasItems').innerHTML = h;
}
function renderDetalle(c){
  const hist = S.cliMovs.slice().sort((a,b) => a.fecha - b.fecha || a.creado - b.creado);
  let run = 0;
  const filas = hist.map(m => { run += efectoSaldo(m); return { m, run:round2(run) }; }).reverse();
  const calc = round2(run);
  $('#detNombre').innerHTML = esc(c.nombre) + (c.provisorio ? ' <span class="pill pill-egreso">provisoria</span>' : '');
  const el = $('#detSaldo');
  el.textContent = c.saldo > 0 ? 'Debe ' + money(c.saldo) : c.saldo < 0 ? 'A favor ' + money(-c.saldo) : 'Al día';
  el.className = 'saldo-grande ' + (c.saldo > 0 ? 'debe' : c.saldo < 0 ? 'favor' : '');
  $('#detSub').textContent = c.ultimo ? 'Último movimiento: ' + fmtCorta(c.ultimo) : 'Sin movimientos todavía.';
  const dv = $('#detDesvio');
  const cargado = S.cliCargado === c.id;
  if (cargado && Math.abs(calc - c.saldo) > 0.009){
    dv.hidden = false; dv.innerHTML = 'El saldo guardado (' + money(c.saldo) + ') no coincide con la suma del historial (' + money(calc) + '). <button class="btn-mini" type="button" data-act="corregirSaldo">Corregir saldo</button>';
  } else dv.hidden = true;
  $('#btnSaldar').hidden = !(S.modo === 'pago' && c.saldo > 0);
  if (document.activeElement !== $('#cliObs') && S.obsCliente !== c.id){ $('#cliObs').value = c.obs; S.obsCliente = c.id; }
  $('#detMovs').innerHTML = !cargado ? '<li class="small muted">Cargando historial…</li>' : filas.length ? filas.map(f => {
    let html = filaMov(f.m, { sinCliente:true, fechaCompleta:true });
    if (!f.m.anulado) html = html.replace('</div></li>', '<span class="l-meta">Saldo después: <b class="num ' + (f.run > 0 ? 'debe' : '') + '">' + money(f.run) + '</b></span></div></li>');
    return html;
  }).join('') : '<li>' + vacio('Sin movimientos', 'Anotá un fiado o un pago con el formulario de arriba.') + '</li>';
  $('#btnManual').disabled = !(S.canWrite && S.db);
}
function abrirCliente(id){
  if (!S.clientes.get(id)) return;
  cerrarClienteSub();
  S.cliSel = id; S.modo = 'fiado'; S.cliMovs = []; S.cliCargado = null; S.obsCliente = null;
  $('#mDetalle').value = ''; $('#mMonto').value = ''; $('#formNombre').hidden = true; $('#bloqueUnificar').hidden = true;
  aplicarModo(); setView('cuentas'); window.scrollTo(0,0);
  if (S.db) S.unCli = S.db.listen('movimientos', [['clienteId','==',id]], snap => {
    S.cliMovs = snap.docs.map(leerMov); S.cliCargado = id; programar();
  }, () => {});
}
function cerrarClienteSub(){ if (S.unCli){ try { S.unCli(); } catch (_) {} S.unCli = null; } }
function aplicarModo(){
  $$('[data-act="modo"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.modo)));
  $('#campoDetalle').hidden = S.modo !== 'fiado'; $('#campoMedio').hidden = S.modo !== 'pago';
  $('#btnManual').textContent = S.modo === 'fiado' ? 'Anotar fiado' : 'Registrar pago';
  const c = S.cliSel ? S.clientes.get(S.cliSel) : null;
  $('#btnSaldar').hidden = !(S.modo === 'pago' && c && c.saldo > 0);
}
function guardarManual(ev){
  ev.preventDefault();
  if (!S.db || !S.canWrite || !S.cliSel) return;
  const c = S.clientes.get(S.cliSel); if (!c) return;
  const imp = leerImporte($('#mMonto').value);
  if (!imp || imp.neg){ toast('Escribí un monto mayor a cero.', true); return; }
  const resp = '';
  const o = S.modo === 'fiado'
    ? { tipo:'fiado', desc:$('#mDetalle').value.trim() || 'Fiado', importe:imp.v, medio:'fiado' }
    : { tipo:'pago', origen:'deuda', desc:'Pago de cuenta corriente', importe:imp.v, medio:$('#mMedio').value || 'efectivo' };
  Object.assign(o, { clienteId:c.id, clienteNombre:c.nombre, resp });
  escribir([{ id:S.db.nuevoId('movimientos'), data:docMov(o) }], null);
  $('#mDetalle').value = ''; $('#mMonto').value = '';
  toast(S.modo === 'fiado' ? 'Fiado anotado.' : 'Pago registrado.');
}
function unificarCuentas(){
  const c = S.clientes.get(S.cliSel), destId = $('#selUnificar').value, dest = S.clientes.get(destId);
  if (!c || !dest || destId === c.id){ toast('Elegí la cuenta de destino.', true); return; }
  if (S.cliCargado !== c.id){ toast('Esperá a que cargue el historial.', true); return; }
  const movs = S.cliMovs, TAM = 200, now = Date.now();
  for (let i = 0; i < movs.length || i === 0; i += TAM){
    const b = S.db.batch();
    movs.slice(i, i + TAM).forEach(m => b.update('movimientos', m.id, { clienteId:dest.id, clienteNombre:dest.nombre, modificado:now,
      historial:S.db.union(histEntry({ cliente:c.nombre }, { cliente:dest.nombre }, 'Cuenta unificada')) }));
    if (i + TAM >= movs.length){
      b.merge('clientes', dest.id, { saldo:S.db.inc(round2(c.saldo)), ultimo:Math.max(dest.ultimo, c.ultimo) });
      b.merge('clientes', c.id, { saldo:0, fusionadoEn:dest.id, obs:(c.obs ? c.obs + ' ' : '') + '(unificada con ' + dest.nombre + ')' });
    }
    b.commit();
  }
  toast('Cuentas unificadas.'); S.cliSel = null; cerrarClienteSub(); programar();
}

// ---------- pantalla: Caja ----------
function movsDelDia(dia){
  const a = keyToMs(dia), b = a + DIA_MS;
  return S.lista.filter(m => m.fecha >= a && m.fecha < b);
}
const elec = o => round2((o.transferencia || 0) + (o.debito || 0) + (o.credito || 0));
function filasCaja(c, fondo, esperado){
  const f = (l, v, cls) => '<div class="' + (cls || '') + '"><span>' + l + '</span><span class="num">' + v + '</span></div>';
  const egrE = round2(c.egrTotal - (c.egrMedio.efectivo || 0));
  return '<div class="kv">' +
    f('Ventas totales (' + pl(c.nVentas,'venta','ventas') + ')', money(c.ventas), 'tot') +
    f('Cobradas en efectivo', money(c.porMedio.efectivo), 'sub') + f('Cobradas por transferencia / electrónico', money(elec(c.porMedio)), 'sub') +
    f('Fiadas (no suman al efectivo hasta cobrarse)', money(c.fiadas), 'sub') +
    f('Cobros de deudas anteriores (no son ventas)', money(c.cobros), 'tot') +
    (c.cobros ? f('En efectivo', money(c.cobrosMedio.efectivo), 'sub') + f('Por transferencia / electrónico', money(elec(c.cobrosMedio)), 'sub') : '') +
    f('Egresos', money(-c.egrTotal), 'tot') + f('En efectivo', money(-(c.egrMedio.efectivo || 0)), 'sub') + f('Electrónicos', money(-egrE), 'sub') +
    f('Gastos operativos', money(-c.egr.gasto), 'sub') + f('Compras de mercadería', money(-c.egr.compra), 'sub') + f('Pagos a proveedores', money(-c.egr.proveedor), 'sub') +
    f('Otros egresos', money(-c.egr.otro), 'sub') + f('Retiros personales', money(-c.egr.retiro), 'sub') +
    f('Fondo inicial', money(fondo), 'tot') +
    f('Efectivo esperado', money(esperado), 'hl tot') + '</div>';
}
const cierresDia = dia => S.cierres.filter(x => x.dia === dia).sort((a,b) => b.creado - a.creado);
const cierreCompleto = dia => cierresDia(dia).find(x => x.estado === 'completo') || null;
const bloqueado = dia => !!cierreCompleto(dia) && !S.D.rect;
const resIds = () => S.cfg.responsables.map(r => r.id);
function miResp(){ const r = S.cfg.responsables.find(x => norm(x.nombre) === norm(S.nombre)); return r ? r.id : ''; }
function sugerido(m){
  if (m.resp && S.cfg.responsables.some(r => r.id === m.resp)) return m.resp;
  const r = m.cat && S.cfg.responsables.find(x => x.cats.includes(m.cat)); return r ? r.id : '';
}
const leerAsig = d => { const x = d.data() || {};
  return { id:d.id, movId:x.movId || d.id, dia:String(x.dia || ''), estado:x.estado === 'asignado' ? 'asignado' : 'pendiente',
    partes:Array.isArray(x.partes) ? x.partes.map(p => ({ resp:String(p.resp || ''), importe:Number(p.importe) || 0 })) : [],
    modificado:Number(x.modificado) || 0, creado:Number(x.creado) || 0, por:x.por || '', porUid:x.porUid || '', cierreId:x.cierreId || null, historial:Array.isArray(x.historial) ? x.historial : [] }; };
function derivarAsig(){ S.asigAll = new Map([...S.asigExtra, ...S.asig]); }
async function cargarAsigDia(dia){
  if (S.asigDias.has(dia) || !S.db) return;
  S.asigDias.add(dia);
  try { const snap = await S.db.get('asignaciones', [['dia','==',dia]]); snap.docs.forEach(d => S.asigExtra.set(d.id, leerAsig(d))); derivarAsig(); programar(); }
  catch (_) { S.asigDias.delete(dia); }
}
async function cargarCliCache(id){
  if (!S.db || S.cliCache.get(id) === null) return;
  const t = S.cliTry.get(id) || 0; if (Date.now() - t < 15000) return;
  S.cliTry.set(id, Date.now()); S.cliCache.set(id, null);
  try { const snap = await S.db.get('movimientos', [['clienteId','==',id]]); S.cliCache.set(id, snap.docs.map(leerMov)); }
  catch (_) { S.cliCache.delete(id); }
  programar();
}
function origenCobro(c){
  const cid = c.clienteId; if (!cid) return 'sin cliente';
  const ms = S.cliCache.get(cid);
  if (ms === undefined || (ms && !ms.some(x => x.id === c.id))){ if (ms) S.cliCache.delete(cid); cargarCliCache(cid); return 'buscando la venta original…'; }
  if (ms === null) return 'buscando la venta original…';
  const ap = aplicarCobros(ms).get(c.id) || [];
  if (!ap.length) return 'sin venta original';
  return ap.map(p => {
    if (!p.fiado) return 'saldo sin venta original (' + money(p.importe) + ')';
    const a = S.asigAll.get(p.fiado.id);
    const quien = asigValida(p.fiado, a) ? a.partes.map(x => respNombre(x.resp)).join(' y ') : 'sin asignar';
    return '«' + p.fiado.desc + '» del ' + fmtCorta(p.fiado.fecha) + ' (' + quien + ')';
  }).join(' · ');
}
function resumenPartes(ps){ return ps.map(p => respNombre(p.resp) + ' ' + money(p.importe)).join(' + '); }
function asignar(m, partes){
  if (!S.db) return;
  const prev = S.asigAll.get(m.id), now = Date.now(), dia = dayKey(m.fecha);
  const entrada = { fecha:now, por:S.nombre || null, porUid:S.uid || null, rect:!!S.D.rect,
    antes: prev && prev.estado === 'asignado' ? resumenPartes(prev.partes) : 'pendiente', despues: partes.length ? resumenPartes(partes) : 'pendiente' };
  const d = { movId:m.id, dia, estado: partes.length ? 'asignado' : 'pendiente', partes, tipo:m.tipo, total:m.total, desc:m.desc,
    por:S.nombre || null, porUid:S.uid || null, modificado:now, cierreId:null, historial:S.db.union(entrada) };
  if (!prev) d.creado = now;
  const b = S.db.batch(); b.merge('asignaciones', m.id, d); b.commit();
}
function moverA(id, r, mod){
  if (!S.db || !S.canWrite) return;
  const m = S.mapa.get(id); if (!m || !esDistribuible(m)) return;
  if (bloqueado(dayKey(m.fecha))){ toast('Este día está cerrado. Para cambiarlo, rectificá el cierre.', true); return; }
  const a = S.asigAll.get(id);
  if ((a ? a.modificado : 0) !== mod){ toast('Otra persona cambió esta asignación. Revisá y probá de nuevo.', true); return; }
  if (r === 'pend'){ if (asigValida(m, a)) asignar(m, []); return; }
  if (asigValida(m, a) && a.partes.length === 1 && a.partes[0].resp === r) return;
  asignar(m, [{ resp:r, importe:m.total }]);
}
function cardD(m, bucket, importe, dividido, bloq, desact){
  const a = S.asigAll.get(m.id), mod = a ? a.modificado : 0, sug = sugerido(m), ed = !bloq && S.canWrite && !!S.db;
  const btn = r => '<button type="button" class="btn-mini' + (bucket === 'pend' && r.id === sug ? ' sug' : '') + '" data-act="dasig" data-id="' + esc(m.id) + '" data-r="' + esc(r.id) + '" data-mod="' + mod + '">' + esc(r.nombre) + '</button>';
  const btns = ed ? S.cfg.responsables.filter(r => r.id !== bucket).map(btn).join('') +
    (bucket !== 'pend' ? '<button type="button" class="btn-mini" data-act="dasig" data-id="' + esc(m.id) + '" data-r="pend" data-mod="' + mod + '">Pendiente</button>' : '') +
    '<button type="button" class="btn-mini" data-act="ddiv" data-id="' + esc(m.id) + '">Dividir</button>' : '';
  return '<li class="d-card" data-mov="' + esc(m.id) + '">' + (ed ? '<span class="d-grip" data-grip="' + esc(m.id) + '" data-mod="' + mod + '" aria-hidden="true">⠿</span>' : '') +
    '<div class="d-t"><b>' + esc(m.desc || 'Sin descripción') + '</b><span class="num monto monto-' + (m.tipo === 'egreso' ? 'egreso' : m.tipo) + '">' + money(m.tipo === 'egreso' ? -importe : importe) + '</span></div>' +
    (dividido ? '<span class="l-meta">Parte de ' + money(m.total) + ' · dividido</span>' : '') +
    (desact ? '<span class="l-meta debe">El importe cambió desde la asignación: volvé a asignarlo.</span>' : '') +
    '<div class="d-btns">' + btns + '<button type="button" class="link" data-act="dver" data-id="' + esc(m.id) + '">Ver</button></div></li>';
}
function renderDistrib(){
  const el = $('#distrib'), dia = S.C.dia;
  if (document.activeElement && document.activeElement.id === 'dMotivo') return;
  if (keyToMs(dia) < S.ventana) cargarAsigDia(dia);
  const movs = movsDelDia(dia), D = distribuir(movs, S.asigAll, resIds());
  S.D.last = D;
  const cc = cierreCompleto(dia), bloq = !!cc && !S.D.rect;
  let h = '<h3>A. Distribución por responsable</h3><p class="small muted" style="margin-top:-4px">A quién corresponde cada movimiento del día. Las ventas suman y los egresos restan. Podés tocar los botones o arrastrar el movimiento (⠿) hasta una columna.</p>';
  if (bloq) h += '<div class="d-bloq">Cierre confirmado el ' + esc(fmtFechaHora(cc.creado)) + ' por ' + esc(cc.por || '—') + '. La distribución está bloqueada. Para corregirla hay que rectificar el cierre: queda registrado quién, cuándo y por qué.' +
    '<div class="row" style="margin-top:6px;flex-wrap:nowrap"><input id="dMotivo" class="grow" type="text" placeholder="Motivo de la rectificación" value="' + esc(S.D.motivoTxt) + '"><button class="btn-mini" type="button" data-act="drect">Rectificar</button></div></div>';
  if (S.D.rect) h += '<div class="d-aviso">Rectificación en curso: «' + esc(S.D.motivo) + '». Al cerrar de nuevo se guarda un cierre nuevo que reemplaza al anterior; el original se conserva.</div>';
  if (!movs.some(esDistribuible)){ el.innerHTML = h + vacio('Sin movimientos para distribuir', 'Cuando haya ventas, fiados o egresos en este día van a aparecer acá, pendientes de asignar.'); return; }
  const m4 = n => money(n).replace('$ ','');
  const sel = S.D.sel === 'pend' || S.cfg.responsables.some(r => r.id === S.D.sel) ? S.D.sel : 'pend';
  h += '<div class="d-cols"><button type="button" class="d-col pend" data-act="dsel" data-v="pend" data-drop="pend" aria-pressed="' + (sel === 'pend') + '"><b>Pend.</b><span class="neto num">' + D.pend.length + '</span><small>sin asignar</small></button>' +
    S.cfg.responsables.map(r => { const c = D.col[r.id];
      return '<button type="button" class="d-col" data-act="dsel" data-v="' + esc(r.id) + '" data-drop="' + esc(r.id) + '" aria-pressed="' + (sel === r.id) + '"><b>' + esc(r.nombre) + '</b><small>Ing. ' + m4(c.ing) + '</small><small>Egr. ' + m4(c.egr) + '</small><span class="neto num">$' + m4(c.neto) + '</span><small>' + pl(c.n,'mov.','movs.') + '</small></button>'; }).join('') + '</div>';
  const lista = (id, items) => '<ul class="d-lista' + (sel === id ? ' on' : '') + '" data-b="' + esc(id) + '">' + (items.length ? items.join('') : '<li class="small muted">Nada por acá.</li>') + '</ul>';
  const pendOrd = D.pend.slice().sort((a, b) => a.creado - b.creado);
  h += '<div class="d-listas">' + lista('pend', pendOrd.map(m => cardD(m, 'pend', m.total, false, bloq, D.desact.includes(m.id)))) +
    S.cfg.responsables.map(r => lista(r.id, D.col[r.id].items.sort((a, b) => a.m.creado - b.m.creado).map(i => cardD(i.m, r.id, i.importe, i.dividido, bloq, false)))).join('') + '</div>';
  const cobros = movs.filter(m => !m.anulado && m.tipo === 'pago' && m.origen === 'deuda');
  if (cobros.length) h += '<div class="d-bloq"><b>Cobros de deudas anteriores (no son ventas)</b><br>' + cobros.map(c => '• ' + esc((S.clientes.get(c.clienteId) || {}).nombre || c.clienteNombre || 'Cliente') + ' ' + money(c.total) + ' → ' + esc(origenCobro(c))).join('<br>') + '</div>';
  const pI = round2(D.pend.filter(m => m.tipo !== 'egreso').reduce((s, m) => s + m.total, 0)), pE = round2(D.pend.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.total, 0));
  h += '<h3>Resultado de cada responsable</h3><div class="scroll-x"><table class="tabla mini"><thead><tr><th></th><th>Ingresos</th><th>Egresos</th><th>Neto asignado</th></tr></thead><tbody>' +
    S.cfg.responsables.map(r => '<tr><td>' + esc(r.nombre) + '</td><td>' + money(D.col[r.id].ing) + '</td><td>' + money(-D.col[r.id].egr) + '</td><td><b>' + money(D.col[r.id].neto) + '</b></td></tr>').join('') +
    '<tr><td>Sin asignar</td><td>' + money(pI) + '</td><td>' + money(-pE) + '</td><td>' + money(round2(pI - pE)) + '</td></tr></tbody></table></div>' +
    '<p class="small muted">Neto asignado = ingresos atribuidos − egresos atribuidos. No es la ganancia comercial real: todavía no se registran los costos de la mercadería.</p>';
  el.innerHTML = h;
}
// dividir un movimiento entre responsables
function abrirSplit(id){
  const m = S.mapa.get(id); if (!m) return;
  if (bloqueado(dayKey(m.fecha))){ toast('Este día está cerrado. Para cambiarlo, rectificá el cierre.', true); return; }
  const a = S.asigAll.get(id), partes = asigValida(m, a) ? a.partes : [];
  S.D.split = { id, mod:a ? a.modificado : 0 };
  $('#sInfo').textContent = (m.desc || 'Sin descripción') + ' · total ' + money(m.total) + (m.tipo === 'egreso' ? ' (egreso)' : '');
  $('#sFilas').innerHTML = S.cfg.responsables.map(r => { const p = partes.find(x => x.resp === r.id);
    return '<div class="row" style="flex-wrap:nowrap"><label class="check grow"><input type="checkbox" data-sc="' + esc(r.id) + '"' + (p ? ' checked' : '') + '> ' + esc(r.nombre) + '</label><input data-sa="' + esc(r.id) + '" type="text" inputmode="decimal" style="width:130px" placeholder="0" value="' + (p ? String(p.importe).replace('.', ',') : '') + '"></div>'; }).join('');
  $('#sError').hidden = true; sumaSplit(); $('#modalSplit').hidden = false;
}
function leerSplit(){
  const partes = []; let suma = 0;
  $$('#sFilas [data-sc]').forEach(cb => { const r = cb.dataset.sc, v = parseMonto($('#sFilas [data-sa="' + r + '"]').value);
    if (cb.checked && isFinite(v) && v > 0){ partes.push({ resp:r, importe:round2(v) }); suma += v; } });
  return { partes, suma:round2(suma) };
}
function sumaSplit(){
  const m = S.D.split && S.mapa.get(S.D.split.id); if (!m) return;
  const s = leerSplit(), dif = round2(m.total - s.suma);
  $('#sSuma').textContent = 'Suma ' + money(s.suma) + ' de ' + money(m.total) + (dif === 0 ? ': coincide.' : dif > 0 ? ': faltan ' + money(dif) + '.' : ': sobran ' + money(-dif) + '.');
  $('#sSuma').className = 'small ' + (dif === 0 ? 'favor' : 'debe'); $('#sOk').disabled = dif !== 0 || !s.partes.length;
}
function splitIguales(){
  const m = S.mapa.get(S.D.split.id), cbs = $$('#sFilas [data-sc]').filter(c => c.checked);
  if (!cbs.length){ $('#sError').textContent = 'Marcá al menos una persona.'; $('#sError').hidden = false; return; }
  $('#sError').hidden = true;
  const base = Math.floor(m.total / cbs.length * 100) / 100; let resto = m.total;
  cbs.forEach((c, i) => { const v = i === cbs.length - 1 ? round2(resto) : base; resto = round2(resto - v); $('#sFilas [data-sa="' + c.dataset.sc + '"]').value = String(v).replace('.', ','); });
  sumaSplit();
}
function guardarSplit(ev){
  ev.preventDefault();
  const sp = S.D.split, m = sp && S.mapa.get(sp.id); if (!m) return;
  const a = S.asigAll.get(m.id), err = $('#sError');
  if ((a ? a.modificado : 0) !== sp.mod){ err.textContent = 'Otra persona cambió esta asignación mientras la editabas. Cerrá y volvé a abrirla.'; err.hidden = false; return; }
  const s = leerSplit();
  if (Math.abs(s.suma - m.total) > 0.004 || !s.partes.length){ err.textContent = 'Las partes tienen que sumar exactamente ' + money(m.total) + '.'; err.hidden = false; return; }
  asignar(m, s.partes); S.D.split = null; $('#modalSplit').hidden = true; toast('División guardada.'); programar();
}
// arrastrar y soltar (mouse y táctil): se suelta sobre una columna de arriba
let drag = null;
document.addEventListener('pointerdown', ev => {
  const g = ev.target.closest && ev.target.closest('[data-grip]'); if (!g) return;
  ev.preventDefault();
  const ghost = g.closest('.d-card').cloneNode(true); ghost.classList.add('d-ghost'); ghost.style.left = (ev.clientX - 20) + 'px'; ghost.style.top = (ev.clientY - 20) + 'px'; document.body.appendChild(ghost);
  drag = { id:g.dataset.grip, mod:Number(g.dataset.mod) || 0, ghost, over:null };
  try { g.setPointerCapture(ev.pointerId); } catch (_) {}
});
document.addEventListener('pointermove', ev => {
  if (!drag) return;
  drag.ghost.style.left = (ev.clientX - 20) + 'px'; drag.ghost.style.top = (ev.clientY - 20) + 'px';
  const t = document.elementFromPoint(ev.clientX, ev.clientY), col = t && t.closest('[data-drop]');
  if (col !== drag.over){ if (drag.over) drag.over.classList.remove('over'); drag.over = col; if (col) col.classList.add('over'); }
});
const finDrag = ev => {
  if (!drag) return;
  const d = drag; drag = null; d.ghost.remove(); if (d.over) d.over.classList.remove('over');
  if (ev.type === 'pointerup' && d.over) moverA(d.id, d.over.dataset.drop, d.mod);
};
document.addEventListener('pointerup', finDrag); document.addEventListener('pointercancel', finDrag);

function renderCaja(){
  if (!S.C.dia) S.C.dia = dayKey(Date.now());
  if ($('#cDia').value !== S.C.dia) $('#cDia').value = S.C.dia;
  const dia = S.C.dia;
  if (keyToMs(dia) < S.ventana) cargarRango(keyToMs(dia), keyToMs(dia) + DIA_MS - 1);
  const previo = S.cierres.filter(c => c.dia < dia).sort((a,b) => b.dia.localeCompare(a.dia) || b.creado - a.creado)[0];
  if (!S.C.fondoTocado && document.activeElement !== $('#cFondo')) $('#cFondo').value = previo ? String(previo.contado).replace('.',',') : '';
  const fondo = $('#cFondo').value.trim() ? parseMonto($('#cFondo').value) : 0;
  const c = calcularCaja(movsDelDia(dia).filter(m => !m.anulado));
  const esperado = efectivoEsperado(c, isFinite(fondo) ? fondo : 0);
  $('#cajaRes').innerHTML = filasCaja(c, isFinite(fondo) ? fondo : 0, esperado);
  actualizarDif(esperado);
  renderDistrib();
  const D = S.D.last, pend = D ? D.pend.length : 0, cc = cierreCompleto(dia), bloq = !!cc && !S.D.rect;
  const ult = cierresDia(dia)[0];
  $('#cEstadoCierre').textContent = bloq ? 'Cierre confirmado el ' + fmtFechaHora(cc.creado) + '. Para volver a cerrar, rectificá la distribución.' :
    pend ? 'Hay ' + pl(pend,'movimiento','movimientos') + ' sin asignar: el cierre definitivo se habilita cuando estén todos asignados. Mientras tanto podés guardar un cierre incompleto.' : 'Todo asignado: podés cerrar la caja.';
  if (ult && !bloq && Math.abs(ult.esperado - esperado) > 0.009) $('#cEstadoCierre').textContent += ' Hubo cambios después del último cierre (esperado entonces ' + money(ult.esperado) + ').';
  $('#btnCerrar').disabled = bloq || pend > 0; $('#btnIncompleto').disabled = bloq;
  const lista = S.cierres.slice().sort((a,b) => b.dia.localeCompare(a.dia) || b.creado - a.creado);
  $('#cierresLista').innerHTML = lista.length ? lista.map(x => {
    const abierto = S.C.abierto === x.id, dif = x.diferencia;
    const estado = x.estado === 'completo' ? '<span class="pill pill-venta">Completo</span>' : x.estado === 'incompleto' ? '<span class="pill pill-egreso">Incompleto · ' + x.pendientes + ' sin asignar</span>' : '';
    const dist = x.distribucion && x.distribucion.resp ? '<h3 style="margin:8px 0 4px">Distribución</h3><div class="kv">' + Object.keys(x.distribucion.resp).map(k => { const r = x.distribucion.resp[k];
      return '<div><span>' + esc(r.nombre || respNombre(k)) + ' <span class="muted small">(' + pl(r.n,'mov.','movs.') + ')</span></span><span class="num">neto ' + money(r.neto) + '</span></div>'; }).join('') + '</div>' : '';
    return '<details class="card" data-cid="' + esc(x.id) + '"' + (abierto ? ' open' : '') + '><summary>' + esc(etiquetaDia(keyToMs(x.dia))) + ' · ' + esc(fmtHora(x.creado)) + ' ' + estado +
      ' <span class="num ' + (dif < 0 ? 'debe' : dif > 0 ? 'favor' : '') + '">dif. ' + money(dif) + '</span></summary>' +
      (x.rectifica ? '<p class="small muted">Rectifica un cierre anterior. Motivo: ' + esc(x.motivo) + '</p>' : '') +
      filasCaja(x.calc, x.fondoInicial, x.esperado) +
      '<div class="kv" style="margin-top:6px"><div><span>Efectivo contado</span><span class="num">' + money(x.contado) + '</span></div><div class="tot"><span>Diferencia</span><span class="num ' + (dif < 0 ? 'debe' : dif > 0 ? 'favor' : '') + '">' + money(dif) + '</span></div></div>' + dist +
      '<p class="small muted" style="margin-top:6px">Cerró ' + esc(x.por || '') + ' el ' + esc(fmtFechaHora(x.creado)) + (x.nota ? '. Nota: ' + esc(x.nota) : '') + '</p></details>';
  }).join('') : vacio('Todavía no hay cierres', 'Al final del día asigná los movimientos, contá el efectivo, escribilo arriba y tocá «Cerrar caja».');
}
function actualizarDif(esperado){
  const ct = $('#cContado').value.trim(), el = $('#cajaDif');
  if (!ct){ el.innerHTML = '<small>Diferencia</small><b class="muted">Escribí el efectivo contado</b>'; return; }
  const v = parseMonto(ct);
  if (!isFinite(v)){ el.innerHTML = '<small>Diferencia</small><b class="debe">Importe no válido</b>'; return; }
  const dif = round2(v - esperado);
  el.innerHTML = '<small>Diferencia entre contado y esperado</small><b class="' + (dif < 0 ? 'debe' : dif > 0 ? 'favor' : '') + '">' + (dif > 0 ? '+' : '') + money(dif) + '</b>' +
    '<small>' + (dif === 0 ? 'La caja cierra justa.' : dif < 0 ? 'Falta plata en la caja.' : 'Sobra plata en la caja.') + '</small>';
}
function cerrarCaja(definitivo){
  if (!S.db || !S.canWrite) return;
  const err = $('#cError'), dia = S.C.dia;
  const falla = t => { err.className = 'aviso err'; err.textContent = t; err.hidden = false; };
  const ct = parseMonto($('#cContado').value), fo = $('#cFondo').value.trim() ? parseMonto($('#cFondo').value) : 0;
  if (!$('#cContado').value.trim() || !isFinite(ct) || ct < 0){ falla('Escribí el efectivo contado.'); return; }
  if (!isFinite(fo) || fo < 0){ falla('El fondo inicial no es válido.'); return; }
  const cc = cierreCompleto(dia);
  if (cc && !S.D.rect){ falla('Este día ya tiene un cierre confirmado. Para cerrar de nuevo hay que rectificar la distribución.'); return; }
  const todos = movsDelDia(dia), movs = todos.filter(m => !m.anulado), calc = calcularCaja(movs), D = distribuir(todos, S.asigAll, resIds());
  if (definitivo && D.pend.length){ falla('Faltan ' + pl(D.pend.length,'movimiento','movimientos') + ' por asignar. Asignalos o usá «Guardar cierre incompleto».'); return; }
  err.hidden = true;
  const esperado = efectivoEsperado(calc, fo), id = S.db.nuevoId('cierres');
  const asignados = todos.filter(m => esDistribuible(m) && !D.pend.includes(m)).map(m => ({ movId:m.id, desc:m.desc, tipo:m.tipo, total:m.total, partes:S.asigAll.get(m.id).partes }));
  const resp = {}; Object.keys(D.col).forEach(k => { const c = D.col[k]; resp[k] = { nombre:respNombre(k), ing:c.ing, egr:c.egr, neto:c.neto, n:c.n }; });
  const doc = { dia, creado:Date.now(), por:S.nombre || null, porUid:S.uid || null, fondoInicial:round2(fo), contado:round2(ct), esperado, diferencia:round2(ct - esperado),
    nota:$('#cNota').value.trim(), nMovs:movs.length, calc, estado:definitivo ? 'completo' : 'incompleto', pendientes:D.pend.length,
    distribucion:{ resp, pend:{ n:D.pend.length, ing:round2(D.pend.filter(m => m.tipo !== 'egreso').reduce((s, m) => s + m.total, 0)), egr:round2(D.pend.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.total, 0)) } },
    asignaciones:asignados };
  if (S.D.rect && cc){ doc.rectifica = cc.id; doc.motivo = S.D.motivo; }
  const b = S.db.batch(); b.set('cierres', id, doc); b.commit();
  if (definitivo) for (let i = 0; i < asignados.length; i += 400){
    const b2 = S.db.batch(); asignados.slice(i, i + 400).forEach(a => b2.merge('asignaciones', a.movId, { cierreId:id })); b2.commit();
  }
  S.C.abierto = id; S.D.rect = false; S.D.motivoTxt = ''; $('#cContado').value = ''; $('#cNota').value = '';
  toast(definitivo ? 'Caja cerrada. Diferencia: ' + money(round2(ct - esperado)) : 'Cierre incompleto guardado.');
  programar();
}
// ---------- preferencias, repetir y artículos ----------
const prefMedio = () => (S.prefs.recordar !== false && S.prefs.medio && S.prefs.medio !== 'fiado' && MEDIO_KEYS.includes(S.prefs.medio)) ? (['debito','credito'].includes(S.prefs.medio) ? 'transferencia' : S.prefs.medio) : 'efectivo';
function guardarPrefs(medio, cat){
  if (S.prefs.recordar === false) return;
  const p = Object.assign({}, S.prefs); let cambio = false;
  if (medio && medio !== 'fiado' && p.medio !== medio){ p.medio = medio; cambio = true; }
  if (cat !== null && cat !== undefined && p.cat !== cat){ p.cat = cat; cambio = true; }
  if (!cambio) return;
  S.prefs = p; LS.set('almacen.prefs', JSON.stringify(p));
  if (S.db && S.uid){ const b = S.db.batch(); b.merge('perfiles', S.uid, { prefs:p }); b.commit(); }
}
function aplicarPrefs(){
  S.F.medio = prefMedio();
  const c = S.prefs.recordar !== false ? S.prefs.cat : '';
  if (c && [...$('#oCat').options].some(o => o.value === c)) $('#oCat').value = c;
  aplicarForm();
}
function repetirUltima(){
  const mias = S.lista.filter(m => !m.anulado && (m.tipo === 'venta' || m.tipo === 'fiado' || m.tipo === 'egreso') && ((S.uid && m.porUid === S.uid) || (!m.porUid && m.por === S.nombre))).sort((a, b) => b.creado - a.creado);
  const m = mias[0];
  if (!m){ toast('Todavía no hay una operación tuya para repetir.', true); return; }
  S.F.tipo = m.tipo === 'egreso' ? 'egreso' : 'venta';
  S.F.medio = m.tipo === 'fiado' ? 'fiado' : (['debito','credito'].includes(m.medio) ? 'transferencia' : m.medio);
  if (m.tipo === 'egreso') $('#oSub').value = m.sub || 'gasto';
  $('#oArt').value = m.desc;
  ['#oImp','#oDet','#oTitular','#oRec','#oCliente'].forEach(s => { $(s).value = ''; });
  $('#oCat').value = [...$('#oCat').options].some(o => o.value === m.cat) ? m.cat : '';
  S.F.sinMotivo = false; mostrarError(''); aplicarForm(); $('#oImp').focus();
  toast('Repetida. Escribí el importe.');
}
function actualizarArticulos(){
  const v = new Map();
  for (const m of S.lista){ if (v.size >= 300) break; if (!m.desc || m.tipo === 'pago') continue; const k = norm(m.desc); if (!v.has(k)) v.set(k, { d:m.desc, cat:m.cat }); }
  try { JSON.parse(LS.get('almacen.arts') || '[]').forEach(a => { const k = norm(a[0]); if (a[0] && !v.has(k) && v.size < 300) v.set(k, { d:a[0], cat:a[1] || '' }); }); } catch (_) {}
  S.arts = v;
  const html = [...v.values()].map(a => '<option value="' + esc(a.d) + '"></option>').join('');
  if (html !== S.artHtml){ S.artHtml = html; $('#dlArt').innerHTML = html; LS.set('almacen.arts', JSON.stringify([...v.values()].map(a => [a.d, a.cat || '']))); }
}

// ---------- pantalla: Historial ----------
const H = () => ({
  desde:$('#hDesde').value, hasta:$('#hHasta').value, tipo:$('#hTipo').value, medio:$('#hMedio').value,
  resp:$('#hResp').value, cat:$('#hCat').value, q:norm($('#qHist').value)
});
function pasaFiltro(m, f){
  if (f.tipo === 'anulado'){ if (!m.anulado) return false; } else if (m.anulado) return false;
  if (f.tipo === 'venta' && !(m.tipo === 'venta' || m.tipo === 'fiado')) return false;
  if (f.tipo === 'ingreso' && !(m.tipo === 'venta' || m.tipo === 'pago')) return false;
  if (f.tipo === 'egreso' && m.tipo !== 'egreso') return false;
  if (f.tipo === 'retiro' && !(m.tipo === 'egreso' && m.sub === 'retiro')) return false;
  if (f.tipo === 'cc' && !(m.tipo === 'fiado' || m.tipo === 'pago')) return false;
  if (f.tipo === 'fiado' && m.tipo !== 'fiado') return false;
  if (f.tipo === 'pago' && m.tipo !== 'pago') return false;
  if (f.medio === 'transferencia'){ if (!['transferencia','debito','credito'].includes(m.medio)) return false; } else if (f.medio && m.medio !== f.medio) return false;
  if (f.resp && !partesDe(m).some(p => p.resp === f.resp)) return false;
  if (f.cat && !partesDe(m).some(p => p.cat === f.cat)) return false;
  if (f.q){
    const cli = m.clienteId && S.clientes.get(m.clienteId) ? S.clientes.get(m.clienteId).nombre : m.clienteNombre;
    if (!norm([m.desc, m.detalles, cli, m.titular, m.alias, m.autorChat, m.por].join(' ')).includes(f.q)) return false;
  }
  return true;
}
async function cargarRango(desde, hasta){
  if (!S.db || desde >= S.ventana) return;
  const key = desde + '-' + hasta;
  if (S.H.cargados.has(key)) return;
  S.H.cargados.add(key); S.H.cargando = true; programar();
  try {
    const snap = await S.db.get('movimientos', [['fecha','>=',desde],['fecha','<=',Math.min(hasta, S.ventana)]]);
    snap.docs.forEach(d => { const m = leerMov(d); S.extra.set(m.id, m); });
    derivar();
  } catch (_) { S.H.cargados.delete(key); toast('No se pudo cargar ese período.', true); }
  S.H.cargando = false; programar();
}
function renderHistorial(){
  const f = H();
  if (f.desde && keyToMs(f.desde) < S.ventana) cargarRango(keyToMs(f.desde), f.hasta ? keyToMs(f.hasta) + DIA_MS - 1 : S.ventana);
  const a = f.desde ? keyToMs(f.desde) : 0, b = f.hasta ? keyToMs(f.hasta) + DIA_MS : Infinity;
  const lista = S.lista.filter(m => m.fecha >= a && m.fecha < b && pasaFiltro(m, f));
  const activos = [f.desde, f.hasta, f.medio, f.resp, f.cat, f.q].filter(Boolean).length + (f.tipo !== 'todo' ? 1 : 0);
  const ing = lista.filter(m => m.importe > 0 && m.tipo !== 'fiado').reduce((s,m) => s + m.total, 0), egr = lista.filter(m => m.tipo === 'egreso').reduce((s,m) => s + m.total, 0);
  $('#hInfo').textContent = (S.H.cargando ? 'Cargando período… ' : '') + pl(lista.length,'operación','operaciones') + (activos ? ' con filtros' : '') +
    (lista.length ? ' · cobrado ' + money(ing) + ' · egresos ' + money(-egr) : '') + (f.desde ? '' : ' · se muestran los últimos 90 días; elegí una fecha “Desde” para ver más atrás.');
  if (!lista.length){
    $('#histItems').innerHTML = S.lista.length ? vacio('Sin resultados', 'Probá con otra palabra o cambiá los filtros.') : vacio('El historial está vacío', 'Cada venta, fiado, cobro y egreso que guardes aparece acá, ordenado por día y con buscador.');
    return;
  }
  const mostrar = lista.slice(0, S.H.limit), dias = []; let ult = null;
  for (const m of mostrar){
    const k = dayKey(m.fecha);
    if (!ult || ult.k !== k){ ult = { k, ms:m.fecha, items:[] }; dias.push(ult); }
    ult.items.push(m);
  }
  let h = '';
  for (const d of dias){
    const vend = d.items.filter(m => !m.anulado && (m.tipo === 'venta' || m.tipo === 'fiado')).reduce((s,m) => s + m.total, 0);
    h += '<div><div class="dia-h"><b>' + esc(etiquetaDia(d.ms)) + '</b><span>vendido <span class="num">' + money(vend) + '</span></span></div><ul class="lista">' + d.items.map(m => filaMov(m)).join('') + '</ul></div>';
  }
  if (lista.length > mostrar.length) h += '<button class="btn btn-ghost" type="button" data-act="mas">Mostrar más (' + (lista.length - mostrar.length) + ' restantes)</button>';
  $('#histItems').innerHTML = h;
}

// ---------- pantalla: Resumen ----------
function renderResumen(){
  $$('[data-act="periodo"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.R.periodo)));
  const ahora = new Date(), hoy0 = startOfDay(ahora.getTime());
  let desde = hoy0;
  if (S.R.periodo === '7') desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - 6).getTime();
  else if (S.R.periodo === 'mes') desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
  if (desde < S.ventana) cargarRango(desde, S.ventana);
  const en = S.lista.filter(m => m.fecha >= desde && !m.anulado);
  const r = resumir(en), c = r.caja;
  const cobrado = round2(c.porMedio.efectivo + c.porMedio.transferencia + c.porMedio.debito + c.porMedio.credito);
  const resultado = round2(c.ventas - c.egrOperativos);
  let h = '<div class="grid2">' +
    '<div class="kpi kpi-main"><small>Ventas del período</small><b>' + money(c.ventas) + '</b><small>cobrado ' + money(cobrado) + ' · fiado ' + money(c.fiadas) + ' · ' + pl(c.nVentas,'venta','ventas') + '</small></div>' +
    '<div class="kpi"><small>Cobros de deudas</small><b>' + money(c.cobros) + '</b></div>' +
    '<div class="kpi"><small>Te deben en total</small><b class="' + (S.deuda > 0 ? 'debe' : '') + '">' + money(S.deuda) + '</b></div>' +
    '<div class="kpi"><small>Gastos del negocio</small><b class="egr">' + money(-c.egrOperativos) + '</b></div>' +
    '<div class="kpi"><small>Retiros personales</small><b class="egr">' + money(-c.egr.retiro) + '</b></div>' +
    '<div class="kpi kpi-main"><small>Ventas menos gastos del negocio (sin retiros personales)</small><b class="' + (resultado < 0 ? 'debe' : 'favor') + '">' + money(resultado) + '</b></div></div>';
  const elecR = o => round2(o.transferencia + o.debito + o.credito);
  h += '<div class="card"><h3 style="margin-bottom:6px">Entradas por medio de pago</h3><div class="kv"><div><span>Efectivo</span><span class="num">' + money(round2(c.porMedio.efectivo + c.cobrosMedio.efectivo)) +
    '</span></div><div><span>Transferencia / electrónico</span><span class="num">' + money(round2(elecR(c.porMedio) + elecR(c.cobrosMedio))) + '</span></div></div></div>';
  const filasR = (obj, nombre) => Object.keys(obj).sort((a,b) => obj[b].ventas - obj[a].ventas).map(k =>
    '<tr><td>' + esc(k === '-' ? 'Sin asignar' : nombre(k)) + '</td><td>' + money(obj[k].ventas) + '</td><td>' + money(obj[k].fiado) + '</td><td>' + money(obj[k].cobros) + '</td><td>' + money(-obj[k].egr) + '</td></tr>').join('');
  const cab = '<thead><tr><th></th><th>Ventas</th><th>Fiado</th><th>Cobros</th><th>Egresos</th></tr></thead>';
  const Dr = distribuir(en, S.asigAll, resIds());
  const pI = round2(Dr.pend.filter(m => m.tipo !== 'egreso').reduce((s, m) => s + m.total, 0)), pE = round2(Dr.pend.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.total, 0));
  h += '<div class="card"><h3 style="margin-bottom:6px">Resultado por responsable</h3><div class="scroll-x"><table class="tabla"><thead><tr><th></th><th>Ingresos</th><th>Egresos</th><th>Neto asignado</th><th>Mov.</th></tr></thead><tbody>' +
    resIds().map(id => '<tr><td>' + esc(respNombre(id)) + '</td><td>' + money(Dr.col[id].ing) + '</td><td>' + money(-Dr.col[id].egr) + '</td><td><b>' + money(Dr.col[id].neto) + '</b></td><td>' + Dr.col[id].n + '</td></tr>').join('') +
    '<tr><td>Sin asignar</td><td>' + money(pI) + '</td><td>' + money(-pE) + '</td><td>' + money(round2(pI - pE)) + '</td><td>' + Dr.pend.length + '</td></tr></tbody></table></div>' +
    '<p class="small muted" style="margin-top:6px">Neto asignado = ingresos atribuidos − egresos atribuidos (los retiros personales cuentan como egresos). No es la ganancia comercial real: todavía no se registran los costos de la mercadería. Se completa al distribuir cada día en Caja.</p></div>';
  h += '<div class="card"><h3 style="margin-bottom:6px">Por categoría</h3><div class="scroll-x"><table class="tabla">' + cab + '<tbody>' + (filasR(r.cat, catNombre) || '<tr><td colspan="5" class="muted">Sin movimientos.</td></tr>') + '</tbody></table></div></div>';
  const dias = [];
  for (let i = 6; i >= 0; i--){
    const d0 = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - i), a = d0.getTime(), b = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1).getTime();
    const dd = S.lista.filter(m => !m.anulado && m.fecha >= a && m.fecha < b);
    dias.push({ d0, v:dd.filter(m => m.tipo === 'venta').reduce((x,m) => x + m.total, 0), f:dd.filter(m => m.tipo === 'fiado').reduce((x,m) => x + m.total, 0) });
  }
  const max = Math.max(1, ...dias.map(x => x.v + x.f));
  h += '<div class="card stack"><h3>Vendido por día</h3><div class="bars">' + dias.map(x => {
    const t = x.v + x.f;
    return '<div class="dia"><span class="val">' + (t ? compacto(t) : '') + '</span><div class="barra" role="img" aria-label="' + esc(fmtCorta(x.d0.getTime()) + ': ' + money(t)) + '"><i class="b-f" style="height:' + (x.f / max * 100) + '%"></i><i class="b-v" style="height:' + (x.v / max * 100) + '%"></i></div><span class="l">' + esc(x.d0.toLocaleDateString('es-AR',{weekday:'short'})) + '<br>' + x.d0.getDate() + '</span></div>';
  }).join('') + '</div><div class="leyenda"><span><i class="b-v"></i>Ventas</span><span><i class="b-f"></i>Fiado</span></div></div>';
  const deben = [...S.clientes.values()].filter(x => !x.fusionadoEn && x.saldo > 0).sort((a,b) => b.saldo - a.saldo).slice(0,5);
  h += '<div class="card"><h3 style="margin-bottom:6px">Quién debe</h3>' + (deben.length ? '<ul class="top-lista">' + deben.map(x => '<li><button class="link" type="button" data-act="cliente" data-id="' + esc(x.id) + '">' + esc(x.nombre) + '</button><span class="num debe"><b>' + money(x.saldo) + '</b></span></li>').join('') + '</ul>' : '<p class="muted small">Nadie debe nada.</p>') + '</div>';
  const prod = new Map();
  for (const m of en){ if (m.tipo !== 'venta' && m.tipo !== 'fiado') continue; const k = norm(m.desc); if (!k) continue; const p = prod.get(k) || { n:m.desc, veces:0, total:0 }; p.veces++; p.total += m.total; prod.set(k, p); }
  const top = [...prod.values()].sort((a,b) => b.veces - a.veces || b.total - a.total).slice(0,8);
  h += '<div class="card"><h3 style="margin-bottom:6px">Lo que más sale</h3>' + (top.length ? '<ul class="top-lista">' + top.map(p => '<li><span>' + esc(p.n) + ' <span class="muted small">× ' + p.veces + '</span></span><span class="num">' + money(p.total) + '</span></li>').join('') + '</ul>' : '<p class="muted small">Todavía no hay ventas en este período.</p>') + '</div>';
  $('#resItems').innerHTML = h;
}

// ---------- editar / rectificar ----------
function abrirEditar(id){
  const m = S.mapa.get(id) || S.cliMovs.find(x => x.id === id); if (!m) return;
  S.edit = { id, modificado:m.modificado, m };
  const eg = m.tipo === 'egreso';
  $('#eInfo').textContent = tipoPill(m)[1] + ' del ' + fmtFechaHora(m.fecha) + ' · registrado por ' + (m.autorChat || m.por || 'desconocido') + '.';
  $('#eDesc').value = m.desc; $('#eImp').value = String(m.total).replace('.',',');
  $('#ePref').textContent = eg ? '− $' : '$'; $('#ePref').className = eg ? 'neg' : '';
  $('#eMedio').innerHTML = m.tipo === 'fiado' ? '<option value="fiado">Fiado</option>' : opts(['debito','credito'].includes(m.medio) ? [...MEDIOS_COBRO, [m.medio, MEDIO_TXT[m.medio] + ' (histórico)']] : MEDIOS_COBRO, m.medio);
  $('#eMedio').disabled = m.tipo === 'fiado';
  $('#eDet').value = m.detalles;
  $('#eBloqueEgreso').hidden = !eg;
  $('#eSub').innerHTML = opts(EGRESOS, m.sub || 'otro');
  $('#eRetiro').innerHTML = opts(S.cfg.responsables.map(r => [r.id, r.nombre]), m.retiroPor, 'Sin especificar');
  $('#eTitular').value = m.titular;
  $('#eCuenta').innerHTML = opts(S.cfg.cuentas.map(c => [c.id, c.nombre]), m.cuentaId, 'Sin especificar');
  $('#eResp').innerHTML = opts(S.cfg.responsables.map(r => [r.id, r.nombre]), m.resp, 'Sin asignar');
  const lista = catsDe(m.resp);
  $('#eCat').innerHTML = opts(lista.some(c => c[0] === m.cat) || !m.cat ? lista : [...lista, [m.cat, catNombre(m.cat)]], m.cat, 'Sin categoría');
  editTransf(); $('#eError').hidden = true;
  const hs = m.historial.slice().reverse();
  const campos = { desc:'Artículo', importe:'Importe', medio:'Medio', detalles:'Detalles', resp:'Responsable', cat:'Categoría', titular:'Titular', alias:'Alias', cuentaId:'Cuenta', sub:'Tipo de egreso', retiroPor:'Retiró', cliente:'Cliente' };
  $('#eHist').innerHTML = hs.length ? hs.map(x => {
    const cambios = x.antes ? Object.keys(x.antes).map(k => esc(campos[k] || k) + ': ' + esc(String(x.antes[k] === '' ? '(vacío)' : x.antes[k])) + ' → ' + esc(String(x.despues && x.despues[k] !== undefined && x.despues[k] !== '' ? x.despues[k] : '(vacío)'))).join('<br>') : esc(x.nota || '');
    return '<div class="hist-cambio"><b>' + esc(fmtFechaHora(x.fecha)) + '</b> · ' + esc(x.por || '') + '<br>' + cambios + '</div>';
  }).join('') : '<p class="small muted">Este movimiento no fue modificado.</p>';
  $('#modalEdit').hidden = false;
}
function editTransf(){ $('#eBloqueTransf').hidden = $('#eMedio').value !== 'transferencia'; }
function guardarEdicion(ev){
  ev.preventDefault();
  const E = S.edit; if (!E) return;
  const m = S.mapa.get(E.id) || S.cliMovs.find(x => x.id === E.id) || E.m;
  const err = $('#eError');
  if (m.modificado !== E.modificado){ err.textContent = 'Otra persona modificó este movimiento mientras lo editabas. Cerrá y volvé a abrirlo.'; err.hidden = false; return; }
  const imp = leerImporte($('#eImp').value);
  if (!imp){ err.textContent = 'Escribí un importe mayor a cero.'; err.hidden = false; return; }
  if (imp.neg){ err.textContent = 'Escribí el importe sin signo.'; err.hidden = false; return; }
  const desc = $('#eDesc').value.trim();
  if (m.tipo !== 'pago' && !desc){ err.textContent = 'La descripción no puede quedar vacía.'; err.hidden = false; return; }
  const c = { desc:desc || m.desc, importe:m.tipo === 'egreso' ? -imp.v : imp.v, medio:m.tipo === 'fiado' ? 'fiado' : $('#eMedio').value, detalles:$('#eDet').value.trim(),
    resp:$('#eResp').value, cat:$('#eCat').value };
  if (c.medio === 'transferencia') Object.assign(c, { titular:$('#eTitular').value.trim(), cuentaId:$('#eCuenta').value });
  if (m.tipo === 'egreso'){ c.sub = $('#eSub').value; c.retiroPor = $('#eRetiro').value; }
  err.hidden = true;
  if (rectificar(m, c)) toast('Cambios guardados.'); else toast('No hubo cambios.');
  S.edit = null; $('#modalEdit').hidden = true; programar();
}

// ---------- ajustes: responsables y cuentas ----------
function renderCfg(){
  $('#cfgResp').innerHTML = S.cfg.responsables.map(r => '<div><label class="lbl" for="cr-' + r.id + '">' + esc(r.cats.map(catNombre).join(' y ')) + '</label><input id="cr-' + r.id + '" data-cfg-resp="' + r.id + '" type="text" maxlength="30" value="' + esc(r.nombre) + '"></div>').join('');
  $('#cfgCuentas').innerHTML = S.cfg.cuentas.map(c => '<input data-cfg-cuenta="' + esc(c.id) + '" type="text" maxlength="40" value="' + esc(c.nombre) + '" aria-label="Nombre de la cuenta">').join('');
}
function guardarCfg(ev){
  if (ev) ev.preventDefault();
  if (!S.db) return;
  const responsables = S.cfg.responsables.map(r => { const i = document.querySelector('[data-cfg-resp="' + r.id + '"]'); return { id:r.id, nombre:(i && i.value.trim()) || r.nombre, cats:r.cats }; });
  const cuentas = $$('[data-cfg-cuenta]').map(i => ({ id:i.dataset.cfgCuenta, nombre:i.value.trim() })).filter(c => c.nombre);
  const nueva = $('#cfgNueva').value.trim();
  if (nueva){ cuentas.push({ id:'c' + Date.now().toString(36), nombre:nueva }); $('#cfgNueva').value = ''; }
  const b = S.db.batch(); b.merge('config', 'general', { responsables, cuentas, actualizado:Date.now(), por:S.nombre || null }); b.commit();
  toast('Guardado.');
}

// ---------- respaldo y restauración ----------
const csvCelda = v => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
const csvNum = n => String(round2(n)).replace('.',',');
const toCsv = filas => '﻿' + filas.map(f => f.map(csvCelda).join(';')).join('\r\n');
function descargar(nombre, texto, mime){
  const url = URL.createObjectURL(new Blob([texto], { type:mime }));
  const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function exportar(formato){
  if (!S.db) { toast('Todavía no hay conexión con la base.', true); return; }
  const est = $('#bkEstado'); est.hidden = false; est.textContent = 'Preparando la copia…';
  try {
    const [mv, cl, ci, cf, asg, pf] = await Promise.all(['movimientos','clientes','cierres','config','asignaciones','perfiles'].map(c => S.db.get(c, [])));
    const sello = dayKey(Date.now()) + '-' + fmtHora(Date.now()).replace(':','');
    if (formato === 'json'){
      const raw = snap => Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
      const obj = { formato:'libreta-almacen', version:2, exportado:Date.now(), por:S.nombre || null,
        cantidades:{ movimientos:mv.docs.length, clientes:cl.docs.length, cierres:ci.docs.length, asignaciones:asg.docs.length },
        colecciones:{ movimientos:raw(mv), clientes:raw(cl), cierres:raw(ci), config:raw(cf), asignaciones:raw(asg), perfiles:raw(pf) } };
      descargar('cresta-dorada-copia-' + sello + '.json', JSON.stringify(obj), 'application/json');
    } else if (formato === 'csv-mov'){
      const filas = [['id','fecha','hora','tipo','subtipo','articulo','importe','medio','detalles','cliente','responsable','categoria','registro','registro_uid','titular','cuenta','retiro_por','anulado','creado','modificado']];
      mv.docs.map(leerMov).sort((a,b) => a.fecha - b.fecha).forEach(m => filas.push([m.id, dayKey(m.fecha), fmtHora(m.fecha), m.tipo, m.sub ? EGR_TXT[m.sub] : '', m.desc, csvNum(m.importe), MEDIO_TXT[m.medio] || m.medio, m.detalles,
        m.clienteNombre, respNombre(m.resp), catNombre(m.cat), m.autorChat || m.por, m.porUid, m.titular, cuentaNombre(m.cuentaId), respNombre(m.retiroPor), m.anulado ? 'si' : '', new Date(m.creado).toISOString(), new Date(m.modificado).toISOString()]));
      descargar('cresta-dorada-movimientos-' + sello + '.csv', toCsv(filas), 'text/csv');
    } else if (formato === 'csv-cli'){
      const filas = [['id','nombre','saldo','ultimo_movimiento','observaciones','provisoria','unificada_en']];
      cl.docs.map(leerCliente).forEach(c => filas.push([c.id, c.nombre, csvNum(c.saldo), c.ultimo ? dayKey(c.ultimo) : '', c.obs, c.provisorio ? 'si' : '', c.fusionadoEn || '']));
      descargar('cresta-dorada-clientes-' + sello + '.csv', toCsv(filas), 'text/csv');
    } else {
      const filas = [['id','dia','cerrado','por','fondo_inicial','efectivo_esperado','efectivo_contado','diferencia','ventas','cobros_deudas','egresos','nota']];
      ci.docs.map(d => Object.assign({ id:d.id }, d.data())).sort((a,b) => String(a.dia).localeCompare(String(b.dia))).forEach(x => filas.push([x.id, x.dia, new Date(x.creado).toISOString(), x.por, csvNum(x.fondoInicial), csvNum(x.esperado), csvNum(x.contado), csvNum(x.diferencia), csvNum((x.calc || {}).ventas || 0), csvNum((x.calc || {}).cobros || 0), csvNum((x.calc || {}).egrTotal || 0), x.nota]));
      descargar('cresta-dorada-cierres-' + sello + '.csv', toCsv(filas), 'text/csv');
    }
    est.textContent = 'Copia lista: revisá la carpeta Descargas del teléfono.';
  } catch (_) { est.textContent = 'No se pudo preparar la copia. Verificá la conexión e intentá de nuevo.'; }
}
function leerArchivoRespaldo(file){
  const r = new FileReader();
  r.onload = () => {
    try {
      const o = JSON.parse(String(r.result));
      if (!o || o.formato !== 'libreta-almacen' || !o.colecciones) throw new Error('formato');
      S.restaurar = o;
      const n = k => Object.keys(o.colecciones[k] || {}).length;
      $('#bkTxt').textContent = 'Copia del ' + new Date(o.exportado).toLocaleString('es-AR') + ': ' + pl(n('movimientos'),'movimiento','movimientos') + ', ' + pl(n('clientes'),'cliente','clientes') + ', ' + pl(n('cierres'),'cierre','cierres') + '.';
      $('#bkResumen').hidden = false;
    } catch (_) { S.restaurar = null; $('#bkResumen').hidden = true; toast('Ese archivo no es una copia de seguridad válida.', true); }
  };
  r.readAsText(file);
}
function restaurar(){
  const o = S.restaurar; if (!o || !S.db) return;
  let total = 0;
  for (const col of ['movimientos','clientes','cierres','config','asignaciones']){
    const ids = Object.keys(o.colecciones[col] || {});
    for (let i = 0; i < ids.length; i += 300){
      const b = S.db.batch();
      ids.slice(i, i + 300).forEach(id => { b.set(col, id, o.colecciones[col][id]); total++; });
      b.commit();
    }
  }
  S.restaurar = null; $('#bkResumen').hidden = true; $('#bkArchivo').value = '';
  toast('Restauración enviada: ' + pl(total,'documento','documentos') + '.');
}

// ---------- navegación y eventos ----------
let rafId = 0;
function programar(){ if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; render(); }); }
function render(){
  renderChip();
  if (S.view === 'anotar') renderAnotar();
  else if (S.view === 'cuentas') renderCuentas();
  else if (S.view === 'caja') renderCaja();
  else if (S.view === 'historial') renderHistorial();
  else if (S.view === 'ajustes') renderAjustes();
  else renderResumen();
}
function renderChip(){ $('#chipDeuda').hidden = !(S.deuda > 0); $('#chipMonto').textContent = money(S.deuda); }
function setView(v, desdeTab){
  if (!['anotar','cuentas','caja','historial','resumen','ajustes'].includes(v)) v = 'anotar';
  if (desdeTab && v === 'cuentas'){ S.cliSel = null; cerrarClienteSub(); }
  S.view = v;
  $$('[data-view]').forEach(s => { s.hidden = s.dataset.view !== v; });
  $$('.tab').forEach(b => { if (b.dataset.v === v) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  if (location.hash.slice(1) !== v){ try { location.hash = v; } catch (_) {} }
  if (v === 'ajustes') renderCfg();
  render();
}
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act, v = t.dataset.v, id = t.dataset.id;
  const mov = () => S.mapa.get(id) || S.cliMovs.find(x => x.id === id);
  switch (a){
    case 'tab': setView(v, true); break;
    case 'cliente': abrirCliente(id); break;
    case 'volver': S.cliSel = null; cerrarClienteSub(); render(); break;
    case 'optipo': S.F.tipo = v; S.F.sinMotivo = false; mostrarError(''); aplicarForm(); break;
    case 'medio': S.F.medio = v; aplicarForm(); break;
    case 'sinNombre': { const n = new Date(); $('#oCliente').value = 'Sin identificar ' + fmtCorta(n.getTime()) + ' ' + fmtHora(n.getTime()); actualizarSaldoHint(); break; }
    case 'ejemplo': $('#entrada').value = EJEMPLO; reparse(); $('#preview').scrollIntoView({ block:'nearest' }); break;
    case 'guardar': guardarTexto(); break;
    case 'anular': S.anulando = id; render(); break;
    case 'anular-no': S.anulando = null; render(); break;
    case 'anular-si': { S.anulando = null; const m = mov(); if (m) cambiarAnulacion(m, true); programar(); break; }
    case 'restaurar-mov': { const m = mov(); if (m) cambiarAnulacion(m, false); programar(); break; }
    case 'editar': abrirEditar(id); break;
    case 'editCerrar': S.edit = null; $('#modalEdit').hidden = true; break;
    case 'limpiarFiltros': ['hDesde','hHasta','hMedio','hResp','hCat','qHist'].forEach(i => { $('#' + i).value = ''; }); $('#hTipo').value = 'todo'; S.H.limit = 100; render(); break;
    case 'periodo': S.R.periodo = v; render(); break;
    case 'modo': S.modo = v; aplicarModo(); break;
    case 'saldar': { const c = S.cliSel && S.clientes.get(S.cliSel); if (c && c.saldo > 0) $('#mMonto').value = String(c.saldo).replace('.',','); break; }
    case 'mas': S.H.limit += 100; render(); break;
    case 'verAlDia': S.verAlDia = true; render(); break;
    case 'renombrar': { const f = $('#formNombre'); f.hidden = !f.hidden; if (!f.hidden){ const c = S.clientes.get(S.cliSel); $('#inNombre').value = c ? c.nombre : ''; $('#inNombre').focus(); } break; }
    case 'unificar': { const b = $('#bloqueUnificar'); b.hidden = !b.hidden; if (!b.hidden) $('#selUnificar').innerHTML = opts([...S.clientes.values()].filter(c => !c.fusionadoEn && c.id !== S.cliSel).map(c => [c.id, c.nombre]), '', 'Elegí la cuenta de destino'); break; }
    case 'unificarOk': unificarCuentas(); break;
    case 'guardarObs': { const c = S.cliSel && S.clientes.get(S.cliSel); if (c && S.db){ const b = S.db.batch(); b.merge('clientes', c.id, { obs:$('#cliObs').value.trim() }); b.commit(); toast('Observaciones guardadas.'); } break; }
    case 'corregirSaldo': { const c = S.cliSel && S.clientes.get(S.cliSel); if (c && S.db && S.cliCargado === c.id){ const s = round2(S.cliMovs.reduce((x,m) => x + efectoSaldo(m), 0)); const b = S.db.batch(); b.merge('clientes', c.id, { saldo:s, saldoOk:true }); b.commit(); toast('Saldo corregido.'); } break; }
    case 'cerrarCaja': cerrarCaja(true); break;
    case 'cerrarIncompleto': cerrarCaja(false); break;
    case 'repetir': repetirUltima(); break;
    case 'suNombre': $('#suNombre').value = v; break;
    case 'dsel': S.D.sel = v; renderDistrib(); break;
    case 'dasig': moverA(id, t.dataset.r, Number(t.dataset.mod) || 0); break;
    case 'ddiv': abrirSplit(id); break;
    case 'dver': abrirEditar(id); break;
    case 'splitCerrar': S.D.split = null; $('#modalSplit').hidden = true; break;
    case 'splitIguales': splitIguales(); break;
    case 'drect': { const mt = (($('#dMotivo') || {}).value || '').trim(); if (mt.length < 3){ toast('Escribí el motivo de la rectificación.', true); break; } S.D.rect = true; S.D.motivo = mt; programar(); break; }
    case 'cfgAgregar': guardarCfg(); break;
    case 'exportar': exportar(v); break;
    case 'restaurar': restaurar(); break;
    case 'ajustes': setView('ajustes'); break;
    case 'cerrarAjustes': setView('anotar'); break;
    case 'generar': $('#suCodigo').value = fmtCodigo(nuevoCodigo()); break;
    case 'copiarLink': {
      const link = linkInvitacion();
      const sel = () => { const i = $('#inLink'); i.focus(); i.select(); toast('Tocá el enlace y copialo.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(() => toast('Enlace copiado.')).catch(sel); else sel();
      break;
    }
    case 'instalar': if (promptInst){ promptInst.prompt(); promptInst.userChoice.then(() => {}, () => {}).then(() => { promptInst = null; $('#cardInstalar').hidden = true; }); } break;
  }
});
$('#formOp').addEventListener('submit', agregarOperacion);
$('#formManual').addEventListener('submit', guardarManual);
$('#formEdit').addEventListener('submit', guardarEdicion);
$('#formSplit').addEventListener('submit', guardarSplit);
$('#sFilas').addEventListener('input', ev => { const a = ev.target.dataset && ev.target.dataset.sa; if (a && ev.target.value.trim()) { const cb = $('#sFilas [data-sc="' + a + '"]'); if (cb) cb.checked = true; } sumaSplit(); });
$('#sFilas').addEventListener('change', sumaSplit);
document.addEventListener('input', ev => { if (ev.target.id === 'dMotivo') S.D.motivoTxt = ev.target.value; });
$('#oArt').addEventListener('change', () => { const a = S.arts.get(norm($('#oArt').value)); if (a && a.cat && S.F.tipo === 'venta' && [...$('#oCat').options].some(o => o.value === a.cat)) $('#oCat').value = a.cat; });
$('#formCfg').addEventListener('submit', guardarCfg);
$('#formNombre').addEventListener('submit', ev => {
  ev.preventDefault();
  const n = limpiarNombre($('#inNombre').value);
  if (!n || !S.db || !S.canWrite || !S.cliSel) return;
  const b = S.db.batch(); b.merge('clientes', S.cliSel, { nombre:n, provisorio:false }); b.commit();
  $('#formNombre').hidden = true; toast('Nombre actualizado.');
});
$('#oResp').addEventListener('change', llenarCat);
$('#oSub').addEventListener('change', aplicarForm);
$('#oCliente').addEventListener('input', actualizarSaldoHint);
$('#oImp').addEventListener('input', () => { actualizarPend(); mostrarError(''); });
$('#oRec').addEventListener('input', actualizarPend);
$('#oArt').addEventListener('keydown', ev => { if (ev.key === 'Enter'){ ev.preventDefault(); $('#oImp').focus(); } });
$('#eMedio').addEventListener('change', editTransf);
$('#eResp').addEventListener('change', () => { const l = catsDe($('#eResp').value); $('#eCat').innerHTML = opts(l, l[0] && $('#eResp').value ? l[0][0] : '', 'Sin categoría'); });
let deb = 0;
$('#entrada').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(reparse, 160); });
$('#fecha').addEventListener('change', reparse);
$('#qCuentas').addEventListener('input', () => { if (S.view === 'cuentas') renderCuentas(); });
['qHist','hDesde','hHasta','hTipo','hMedio','hResp','hCat'].forEach(i => $('#' + i).addEventListener('input', () => { S.H.limit = 100; if (S.view === 'historial') renderHistorial(); }));
$('#cDia').addEventListener('change', () => { S.C.dia = $('#cDia').value || dayKey(Date.now()); S.C.fondoTocado = false; S.D.rect = false; S.D.motivoTxt = ''; $('#cError').hidden = true; renderCaja(); });
$('#cFondo').addEventListener('input', () => { S.C.fondoTocado = true; renderCaja(); });
$('#cContado').addEventListener('input', () => { renderCaja(); });
$('#cierresLista').addEventListener('toggle', ev => { const d = ev.target; if (d && d.dataset && d.dataset.cid){ if (d.open) S.C.abierto = d.dataset.cid; else if (S.C.abierto === d.dataset.cid) S.C.abierto = null; } }, true);
$('#bkArchivo').addEventListener('change', ev => { const f = ev.target.files && ev.target.files[0]; if (f) leerArchivoRespaldo(f); });
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== S.view) setView(v); });

// ---------- identidad ----------
const FB_URL = 'https://www.gstatic.com/firebasejs/10.14.1/';
const LS = {
  get(k){ try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch (_) {} }
};
const normCodigo = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g,'');
const fmtCodigo = c => (c.match(/.{1,4}/g) || []).join('-');
function nuevoCodigo(){
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789', a = new Uint8Array(20); crypto.getRandomValues(a);
  return Array.from(a, b => abc[b % 32]).join('');
}
const linkInvitacion = () => location.origin + location.pathname + '#local=' + S.code;
function aplicarIdentidad(){ $('#yoNombre').textContent = S.nombre || 'Ajustes'; $('#yoReg').textContent = S.nombre || '—'; }
function renderAjustes(){
  if (document.activeElement !== $('#inYo')) $('#inYo').value = S.nombre;
  $('#inRecordar').checked = S.prefs.recordar !== false;
  $('#inLink').value = S.code ? linkInvitacion() : '';
  $('#txtCodigo').textContent = S.code ? fmtCodigo(S.code) : '';
  const ps = [...S.perfiles.values()].filter(p => p.nombre).sort((a, b) => a.creado - b.creado);
  $('#listaPerfiles').innerHTML = ps.length ? ps.map(p => '<div class="row" style="justify-content:space-between"><b>' + esc(p.nombre) + '</b><span class="small muted">' + (p.uid === S.uid ? 'este teléfono · ' : '') + 'desde ' + esc(fmtCorta(p.creado)) + '</span></div>').join('') : '<p class="small muted">Todavía no hay perfiles.</p>';
}
function mostrarSetup(){ $('#suNombre').value = S.nombre || ''; $('#suCodigo').value = S.code ? fmtCodigo(S.code) : ''; $('#setup').hidden = false; }
/* El perfil vive en la base (perfiles/<uid>), asociado a la sesión anónima de Firebase de este teléfono. */
function registrarPerfil(nombre){
  S.nombre = nombre; LS.set('almacen.nombre', nombre); aplicarIdentidad();
  if (!S.db || !S.uid) return;
  const ya = S.perfiles.get(S.uid), p = { nombre, uid:S.uid, actualizado:Date.now() };
  if (!ya || !ya.creado){ p.creado = Date.now(); p.prefs = S.prefs; }
  const b = S.db.batch(); b.merge('perfiles', S.uid, p); b.commit(); S.perfilReg = true;
}
function alCambiarPerfiles(snap){
  S.perfiles = new Map(snap.docs.map(d => { const x = d.data() || {}; return [d.id, { uid:d.id, nombre:String(x.nombre || ''), creado:Number(x.creado) || 0, prefs:x.prefs || {} }]; }));
  const mi = S.perfiles.get(S.uid);
  if (mi && mi.nombre){
    S.nombre = mi.nombre; LS.set('almacen.nombre', mi.nombre);
    S.prefs = Object.assign({ recordar:true }, mi.prefs); LS.set('almacen.prefs', JSON.stringify(S.prefs));
    $('#setup').hidden = true; aplicarIdentidad();
    if (!S.prefsAplicadas){ S.prefsAplicadas = true; if (!$('#oArt').value && !$('#oImp').value) aplicarPrefs(); }
  } else if (!snap.metadata.fromCache && !S.perfilReg){
    const cand = S.pendPerfil || LS.get('almacen.nombre');
    if (cand) registrarPerfil(cand); else mostrarSetup();
  }
  programar();
}
$('#formSetup').addEventListener('submit', ev => {
  ev.preventDefault();
  const nombre = $('#suNombre').value.trim().replace(/\s+/g,' '), codigo = normCodigo($('#suCodigo').value), err = $('#suError');
  if (nombre.length < 2){ err.textContent = 'Escribí tu nombre (al menos 2 letras) o tocá uno de los botones.'; err.hidden = false; return; }
  if (codigo.length < 16){ err.textContent = 'El código es muy corto. Pegá el que recibiste o generá uno nuevo.'; err.hidden = false; return; }
  err.hidden = true;
  S.code = codigo; LS.set('almacen.codigo', codigo); $('#setup').hidden = true;
  if (S.db) registrarPerfil(nombre); else { S.pendPerfil = nombre; S.nombre = nombre; LS.set('almacen.nombre', nombre); aplicarIdentidad(); arrancar(); }
  render();
});
$('#formYo').addEventListener('submit', ev => {
  ev.preventDefault();
  const n = $('#inYo').value.trim().replace(/\s+/g,' ');
  if (n.length < 2){ toast('Escribí un nombre de al menos 2 letras.', true); return; }
  registrarPerfil(n); toast('Nombre guardado.');
});
$('#inRecordar').addEventListener('change', () => {
  S.prefs = Object.assign({}, S.prefs, { recordar:$('#inRecordar').checked }); LS.set('almacen.prefs', JSON.stringify(S.prefs));
  if (S.db && S.uid){ const b = S.db.batch(); b.merge('perfiles', S.uid, { prefs:S.prefs }); b.commit(); }
});
let promptInst = null;
window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); promptInst = ev; $('#cardInstalar').hidden = false; });
window.addEventListener('appinstalled', () => { promptInst = null; $('#cardInstalar').hidden = true; toast('App instalada.'); });

// ---------- conexión con Firestore ----------
function fatal(msg){ S.fatal = true; setEstado('err', msg); }
function actualizarEstado(){
  if (S.fatal || !S.db) return;
  if (!navigator.onLine) setEstado('warn','Sin conexión: lo que anotes se guarda en este teléfono');
  else if (!(S.sync.movs && S.sync.clientes)) setEstado('warn','Conectando…');
  else if (S.pendM || S.pendC) setEstado('warn','Sincronizando…');
  else setEstado('ok','Sincronizado en tiempo real');
}
function crearAdaptador(F, fs, code){
  const col = n => F.collection(fs, 'negocios', code, n);
  const ref = (n, id) => F.doc(fs, 'negocios', code, n, id);
  const consulta = (n, cons) => F.query(col(n), ...cons.map(c => F.where(c[0], c[1], c[2])));
  const falla = e => toast(e && e.code === 'permission-denied' ? 'Firebase rechazó el guardado. Revisá las reglas de Firestore.' : 'No se pudo guardar un cambio.', true);
  return {
    nuevoId: n => F.doc(col(n)).id,
    inc: n => F.increment(n),
    union: x => F.arrayUnion(x),
    // Firestore confirma con el servidor recién cuando hay señal: no se espera esa confirmación
    // para seguir anotando. Los errores llegan por aviso.
    batch(){
      const wb = F.writeBatch(fs);
      return {
        set(n, id, d){ wb.set(ref(n, id), d); },
        merge(n, id, d){ wb.set(ref(n, id), d, { merge:true }); },
        update(n, id, d){ wb.update(ref(n, id), d); },
        commit(){ return wb.commit().catch(falla); }
      };
    },
    listen(n, cons, next, err){ return F.onSnapshot(consulta(n, cons), { includeMetadataChanges:true }, next, err); },
    get(n, cons){ return F.getDocs(consulta(n, cons)); }
  };
}
async function arrancar(){
  if (S.arrancando || S.db) return;
  S.arrancando = true; S.fatal = false;
  setEstado('warn','Conectando…');
  try {
    const cfg = (await import('./firebase-config.js')).firebaseConfig;
    if (!cfg || !cfg.apiKey || /PEGAR/.test(cfg.apiKey + (cfg.projectId || ''))){ fatal('Falta pegar los datos de Firebase en firebase-config.js'); return; }
    const [A, Fs, Au] = await Promise.all([import(FB_URL + 'firebase-app.js'), import(FB_URL + 'firebase-firestore.js'), import(FB_URL + 'firebase-auth.js')]);
    const app = A.initializeApp(cfg);
    let fs;
    try { fs = Fs.initializeFirestore(app, { localCache:Fs.persistentLocalCache({ tabManager:Fs.persistentMultipleTabManager() }) }); }
    catch (_) { fs = Fs.getFirestore(app); }
    const auth = Au.getAuth(app);
    await auth.authStateReady();
    if (!auth.currentUser) await Au.signInAnonymously(auth);
    S.uid = auth.currentUser.uid;
    S.db = crearAdaptador(Fs, fs, S.code);
  } catch (e){
    const c = (e && e.code) || '';
    if (c === 'auth/operation-not-allowed' || c === 'auth/admin-restricted-operation') fatal('Falta activar el acceso anónimo en Firebase (Authentication).');
    else if (c.indexOf('auth/') === 0 || /Failed to fetch|dynamically imported|network|import/i.test(String((e && e.message) || ''))) fatal('Hace falta internet para activar la app la primera vez.');
    else fatal('No se pudo iniciar Firebase: ' + (c || (e && e.message) || 'error'));
    return;
  } finally { S.arrancando = false; }
  if (!S.db) return;
  S.ventana = startOfDay(Date.now()) - 90 * DIA_MS;
  S.timer = setTimeout(() => { if (!(S.sync.movs && S.sync.clientes) && navigator.onLine) setEstado('warn','Sin respuesta de la base. Se muestra lo último guardado.'); }, 10000);
  const onErr = e => fatal(e && e.code === 'permission-denied' ? 'Firebase rechazó el acceso. Revisá las reglas de Firestore.' : 'No se pudieron leer los datos (' + ((e && e.code) || 'error') + ').');
  S.db.listen('movimientos', [['fecha','>=',S.ventana]], snap => {
    S.movs = new Map(snap.docs.map(d => { const m = leerMov(d); return [m.id, m]; })); derivar();
    S.pendM = snap.metadata.hasPendingWrites;
    if (!snap.metadata.fromCache){ S.sync.movs = true; clearTimeout(S.timer); }
    actualizarEstado(); programar();
  }, onErr);
  S.db.listen('clientes', [], snap => {
    S.clientes = new Map(snap.docs.map(d => { const c = leerCliente(d); return [c.id, c]; })); derivar();
    S.pendC = snap.metadata.hasPendingWrites;
    if (!snap.metadata.fromCache){ S.sync.clientes = true; clearTimeout(S.timer); migrarSaldos(); }
    actualizarEstado(); programar();
  }, onErr);
  S.db.listen('perfiles', [], alCambiarPerfiles, () => {});
  S.db.listen('asignaciones', [['dia','>=',dayKey(S.ventana)]], snap => { S.asig = new Map(snap.docs.map(d => { const a = leerAsig(d); return [a.id, a]; })); derivarAsig(); programar(); }, () => {});
  S.db.listen('config', [], snap => { aplicarConfig(snap.docs); llenarSelectores(); if (S.view === 'ajustes' && !$('#formCfg').contains(document.activeElement)) renderCfg(); programar(); }, () => {});
  S.db.listen('cierres', [['creado','>=',S.ventana]], snap => {
    S.cierres = snap.docs.map(d => { const x = d.data() || {}; return { id:d.id, dia:String(x.dia || ''), creado:Number(x.creado) || 0, por:x.por || '', fondoInicial:Number(x.fondoInicial) || 0,
      contado:Number(x.contado) || 0, esperado:Number(x.esperado) || 0, diferencia:Number(x.diferencia) || 0, nota:x.nota || '', estado:x.estado || 'previo', pendientes:Number(x.pendientes) || 0, distribucion:x.distribucion || null, rectifica:x.rectifica || null, motivo:x.motivo || '', calc:Object.assign(calcularCaja([]), x.calc || {}) }; });
    programar();
  }, () => {});
  nuevoIdForm(); actualizarBoton(); actualizarEstado(); render();
}
/* Clientes creados con versiones anteriores no tienen el saldo guardado: se calcula una sola vez. */
let migrando = false;
async function migrarSaldos(){
  if (migrando || !S.db) return;
  const pend = [...S.clientes.values()].filter(c => !c.saldoOk && !c.fusionadoEn);
  if (!pend.length) return;
  migrando = true;
  try {
    for (const c of pend){
      const snap = await S.db.get('movimientos', [['clienteId','==',c.id]]);
      const ms = snap.docs.map(leerMov);
      const b = S.db.batch();
      b.merge('clientes', c.id, { saldo:round2(ms.reduce((x,m) => x + efectoSaldo(m), 0)), saldoOk:true, ultimo:ms.reduce((x,m) => Math.max(x, m.fecha), c.ultimo || 0), obs:c.obs || '' });
      b.commit();
    }
  } catch (_) {}
  migrando = false;
}
window.addEventListener('online', () => { if (!S.db && !S.arrancando && S.nombre && S.code.length >= 16) arrancar(); actualizarEstado(); });
window.addEventListener('offline', actualizarEstado);

function init(){
  $('#fecha').value = dayKey(Date.now());
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  const mh = /local=([a-z0-9-]+)/i.exec(location.hash);
  if (mh){
    const c = normCodigo(mh[1]);
    if (c.length >= 16) LS.set('almacen.codigo', c);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
  }
  S.nombre = LS.get('almacen.nombre'); S.code = normCodigo(LS.get('almacen.codigo'));
  aplicarIdentidad();
  llenarSelectores(); aplicarForm();
  const hash = location.hash.slice(1);
  render();
  if (hash) setView(hash);
  actualizarBoton();
  try { S.prefs = Object.assign({ recordar:true }, JSON.parse(LS.get('almacen.prefs') || '{}')); } catch (_) {}
  aplicarPrefs();
  if (S.code.length < 16) mostrarSetup(); else arrancar();
}
init();
})();
