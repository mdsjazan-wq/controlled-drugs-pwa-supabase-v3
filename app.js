
const $ = s => document.querySelector(s); const $$ = s => Array.from(document.querySelectorAll(s));
const CFG = window.CD_CONFIG || { USE_SUPABASE:false };
let sb = null; if (CFG.USE_SUPABASE && window.supabase) { sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); }
function today(){ const d=new Date();const m=(''+(d.getMonth()+1)).padStart(2,'0');const day=(''+d.getDate()).padStart(2,'0'); return `${d.getFullYear()}-${m}-${day}`; }
function fmt(n){ return Number(n).toLocaleString('ar-EG'); }

// App data
let items=[], centers=[], receipts=[], issues=[], returnsArr=[], adjustments=[], centersHasInitial=false;

// --- Auth ---
async function ensureAuth(){
  if(!sb) { // إذا Supabase غير مفعّل (وضع معاينة محلي)
    document.getElementById('login-screen').style.display='none';
    document.getElementById('app-header').style.display='block';
    document.getElementById('app-main').style.display='block';
    return true;
  }
  const { data:{ session } } = await sb.auth.getSession();
  if(session){
    document.getElementById('login-screen').style.display='none';
    document.getElementById('app-header').style.display='block';
    document.getElementById('app-main').style.display='block';
    return true;
  }else{
    document.getElementById('login-screen').style.display='flex';
    document.getElementById('app-header').style.display='none';
    document.getElementById('app-main').style.display='none';
    return false;
  }
}
async function signInEmailPassword(email, password){ const { error } = await sb.auth.signInWithPassword({ email, password }); if(error) throw error; }
async function signUpEmailPassword(email, password){ const { error } = await sb.auth.signUp({ email, password }); if(error) throw error; }
async function signOut(){ if(sb) await sb.auth.signOut(); await ensureAuth(); }

// --- DB helpers ---
async function loadAll(){
  if(!CFG.USE_SUPABASE || !sb){ throw new Error('Supabase غير مفعّل.'); }
  const i = await sb.from('items').select('*').order('id');
  const c = await sb.from('centers').select('*').order('id');
  const r = await sb.from('receipts').select('*').order('happened_at');
  const s = await sb.from('issues').select('*').order('happened_at');
  const t = await sb.from('returns').select('*').order('happened_at');
  const err = i.error||c.error||r.error||s.error||t.error;
  if(err){ throw err; }
  items=i.data; centers=c.data; receipts=r.data; issues=s.data; returnsArr=t.data;
  centersHasInitial = !!(centers.length && Object.prototype.hasOwnProperty.call(centers[0],'initial'));
  try{ const ad = await sb.from('adjustments').select('*').order('happened_at'); adjustments = ad.error?[]:ad.data; }catch(e){ adjustments=[]; }
}
async function insertReceipt(itemId, qty, date){ const { error } = await sb.from('receipts').insert({ item_id:itemId, qty:Number(qty), happened_at: date }); if(error) throw error; }
async function insertIssue(itemId, centerId, qty, date){ const { error } = await sb.from('issues').insert({ item_id:itemId, center_id:centerId, qty:Number(qty), happened_at: date }); if(error) throw error; }
async function insertReturn(itemId, centerId, qty, status, date){ const { error } = await sb.from('returns').insert({ item_id:itemId, center_id:centerId, qty:Number(qty), status, happened_at: date }); if(error) throw error; }
async function insertAdjustment(kind, itemId, centerId, qty, date, note){ const { error } = await sb.from('adjustments').insert({ kind, item_id:itemId, center_id:centerId||null, qty:Number(qty), happened_at:date, note:note||null }); if(error) throw error; }
async function updateItem(id, fields){ const { error } = await sb.from('items').update(fields).eq('id', id); if(error) throw error; }
async function insertItem(name, initial){ const { error } = await sb.from('items').insert({ name, initial:Number(initial)||0 }); if(error) throw error; }
async function updateCenter(id, fields){ const { error } = await sb.from('centers').update(fields).eq('id', id); if(error) throw error; }

