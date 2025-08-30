/* =======================
   Controlled Drugs PWA (v3)
   app.js – Supabase + Auth + Adjustments + Reports + Exports
   with per-center&item initials + onAdjust
   ======================= */

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---- Config & Supabase ---- */
const CFG = window.CD_CONFIG || { USE_SUPABASE: false };
let sb = null;
if (CFG.USE_SUPABASE && window.supabase) {
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
}

/* ---- Utils ---- */
const today = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
};
const fmt = (n) => Number(n || 0).toLocaleString("ar-EG");

/* ---- App State ---- */
let items = [],
  centers = [],
  receipts = [],
  issues = [],
  returnsArr = [],
  adjustments = [],
  centersHasInitial = false,
  cii = []; // center_item_initials

/* =======================
   AUTH
   ======================= */
async function ensureAuth() {
  if (!sb) {
    $("#login-screen").style.display = "none";
    $("#app-header").style.display = "block";
    $("#app-main").style.display = "block";
    return true;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    $("#login-screen").style.display = "none";
    $("#app-header").style.display = "block";
    $("#app-main").style.display = "block";
    return true;
  } else {
    $("#login-screen").style.display = "flex";
    $("#app-header").style.display = "none";
    $("#app-main").style.display = "none";
    return false;
  }
}
const signInEmailPassword = async (email, password) => {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
};
const signUpEmailPassword = async (email, password) => {
  const { error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
};
const signOut = async () => {
  if (sb) await sb.auth.signOut();
  await ensureAuth();
};

/* =======================
   DB HELPERS
   ======================= */
async function loadAll() {
  if (!CFG.USE_SUPABASE || !sb) throw new Error("Supabase غير مفعّل.");
  const i  = await sb.from("items").select("*").order("id");
  const c  = await sb.from("centers").select("*").order("id");
  const r  = await sb.from("receipts").select("*").order("happened_at");
  const s  = await sb.from("issues").select("*").order("happened_at");
  const t  = await sb.from("returns").select("*").order("happened_at");
  const ci = await sb.from("center_item_initials").select("*");
  const err = i.error || c.error || r.error || s.error || t.error || ci.error;
  if (err) throw err;

  items   = i.data || [];
  centers = c.data || [];
  receipts = r.data || [];
  issues   = s.data || [];
  returnsArr = t.data || [];
  cii = ci.data || [];
  centersHasInitial = !!(centers.length && Object.prototype.hasOwnProperty.call(centers[0], "initial"));

  try {
    const ad = await sb.from("adjustments").select("*").order("happened_at");
    adjustments = ad.error ? [] : ad.data || [];
  } catch {
    adjustments = [];
  }
}
const insertReceipt  = async (itemId, qty, date) =>
  (await sb.from("receipts").insert({ item_id: itemId, qty: Number(qty), happened_at: date })).error && 0;
const insertIssue    = async (itemId, centerId, qty, date) =>
  (await sb.from("issues").insert({ item_id: itemId, center_id: centerId, qty: Number(qty), happened_at: date })).error && 0;
const insertReturn   = async (itemId, centerId, qty, status, date) =>
  (await sb.from("returns").insert({ item_id: itemId, center_id: centerId, qty: Number(qty), status, happened_at: date })).error && 0;
const insertAdjustment = async (kind, itemId, centerId, qty, date, note) =>
  (await sb.from("adjustments").insert({ kind, item_id: itemId, center_id: centerId || null, qty: Number(qty), happened_at: date, note: note || null })).error && 0;
const updateItem   = async (id, fields) => (await sb.from("items").update(fields).eq("id", id)).error && 0;
const insertItem   = async (name, initial) => (await sb.from("items").insert({ name, initial: Number(initial) || 0 })).error && 0;
const updateCenter = async (id, fields) => (await sb.from("centers").update(fields).eq("id", id)).error && 0;

/* =======================
   CALCULATIONS
   ======================= */
const adjSum = (fn) => adjustments.filter(fn).reduce((a, b) => a + Number(b.qty || 0), 0);

function getCenterInitial(centerId, itemId) {
  const row = cii.find((r) => r.center_id === centerId && r.item_id === itemId);
  return Number(row?.initial || 0);
}

function computeWarehouseStock(itemId) {
  const item = items.find((x) => x.id === itemId);
  const base = item?.initial || 0;
  const rec = receipts.filter((r) => r.item_id === itemId).reduce((a, b) => a + Number(b.qty), 0);
  const recAdj = adjSum((a) => a.kind === "receipt" && a.item_id === itemId);
  const iss = issues.filter((i) => i.item_id === itemId).reduce((a, b) => a + Number(b.qty), 0);
  const issAdj = adjSum((a) => a.kind === "issue" && a.item_id === itemId);
  return base + rec + recAdj - (iss + issAdj);
}

function computeCenterStock(centerId, itemId) {
  const base = getCenterInitial(centerId, itemId);
  const iss = issues.filter((i) => i.center_id === centerId && i.item_id === itemId)
                    .reduce((a, b) => a + Number(b.qty), 0);
  const issAdj = adjSum((a) => a.kind === "issue" && a.center_id === centerId && a.item_id === itemId);
  const ret = returnsArr.filter((r) => r.center_id === centerId && r.item_id === itemId)
                        .reduce((a, b) => a + Number(b.qty), 0);
  const retAdjEmpty = adjSum((a) => a.kind === "return_empty" && a.center_id === centerId && a.item_id === itemId);
  const retAdjExp   = adjSum((a) => a.kind === "return_expired" && a.center_id === centerId && a.item_id === itemId);
  return base + (iss + issAdj) - (ret + retAdjEmpty + retAdjExp);
}

function computeReturnTotals(itemId, status) {
  const base = returnsArr
    .filter((r) => r.item_id === itemId && r.status === status)
    .reduce((a, b) => a + Number(b.qty), 0);
  const adj =
    status === "empty"
      ? adjSum((a) => a.item_id === itemId && a.kind === "return_empty")
      : adjSum((a) => a.item_id === itemId && a.kind === "return_expired");
  return base + adj;
}

/* =======================
   RENDERING
   ======================= */
function bindNav() {
  $$(".nav button").forEach((b) =>
    b.addEventListener("click", () => {
      $$(".nav button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const tab = b.getAttribute("data-tab");
      $$(".tab").forEach((s) => (s.hidden = true));
      $(`#tab-${tab}`).hidden = false;

      if (tab === "dashboard") renderDashboard();
      if (tab === "issue") renderIssue();
      if (tab === "receive") renderReceive();
      if (tab === "returns") renderReturns();
      if (tab === "reports") renderReports();
      if (tab === "adjust") renderAdjust();
      if (tab === "settings") renderSettings();
    })
  );
}

function renderDashboard() {
  const kpi = $("#kpi-cards");
  kpi.innerHTML = "";
  const totalWarehouse = items.reduce((a, it) => a + computeWarehouseStock(it.id), 0);
  const totalCenters = centers.reduce(
    (a, c) => a + items.reduce((x, it) => x + computeCenterStock(c.id, it.id), 0),
    0
  );
  const totalEmpty = items.reduce((a, it) => a + computeReturnTotals(it.id, "empty"), 0);
  const totalExpired = items.reduce((a, it) => a + computeReturnTotals(it.id, "expired"), 0);
  [
    { title: "إجمالي رصيد المستودع", val: fmt(totalWarehouse) },
    { title: "إجمالي أرصدة المراكز", val: fmt(totalCenters) },
    { title: "رجيع فارغ (إجمالي)",  val: fmt(totalEmpty) },
    { title: "رجيع منتهي (إجمالي)", val: fmt(totalExpired) },
  ].forEach((c) => {
    const d = document.createElement("div");
    d.className = "kpi";
    d.innerHTML = `<h3>${c.title}</h3><div class="val">${c.val}</div>`;
    kpi.appendChild(d);
  });

  const wtbody = $("#warehouse-table tbody");
  wtbody.innerHTML = "";
  items.forEach((it) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${it.name}</td>
      <td><strong>${fmt(computeWarehouseStock(it.id))}</strong></td>
      <td>${fmt(computeReturnTotals(it.id, "empty"))}</td>
      <td>${fmt(computeReturnTotals(it.id, "expired"))}</td>`;
    wtbody.appendChild(tr);
  });

  const filterSel = $("#center-filter");
  filterSel.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "الكل";
  filterSel.appendChild(allOpt);
  centers.forEach((c) => {
    const o = document.createElement("option");
    o.value = String(c.id);
    o.textContent = c.name;
    filterSel.appendChild(o);
  });
  filterSel.onchange = renderCentersTable;
  renderCentersTable();
}

function renderCentersTable() {
  const ctbody = $("#centers-table tbody");
  ctbody.innerHTML = "";
  const filterVal = $("#center-filter").value || "all";
  const targetCenters =
    filterVal === "all" ? centers : centers.filter((c) => String(c.id) === filterVal);
  targetCenters.forEach((c) =>
    items.forEach((it) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${c.name}</td><td>${it.name}</td><td>${fmt(computeCenterStock(c.id, it.id))}</td>`;
      ctbody.appendChild(tr);
    })
  );
}

const populateSelect = (sel, arr) => {
  sel.innerHTML = "";
  arr.forEach((x) => {
    const o = document.createElement("option");
    o.value = x.id;
    o.textContent = x.name;
    sel.appendChild(o);
  });
};
const renderIssue   = () => { populateSelect($("#issue-center"), centers); populateSelect($("#issue-item"), items); $("#issue-date").value = today(); };
const renderReceive = () => { populateSelect($("#receive-item"), items); $("#receive-date").value = today(); };
const renderReturns = () => { populateSelect($("#return-center"), centers); populateSelect($("#return-item"), items); $("#return-date").value = today(); };

function renderReports() {
  const sel = $("#log-item");
  sel.innerHTML = "";
  items.forEach((it) => {
    const o = document.createElement("option");
    o.value = it.id;
    o.textContent = it.name;
    sel.appendChild(o);
  });
  sel.onchange = renderLogTable;
  renderLogTable();

  const tbody = $("#returns-table tbody");
  tbody.innerHTML = "";
  const adjReturns = adjustments
    .filter((a) => a.kind === "return_empty" || a.kind === "return_expired")
    .map((a) => ({
      happened_at: a.happened_at,
      center_id: a.center_id,
      item_id: a.item_id,
      status: a.kind === "return_empty" ? "empty" : "expired",
      qty: a.qty,
      _adj: true,
    }));
  returnsArr
    .concat(adjReturns)
    .sort((a, b) => (a.happened_at || "").localeCompare(b.happened_at || ""))
    .forEach((r) => {
      const c = centers.find((x) => x.id === r.center_id);
      const it = items.find((x) => x.id === r.item_id);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.happened_at || ""}</td>
        <td>${c?.name || "-"}</td>
        <td>${it?.name || "-"}</td>
        <td>${r.status === "empty" ? "فارغ" : "منتهي"}${r._adj ? " (تصحيح)" : ""}</td>
        <td>${fmt(r.qty)}</td>`;
      tbody.appendChild(tr);
    });
}

function renderLogTable() {
  const itemId = Number($("#log-item").value) || items[0]?.id;
  const tbody = $("#log-table tbody");
  tbody.innerHTML = "";
  if (!itemId) return;

  const rows = [];
  receipts.forEach((x) =>
    rows.push({ date: x.happened_at, type: "استلام من الرياض", center: "-", qty: x.qty, itemId: x.item_id, note: "" })
  );
  issues.forEach((x) =>
    rows.push({ date: x.happened_at, type: "صرف لمركز", center: centers.find((c) => c.id === x.center_id)?.name, qty: x.qty, itemId: x.item_id, note: "" })
  );
  returnsArr.forEach((x) =>
    rows.push({ date: x.happened_at, type: x.status === "empty" ? "إرجاع (فارغ)" : "إرجاع (منتهي)", center: centers.find((c) => c.id === x.center_id)?.name, qty: x.qty, itemId: x.item_id, note: "لا يؤثر على رصيد المستودع" })
  );
  adjustments
    .filter((a) => a.item_id === itemId)
    .forEach((a) => {
      const mapType = {
        receipt: "تصحيح استلام",
        issue: "تصحيح صرف",
        return_empty: "تصحيح إرجاع (فارغ)",
        return_expired: "تصحيح إرجاع (منتهي)",
      };
      rows.push({
        date: a.happened_at,
        type: mapType[a.kind] || "تصحيح",
        center: centers.find((c) => c.id === a.center_id)?.name || "-",
        qty: a.qty,
        itemId: a.item_id,
        note: a.note || "",
      });
    });

  rows
    .filter((r) => r.itemId === itemId)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.date || ""}</td><td>${r.type}</td><td>${r.center || "-"}</td><td>${fmt(r.qty)}</td><td><small>${r.note || ""}</small></td>`;
      tbody.appendChild(tr);
    });
}