// --- Calculations (adjustments-aware) ---
function adjSum(filterFn){ return adjustments.filter(filterFn).reduce((a,b)=>a+Number(b.qty||0),0); }
function computeWarehouseStock(itemId){
  const item = items.find(x=>x.id===itemId); const base=item?.initial||0;
  const rec = receipts.filter(r=>r.item_id===itemId).reduce((a,b)=>a+Number(b.qty),0);
  const recAdj = adjSum(a=>a.kind==='receipt' && a.item_id===itemId);
  const iss = issues.filter(i=>i.item_id===itemId).reduce((a,b)=>a+Number(b.qty),0);
  const issAdj = adjSum(a=>a.kind==='issue' && a.item_id===itemId);
  return base + rec + recAdj - (iss + issAdj);
}
function computeCenterStock(centerId, itemId){
  const iss = issues.filter(i=>i.center_id===centerId && i.item_id===itemId).reduce((a,b)=>a+Number(b.qty),0);
  const issAdj = adjSum(a=>a.kind==='issue' && a.center_id===centerId && a.item_id===itemId);
  const ret = returnsArr.filter(r=>r.center_id===centerId && r.item_id===itemId).reduce((a,b)=>a+Number(b.qty),0);
  const retAdjEmpty = adjSum(a=>a.kind==='return_empty' && a.center_id===centerId && a.item_id===itemId);
  const retAdjExp   = adjSum(a=>a.kind==='return_expired' && a.center_id===centerId && a.item_id===itemId);
  return (iss + issAdj) - (ret + retAdjEmpty + retAdjExp);
}
function computeReturnTotals(itemId, status){
  const base = returnsArr.filter(r=>r.item_id===itemId && r.status===status).reduce((a,b)=>a+Number(b.qty),0);
  const adj  = adjSum(a=>a.item_id===itemId && ((status==='empty'&&a.kind==='return_empty')||(status==='expired'&&a.kind==='return_expired')));
  return base + adj;
}