function renderAdjust() {
  populateSelect($("#adj-center"), centers);
  populateSelect($("#adj-item"), items);
  $("#adj-date").value = today();
  const tbody = $("#adj-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  adjustments.forEach((a) => {
    const it = items.find((i) => i.id === a.item_id);
    const c = centers.find((x) => x.id === a.center_id);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${a.happened_at || ""}</td><td>${a.kind}</td><td>${c?.name || "-"}</td><td>${it?.name || "-"}</td><td>${fmt(a.qty)}</td><td>${a.note || ""}</td>`;
    tbody.appendChild(tr);
  });
}

function renderSettings() {
  const wrap = $("#items-editor");
  wrap.innerHTML = "";
  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "row";
    row.style.marginBottom = "8px";
    row.innerHTML = `
      <input data-type="name" data-id="${it.id}" value="${it.name}" style="flex:1"/>
      <input data-type="initial" data-id="${it.id}" type="number" value="${it.initial || 0}" style="width:160px"/>
      <button class="btn btn-outline no-print" data-type="save" data-id="${it.id}">حفظ</button>`;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('button[data-type="save"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-id"));
      const name = wrap.querySelector(`input[data-type="name"][data-id="${id}"]`).value.trim();
      const initial = Number(wrap.querySelector(`input[data-type="initial"][data-id="${id}"]`).value) || 0;
      try {
        await updateItem(id, { name, initial });
        alert("تم الحفظ");
        await loadAll();
        renderSettings();
        renderDashboard();
      } catch (e) {
        alert("فشل الحفظ: " + e.message);
      }
    });
  });

  $("#btn-add-item").onclick = async () => {
    const name = $("#new-item-name").value.trim();
    const initial = Number($("#new-item-initial").value) || 0;
    if (!name) return alert("أدخل اسم الصنف");
    try {
      await insertItem(name, initial);
      $("#new-item-name").value = "";
      $("#new-item-initial").value = "";
      await loadAll();
      renderSettings();
      renderDashboard();
    } catch (e) {
      alert("فشل إضافة الصنف: " + e.message);
    }
  };

  const cwrap = $("#centers-editor");
  cwrap.innerHTML = "";
  centers.forEach((c) => {
    const row = document.createElement("div");
    row.className = "row";
    row.style.marginBottom = "8px";
    row.innerHTML = `
      <input data-type="cname" data-id="${c.id}" value="${c.name}" style="flex:1"/>
      ${
        centersHasInitial
          ? `<input data-type="cinit" data-id="${c.id}" type="number" value="${c.initial || 0}" style="width:160px"/>`
          : `<span class="muted">لا يوجد عمود initial</span>`
      }
      <button class="btn btn-outline no-print" data-type="csave" data-id="${c.id}">حفظ</button>`;
    cwrap.appendChild(row);
  });
  cwrap.querySelectorAll('button[data-type="csave"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-id"));
      const name = cwrap.querySelector(`input[data-type="cname"][data-id="${id}"]`).value.trim();
      const patch = { name };
      if (centersHasInitial) {
        patch.initial = Number(cwrap.querySelector(`input[data-type="cinit"][data-id="${id}"]`).value) || 0;
      }
      try {
        await updateCenter(id, patch);
        alert("تم الحفظ");
        await loadAll();
        renderSettings();
        renderDashboard();
      } catch (e) {
        alert("فشل الحفظ: " + e.message);
      }
    });
  });

  // Per center/item initials editor
  const ciiWrap = document.getElementById("cii-editor");
  if (ciiWrap) {
    let html = '<table class="table"><thead><tr><th>المركز \\ الصنف</th>';
    items.forEach((it) => (html += `<th>${it.name}</th>`));
    html += "</tr></thead><tbody>";
    centers.forEach((c) => {
      html += `<tr><td style="text-align:right">${c.name}</td>`;
      items.forEach((it) => {
        const val = getCenterInitial(c.id, it.id);
        html += `<td><input type="number" style="width:90px" value="${val}"
                 data-ci-center="${c.id}" data-ci-item="${it.id}" /></td>`;
      });
      html += "</tr>";
    });
    html += `</tbody></table>
             <div class="row no-print">
               <button class="btn btn-primary" id="btn-save-cii">حفظ الافتتاحيات</button>
             </div>`;
    ciiWrap.innerHTML = html;

    document.getElementById("btn-save-cii").onclick = async () => {
      try {
        const inputs = ciiWrap.querySelectorAll("input[data-ci-center]");
        const payload = Array.from(inputs).map((inp) => ({
          center_id: Number(inp.getAttribute("data-ci-center")),
          item_id: Number(inp.getAttribute("data-ci-item")),
          initial: Number(inp.value) || 0,
        }));
        let idx = 0;
        while (idx < payload.length) {
          const batch = payload.slice(idx, idx + 500);
          const { error } = await sb
            .from("center_item_initials")
            .upsert(batch, { onConflict: "center_id,item_id" });
          if (error) throw error;
          idx += 500;
        }
        alert("تم حفظ الأرصدة الافتتاحية لكل مركز/صنف.");
        await loadAll();
        renderDashboard();
      } catch (e) {
        alert("فشل الحفظ: " + e.message);
      }
    };
  }

  const t = $("#cfg-table");
  if (t) {
    t.innerHTML = "";
    [
      ["USE_SUPABASE", String(!!CFG.USE_SUPABASE)],
      ["SUPABASE_URL", CFG.SUPABASE_URL || "-"],
      ["SUPABASE_ANON_KEY", CFG.SUPABASE_ANON_KEY ? CFG.SUPABASE_ANON_KEY.slice(0, 6) + "..." : "-"],
    ].forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><code>${r[0]}</code></td><td>${r[1]}</td>`;
      t.appendChild(tr);
    });
  }
}

/* =======================
   ACTIONS
   ======================= */
async function onIssue() {
  const centerId = Number($("#issue-center").value);
  const itemId   = Number($("#issue-item").value);
  const qty      = Number($("#issue-qty").value);
  const date     = $("#issue-date").value || today();
  const msg = $("#issue-msg");

  if (!centerId || !itemId || !qty || qty <= 0) {
    msg.innerHTML = '<div class="warning">تحقق من الحقول.</div>';
    return;
  }
  const avail = computeWarehouseStock(itemId);
  if (qty > avail) {
    msg.innerHTML = `<div class="warning">المطلوب (${fmt(qty)}) أكبر من المتاح (${fmt(avail)}).</div>`;
    return;
  }
  await insertIssue(itemId, centerId, qty, date);
  await loadAll();
  renderDashboard();
  renderIssue();
  msg.innerHTML = '<div class="success">تم الصرف بنجاح.</div>';
  $("#issue-qty").value = "";
}

async function onReceive() {
  const itemId = Number($("#receive-item").value);
  const qty    = Number($("#receive-qty").value);
  const date   = $("#receive-date").value || today();
  const msg = $("#receive-msg");

  if (!itemId || !qty || qty <= 0) {
    msg.innerHTML = '<div class="warning">تحقق من الحقول.</div>';
    return;
  }
  await insertReceipt(itemId, qty, date);
  await loadAll();
  renderDashboard();
  renderReceive();
  msg.innerHTML = '<div class="success">تم تسجيل الاستلام.</div>';
  $("#receive-qty").value = "";
}