// --- UI helpers ---
function bindNav(){
  $$('.nav button').forEach(b=>b.addEventListener('click', async ()=>{
    $$('.nav button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
    const tab=b.getAttribute('data-tab'); $$('.tab').forEach(s=>s.hidden=true); document.getElementById('tab-'+tab).hidden=false;
    if(tab==='dashboard') renderDashboard(); if(tab==='issue') renderIssue(); if(tab==='receive') renderReceive(); if(tab==='returns') renderReturns();
    if(tab==='reports') renderReports(); if(tab==='adjust') renderAdjust(); if(tab==='settings') renderSettings();
  }));
}
function renderDashboard(){
  const kpi=document.getElementById('kpi-cards'); kpi.innerHTML='';
  const totalWarehouse = items.reduce((a,it)=>a+computeWarehouseStock(it.id),0);
  const totalCenters = centers.reduce((a,c)=>a + items.reduce((x,it)=>x+computeCenterStock(c.id,it.id),0), 0);
  const totalEmpty = items.reduce((a,it)=>a+computeReturnTotals(it.id,'empty'),0);
  const totalExpired = items.reduce((a,it)=>a+computeReturnTotals(it.id,'expired'),0);
  [{title:'إجمالي رصيد المستودع',val:fmt(totalWarehouse)},{title:'إجمالي أرصدة المراكز',val:fmt(totalCenters)},{title:'رجيع فارغ (إجمالي)',val:fmt(totalEmpty)},{title:'رجيع منتهي (إجمالي)',val:fmt(totalExpired)}].forEach(c=>{const d=document.createElement('div');d.className='kpi';d.innerHTML=`<h3>${c.title}</h3><div class="val">${c.val}</div>`;kpi.appendChild(d);});
  const wtbody=document.querySelector('#warehouse-table tbody'); wtbody.innerHTML=''; items.forEach(it=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${it.name}</td><td><strong>${fmt(computeWarehouseStock(it.id))}</strong></td><td>${fmt(computeReturnTotals(it.id,'empty'))}</td><td>${fmt(computeReturnTotals(it.id,'expired'))}</td>`; wtbody.appendChild(tr); });
  const filterSel = document.getElementById('center-filter'); filterSel.innerHTML=''; const allOpt=document.createElement('option'); allOpt.value='all'; allOpt.textContent='الكل'; filterSel.appendChild(allOpt); centers.forEach(c=>{const o=document.createElement('option'); o.value=String(c.id); o.textContent=c.name; filterSel.appendChild(o);}); filterSel.onchange=renderCentersTable; renderCentersTable();
}
function renderCentersTable(){
  const ctbody=document.querySelector('#centers-table tbody'); ctbody.innerHTML=''; const filterVal=document.getElementById('center-filter').value||'all'; const targetCenters=filterVal==='all'?centers:centers.filter(c=>String(c.id)===filterVal);
  targetCenters.forEach(c=>{ items.forEach(it=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${c.name}</td><td>${it.name}</td><td>${fmt(computeCenterStock(c.id,it.id))}</td>`; ctbody.appendChild(tr); }); });
}
function populateSelect(sel, arr){ sel.innerHTML=''; arr.forEach(x=>{ const o=document.createElement('option'); o.value=x.id; o.textContent=x.name; sel.appendChild(o); }); }
function renderIssue(){ populateSelect(document.getElementById('issue-center'), centers); populateSelect(document.getElementById('issue-item'), items); document.getElementById('issue-date').value=today(); }
function renderReceive(){ populateSelect(document.getElementById('receive-item'), items); document.getElementById('receive-date').value=today(); }
function renderReturns(){ populateSelect(document.getElementById('return-center'), centers); populateSelect(document.getElementById('return-item'), items); document.getElementById('return-date').value=today(); }
function renderReports(){
  const sel=document.getElementById('log-item'); sel.innerHTML=''; items.forEach(it=>{ const o=document.createElement('option'); o.value=it.id; o.textContent=it.name; sel.appendChild(o); }); sel.onchange=renderLogTable; renderLogTable();
  const tbody=document.querySelector('#returns-table tbody'); tbody.innerHTML=''; returnsArr.concat(adjustments.filter(a=>a.kind==='return_empty'||a.kind==='return_expired').map(a=>({happened_at:a.happened_at, center_id:a.center_id, item_id:a.item_id, status:a.kind==='return_empty'?'empty':'expired', qty:a.qty, _adj:true }))).sort((a,b)=>(a.happened_at||'').localeCompare(b.happened_at||'')).forEach(r=>{const c=centers.find(x=>x.id===r.center_id); const it=items.find(x=>x.id===r.item_id); const tr=document.createElement('tr'); tr.innerHTML=`<td>${r.happened_at||''}</td><td>${c?.name||'-'}</td><td>${it?.name||'-'}</td><td>${r.status==='empty'?'فارغ':'منتهي'}${r._adj?' (تصحيح)':''}</td><td>${fmt(r.qty)}</td>`; tbody.appendChild(tr); });
}
function renderLogTable(){
  const itemId=Number(document.getElementById('log-item').value)||items[0]?.id; const tbody=document.querySelector('#log-table tbody'); tbody.innerHTML=''; if(!itemId) return;
  const rows=[];
  receipts.forEach(x=>rows.push({date:x.happened_at,type:'استلام من الرياض',center:'-',qty:x.qty,itemId:x.item_id,note:''}));
  issues.forEach(x=>rows.push({date:x.happened_at,type:'صرف لمركز',center:centers.find(c=>c.id===x.center_id)?.name,qty:x.qty,itemId:x.item_id,note:''}));
  returnsArr.forEach(x=>rows.push({date:x.happened_at,type:(x.status==='empty'?'إرجاع (فارغ)':'إرجاع (منتهي)'),center:centers.find(c=>c.id===x.center_id)?.name,qty:x.qty,itemId:x.item_id,note:'لا يؤثر على رصيد المستودع'}));
  adjustments.filter(a=>a.item_id===itemId).forEach(a=>{ const mapType={receipt:'تصحيح استلام',issue:'تصحيح صرف',return_empty:'تصحيح إرجاع (فارغ)',return_expired:'تصحيح إرجاع (منتهي)'}; rows.push({date:a.happened_at,type:mapType[a.kind]||'تصحيح',center:centers.find(c=>c.id===a.center_id)?.name||'-',qty:a.qty,itemId:a.item_id,note:a.note||''}); });
  rows.filter(r=>r.itemId===itemId).sort((a,b)=>(a.date||'').localeCompare(b.date||'')).forEach(r=>{const tr=document.createElement('tr'); tr.innerHTML=`<td>${r.date||''}</td><td>${r.type}</td><td>${r.center||'-'}</td><td>${fmt(r.qty)}</td><td><small>${r.note||''}</small></td>`; tbody.appendChild(tr); });
}
function renderAdjust(){ populateSelect(document.getElementById('adj-center'), centers); populateSelect(document.getElementById('adj-item'), items); document.getElementById('adj-date').value=today(); const tbody=document.querySelector('#adj-table tbody'); tbody.innerHTML=''; adjustments.forEach(a=>{const it=items.find(i=>i.id===a.item_id); const c=centers.find(x=>x.id===a.center_id); const tr=document.createElement('tr'); tr.innerHTML=`<td>${a.happened_at||''}</td><td>${a.kind}</td><td>${c?.name||'-'}</td><td>${it?.name||'-'}</td><td>${fmt(a.qty)}</td><td>${a.note||''}</td>`; tbody.appendChild(tr); }); }
function renderSettings(){
  const wrap=document.getElementById('items-editor'); wrap.innerHTML='';
  items.forEach(it=>{ const row=document.createElement('div'); row.className='row'; row.style.marginBottom='8px'; row.innerHTML=`<input data-type="name" data-id="${it.id}" value="${it.name}" style="flex:1"/><input data-type="initial" data-id="${it.id}" type="number" value="${it.initial||0}" style="width:160px"/><button class="btn btn-outline no-print" data-type="save" data-id="${it.id}">حفظ</button>`; wrap.appendChild(row); });
  wrap.querySelectorAll('button[data-type="save"]').forEach(btn=>{ btn.addEventListener('click', async ()=>{ const id=Number(btn.getAttribute('data-id')); const name=wrap.querySelector(`input[data-type="name"][data-id="${id}"]`).value.trim(); const initial=Number(wrap.querySelector(`input[data-type="initial"][data-id="${id}"]`).value)||0; try{ await updateItem(id,{ name, initial }); alert('تم الحفظ'); await loadAll(); renderSettings(); renderDashboard(); } catch(e){ alert('فشل الحفظ: '+e.message); } }); });
  document.getElementById('btn-add-item').onclick = async ()=>{ const name=document.getElementById('new-item-name').value.trim(); const initial=Number(document.getElementById('new-item-initial').value)||0; if(!name){ alert('أدخل اسم الصنف'); return; } try{ await insertItem(name,initial); document.getElementById('new-item-name').value=''; document.getElementById('new-item-initial').value=''; await loadAll(); renderSettings(); renderDashboard(); }catch(e){ alert('فشل إضافة الصنف: '+e.message); } };
  const cwrap=document.getElementById('centers-editor'); cwrap.innerHTML=''; centers.forEach(c=>{ const row=document.createElement('div'); row.className='row'; row.style.marginBottom='8px'; row.innerHTML=`<input data-type="cname" data-id="${c.id}" value="${c.name}" style="flex:1"/>${centersHasInitial?`<input data-type="cinit" data-id="${c.id}" type="number" value="${c.initial||0}" style="width:160px"/>`:`<span class="muted">لا يوجد عمود initial</span>`}<button class="btn btn-outline no-print" data-type="csave" data-id="${c.id}">حفظ</button>`; cwrap.appendChild(row); });
  cwrap.querySelectorAll('button[data-type="csave"]').forEach(btn=>{ btn.addEventListener('click', async ()=>{ const id=Number(btn.getAttribute('data-id')); const name=cwrap.querySelector(`input[data-type="cname"][data-id="${id}"]`).value.trim(); const patch={name}; if(centersHasInitial){ patch.initial=Number(cwrap.querySelector(`input[data-type="cinit"][data-id="${id}"]`).value)||0; } try{ await updateCenter(id,patch); alert('تم الحفظ'); await loadAll(); renderSettings(); renderDashboard(); }catch(e){ alert('فشل الحفظ: '+e.message); } }); });
  const t=document.getElementById('cfg-table'); t.innerHTML=''; [['USE_SUPABASE', String(!!CFG.USE_SUPABASE)],['SUPABASE_URL', CFG.SUPABASE_URL||'-'],['SUPABASE_ANON_KEY', CFG.SUPABASE_ANON_KEY ? (CFG.SUPABASE_ANON_KEY.slice(0,6)+'...'):'-']].forEach(r=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td><code>${r[0]}</code></td><td>${r[1]}</td>`; t.appendChild(tr); });
}

// --- Actions ---
async function onIssue(){ const centerId=Number(document.getElementById('issue-center').value); const itemId=Number(document.getElementById('issue-item').value); const qty=Number(document.getElementById('issue-qty').value); const date=document.getElementById('issue-date').value||today(); const msg=document.getElementById('issue-msg'); if(!centerId||!itemId||!qty||qty<=0){msg.innerHTML='<div class="warning">تحقق من الحقول.</div>';return;} const avail=computeWarehouseStock(itemId); if(qty>avail){msg.innerHTML=`<div class="warning">المطلوب (${fmt(qty)}) أكبر من المتاح (${fmt(avail)}).</div>`;return;} await insertIssue(itemId,centerId,qty,date); await loadAll(); renderDashboard(); renderIssue(); msg.innerHTML='<div class="success">تم الصرف بنجاح.</div>'; document.getElementById('issue-qty').value=''; }
async function onReceive(){ const itemId=Number(document.getElementById('receive-item').value); const qty=Number(document.getElementById('receive-qty').value); const date=document.getElementById('receive-date').value||today(); const msg=document.getElementById('receive-msg'); if(!itemId||!qty||qty<=0){msg.innerHTML='<div class="warning">تحقق من الحقول.</div>';return;} await insertReceipt(itemId,qty,date); await loadAll(); renderDashboard(); renderReceive(); msg.innerHTML='<div class="success">تم تسجيل الاستلام.</div>'; document.getElementById('receive-qty').value=''; }
async function onReturn(){ const centerId=Number(document.getElementById('return-center').value); const itemId=Number(document.getElementById('return-item').value); const qty=Number(document.getElementById('return-qty').value); const status=document.getElementById('return-status').value; const date=document.getElementById('return-date').value||today(); const msg=document.getElementById('return-msg'); if(!centerId||!itemId||!qty||qty<=0){msg.innerHTML='<div class="warning">تحقق من الحقول.</div>';return;} const centerAvail=computeCenterStock(centerId,itemId); if(qty>centerAvail){msg.innerHTML=`<div class="warning">كمية الإرجاع (${fmt(qty)}) أكبر من رصيد المركز (${fmt(centerAvail)}).</div>`;return;} await insertReturn(itemId,centerId,qty,status,date); await loadAll(); renderDashboard(); renderReturns(); msg.innerHTML='<div class="success">تم تسجيل الإرجاع.</div>'; document.getElementById('return-qty').value=''; }

// --- Exports ---
function tableToCSV(tableEl){ const rows=[...tableEl.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>`"${td.innerText.replace(/"/g,'""')}"`).join(',')); return rows.join('\\n'); }
function download(filename, content, mime){ const blob=new Blob([content],{type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
function exportCSV(){ const csv1=tableToCSV(document.getElementById('warehouse-table')); const csv2=tableToCSV(document.getElementById('centers-table')); const csv3=tableToCSV(document.getElementById('log-table')); const csv4=tableToCSV(document.getElementById('returns-table')); const joined=`ورقة: رصيد المستودع\\n${csv1}\\n\\nورقة: أرصدة المراكز\\n${csv2}\\n\\nورقة: كشف الحركة\\n${csv3}\\n\\nورقة: تقرير الرجيع\\n${csv4}\\n`; download(`reports-${today()}.csv`, joined, 'text/csv;charset=utf-8'); }
async function exportPDF(){ const { jsPDF } = window.jspdf || {}; if(!jsPDF){ alert('مكتبة PDF غير متاحة.'); return; } const doc=new jsPDF({orientation:'p',unit:'pt',format:'a4'}); let y=30; doc.setFont('Helvetica','bold'); doc.setFontSize(14); doc.text('تقارير إدارة الأدوية المخدرة - جازان',40,y); y+=20; function addTable(title,table){ doc.setFontSize(12); doc.setFont('Helvetica','bold'); doc.text(title,40,y); y+=12; doc.setFont('Helvetica','normal'); doc.setFontSize(10); const rows=[...table.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>td.innerText)); rows.forEach((r)=>{ let x=40; y+=14; if(y>780){ doc.addPage(); y=40; } r.forEach((cell)=>{ doc.text(String(cell).slice(0,30), x, y); x+=140; }); }); y+=16; } addTable('رصيد المستودع', document.getElementById('warehouse-table')); addTable('أرصدة المراكز', document.getElementById('centers-table')); addTable('كشف الحركة', document.getElementById('log-table')); addTable('تقرير الرجيع', document.getElementById('returns-table')); doc.save(`reports-${today()}.pdf`); }

// --- Init ---
function bindButtons(){
  document.getElementById('btn-issue').addEventListener('click', ()=>onIssue().catch(e=>alert(e.message)));
  document.getElementById('btn-issue-clear').addEventListener('click', ()=>document.getElementById('issue-qty').value='');
  document.getElementById('btn-receive').addEventListener('click', ()=>onReceive().catch(e=>alert(e.message)));
  document.getElementById('btn-receive-clear').addEventListener('click', ()=>document.getElementById('receive-qty').value='');
  document.getElementById('btn-return').addEventListener('click', ()=>onReturn().catch(e=>alert(e.message)));
  document.getElementById('btn-return-clear').addEventListener('click', ()=>document.getElementById('return-qty').value='');
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);
  const elLogin=document.getElementById('btn-login'); if(elLogin){ elLogin.addEventListener('click', async ()=>{ const email=document.getElementById('login-email').value.trim(); const pass=document.getElementById('login-password').value; const msg=document.getElementById('login-msg'); try{ await signInEmailPassword(email,pass); msg.innerHTML='<div class="success">تم تسجيل الدخول.</div>'; await afterAuth(); }catch(e){ msg.innerHTML='<div class="warning">'+e.message+'</div>'; } }); }
  const elSignup=document.getElementById('btn-signup'); if(elSignup){ elSignup.addEventListener('click', async ()=>{ const email=document.getElementById('login-email').value.trim(); const pass=document.getElementById('login-password').value; const msg=document.getElementById('login-msg'); try{ await signUpEmailPassword(email,pass); msg.innerHTML='<div class="success">تم إنشاء المستخدم. سجّل الدخول الآن.</div>'; }catch(e){ msg.innerHTML='<div class="warning">'+e.message+'</div>'; } }); }
  document.getElementById('btn-logout').addEventListener('click', async ()=>{ await signOut(); });
}
async function afterAuth(){
  await loadAll().catch(e=>console.warn(e));
  renderDashboard(); renderIssue(); renderReceive(); renderReturns(); renderReports(); renderAdjust(); renderSettings();
}
async function init(){
  bindNav(); bindButtons();
  document.getElementById('issue-date').value=today(); document.getElementById('receive-date').value=today(); document.getElementById('return-date').value=today();
  const ok = await ensureAuth();
  if(ok){ await afterAuth(); }
}
window.addEventListener('DOMContentLoaded', init);