async function onReturn() {
  const centerId = Number($("#return-center").value);
  const itemId   = Number($("#return-item").value);
  const qty      = Number($("#return-qty").value);
  const status   = $("#return-status").value;
  const date     = $("#return-date").value || today();
  const msg = $("#return-msg");

  if (!centerId || !itemId || !qty || qty <= 0) {
    msg.innerHTML = '<div class="warning">تحقق من الحقول.</div>';
    return;
  }
  const centerAvail = computeCenterStock(centerId, itemId);
  if (qty > centerAvail) {
    msg.innerHTML = `<div class="warning">كمية الإرجاع (${fmt(qty)}) أكبر من رصيد المركز (${fmt(centerAvail)}).</div>`;
    return;
  }
  await insertReturn(itemId, centerId, qty, status, date);
  await loadAll();
  renderDashboard();
  renderReturns();
  msg.innerHTML = '<div class="success">تم تسجيل الإرجاع.</div>';
  $("#return-qty").value = "";
}

/* ---- NEW: Adjustments handler ---- */
async function onAdjust() {
  const kind = document.getElementById('adj-kind').value;   // receipt | issue | return_empty | return_expired
  const centerIdRaw = document.getElementById('adj-center').value;
  const itemId = Number(document.getElementById('adj-item').value);
  const qty = Number(document.getElementById('adj-qty').value);
  const date = document.getElementById('adj-date').value || today();
  const note = document.getElementById('adj-note').value.trim();
  const msg = document.getElementById('adj-msg');

  if (!itemId || !qty || qty === 0) {
    msg.innerHTML = '<div class="warning">أدخل الصنف والكمية (يمكن أن تكون سالبة للتنقيص).</div>';
    return;
  }
  let centerId = null;
  if (kind !== 'receipt') {
    centerId = Number(centerIdRaw);
    if (!centerId) {
      msg.innerHTML = '<div class="warning">اختر المركز لهذا النوع من التصحيح.</div>';
      return;
    }
  }

  await insertAdjustment(kind, itemId, centerId, qty, date, note);
  await loadAll();
  renderDashboard();
  renderAdjust();
  msg.innerHTML = '<div class="success">تم تسجيل التصحيح.</div>';

  document.getElementById('adj-qty').value = '';
  document.getElementById('adj-note').value = '';
}

/* =======================
   EXPORTS
   ======================= */
const tableToCSV = (tableEl) =>
  [...tableEl.querySelectorAll("tr")]
    .map((tr) =>
      [...tr.children]
        .map((td) => `"${(td.innerText || "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV() {
  const csv1 = tableToCSV($("#warehouse-table"));
  const csv2 = tableToCSV($("#centers-table"));
  const csv3 = tableToCSV($("#log-table"));
  const csv4 = tableToCSV($("#returns-table"));
  const joined = `ورقة: رصيد المستودع\n${csv1}\n\nورقة: أرصدة المراكز\n${csv2}\n\nورقة: كشف الحركة\n${csv3}\n\nورقة: تقرير الرجيع\n${csv4}\n`;
  download(`reports-${today()}.csv`, joined, "text/csv;charset=utf-8");
}

async function exportPDF() {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) return alert("مكتبة PDF غير متاحة.");
  const doc = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  let y = 30;
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(14);
  doc.text("تقارير إدارة الأدوية المخدرة - جازان", 40, y);
  y += 20;
  function addTable(title, table) {
    doc.setFontSize(12);
    doc.setFont("Helvetica", "bold");
    doc.text(title, 40, y);
    y += 12;
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(10);
    const rows = [...table.querySelectorAll("tr")].map((tr) =>
      [...tr.children].map((td) => td.innerText)
    );
    rows.forEach((r) => {
      let x = 40;
      y += 14;
      if (y > 780) { doc.addPage(); y = 40; }
      r.forEach((cell) => { doc.text(String(cell).slice(0, 30), x, y); x += 140; });
    });
    y += 16;
  }
  addTable("رصيد المستودع", $("#warehouse-table"));
  addTable("أرصدة المراكز", $("#centers-table"));
  addTable("كشف الحركة", $("#log-table"));
  addTable("تقرير الرجيع", $("#returns-table"));
  doc.save(`reports-${today()}.pdf`);
}

/* =======================
   INIT / BINDINGS
   ======================= */
function bindButtons() {
  $("#btn-issue").addEventListener("click", () => onIssue().catch((e) => alert(e.message)));
  $("#btn-issue-clear").addEventListener("click", () => ($("#issue-qty").value = ""));
  $("#btn-receive").addEventListener("click", () => onReceive().catch((e) => alert(e.message)));
  $("#btn-receive-clear").addEventListener("click", () => ($("#receive-qty").value = ""));
  $("#btn-return").addEventListener("click", () => onReturn().catch((e) => alert(e.message)));
  $("#btn-return-clear").addEventListener("click", () => ($("#return-qty").value = ""));
  $("#btn-export-csv").addEventListener("click", exportCSV);
  $("#btn-export-pdf").addEventListener("click", exportPDF);
  document.getElementById('btn-adj').addEventListener('click', () => onAdjust().catch(e => alert(e.message))); // ← ربط زر التصحيح

  const btnLogin = $("#btn-login");
  if (btnLogin) {
    btnLogin.addEventListener("click", async () => {
      const email = $("#login-email").value.trim();
      const pass = $("#login-password").value;
      const msg = $("#login-msg");
      try {
        await signInEmailPassword(email, pass);
        msg.innerHTML = '<div class="success">تم تسجيل الدخول.</div>';
        await ensureAuth();
        await loadAll().catch(()=>{});
        renderDashboard(); renderIssue(); renderReceive(); renderReturns(); renderReports(); renderAdjust(); renderSettings();
      } catch (e) {
        msg.innerHTML = '<div class="warning">' + e.message + "</div>";
      }
    });
  }

  const btnSignup = $("#btn-signup");
  if (btnSignup) {
    btnSignup.addEventListener("click", async () => {
      const email = $("#login-email").value.trim();
      const pass = $("#login-password").value;
      const msg = $("#login-msg");
      try {
        await signUpEmailPassword(email, pass);
        msg.innerHTML = '<div class="success">تم إنشاء المستخدم. سجّل الدخول الآن.</div>';
      } catch (e) {
        msg.innerHTML = '<div class="warning">' + e.message + "</div>";
      }
    });
  }

  $("#btn-logout").addEventListener("click", async () => { await signOut(); });
}

async function afterAuth() {
  await loadAll().catch((e) => console.warn(e));
  renderDashboard();
  renderIssue();
  renderReceive();
  renderReturns();
  renderReports();
  renderAdjust();
  renderSettings();
}

async function init() {
  bindNav();
  bindButtons();
  $("#issue-date").value = today();
  $("#receive-date").value = today();
  $("#return-date").value = today();
  const ok = await ensureAuth();
  if (ok) await afterAuth();
}
window.addEventListener("DOMContentLoaded", init);
