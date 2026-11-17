(function(){
'use strict';

var CATS = [
  {id:'bread', name:'发酵面包', hint:'先做：面团发酵时间最长，发酵期间穿插做别的。'},
  {id:'chill', name:'糖水奶冻', hint:'第二步：需要冷藏定型，越早做越稳。'},
  {id:'cake',  name:'蛋糕罐头', hint:'第三步：戚风烤好放凉后再组装装罐。'},
  {id:'tart',  name:'酥皮挞类', hint:'最后烤：出炉时间离自提越近越好。'},
  {id:'other', name:'其他', hint:''}
];
var UNITS = ['g','ml','个'];
var HOURS = [
  ['production','生产日（备料、制作、包装）'],['purchase','采购'],['comms','接单、回消息、发帖'],
  ['pickup','两地自提等人'],['cleaning','清洁收尾'],['other','其他']
];

var DB = null, mode = 'loading', banner = '';
var ING = new Map(), REC = new Map(), PLAN = defaultPlan();
var ORD = new Map(), CUS = new Map(), MOD = new Map();
var csearch = '', cseg = 'all', openMsg = null;
var pflt = {place:{}, date:{}}, pOff = 0;   /* pOff：本周生产看哪一周，0 = 本周，1 = 下周 */   /* 本周生产的筛选：地点、取货日期，可多选 */
var wview = 'sales', wOff = 0, aiText = '', aiBusy = false, aiCtl = null;
var loaded = {ing:false, rec:false, plan:false, ord:false, cus:false, mod:false};
/* three top-level areas, each with sub-pages; remember where you were */
var GROUPS = {orders:'orders', customers:'orders', recipes:'recipes', modules:'recipes', ingredients:'recipes', week:'week'};
var SUBS = {orders:[['orders','订单'],['customers','客人']], recipes:[['recipes','配方'],['modules','模块'],['ingredients','原料']]};
var lastSub = {orders:'orders', recipes:'recipes', week:'week'};
function store(k, v){ try { localStorage.setItem('bakehub.' + k, v); } catch(e){} }
function load(k){ try { return localStorage.getItem('bakehub.' + k); } catch(e){ return null; } }
(function(){
  ['orders','recipes'].forEach(function(g){ var v = load('sub.' + g); if (v && GROUPS[v] === g) lastSub[g] = v; });
})();
var startTab = load('tab'); if (!GROUPS[startTab]) startTab = 'orders';
var view = {tab:startTab, recipeId:null, editing:false, draft:null, scale:null};
function subSegHtml(){
  var g = GROUPS[view.tab]; if (!SUBS[g]) return '';
  return '<div class="wseg" role="group" aria-label="切换">' + SUBS[g].map(function(x){
    return '<button data-action="sub" data-v="' + x[0] + '" aria-pressed="' + (view.tab === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
}
var ofilter = 'open';
var pendingRender = false;

function defaultPlan(){
  return {orders:{}, hours:{production:8,purchase:1.5,comms:2,pickup:2,cleaning:1,other:0}, targetWage:20, targetMargin:0.65, stampGoal:8, stampReward:'一个罐头蛋糕', recontactDays:21, made:{}};
}
function mergePlan(d){
  var p = defaultPlan(); d = d || {};
  p.orders = Object.assign({}, d.orders || {});
  p.hours = Object.assign(p.hours, d.hours || {});
  if (isFinite(+d.targetWage) && d.targetWage !== '' && d.targetWage != null) p.targetWage = +d.targetWage;
  if (isFinite(+d.targetMargin) && d.targetMargin !== '' && d.targetMargin != null) p.targetMargin = +d.targetMargin;
  if (+d.stampGoal > 0) p.stampGoal = Math.round(+d.stampGoal);
  if (d.stampReward != null && String(d.stampReward).trim()) p.stampReward = String(d.stampReward);
  if (+d.recontactDays > 0) p.recontactDays = Math.round(+d.recontactDays);
  var mk = d.made; if (typeof mk === 'string'){ try { mk = JSON.parse(mk || '{}'); } catch (e) { mk = {}; } }
  p.made = mk && typeof mk === 'object' ? mk : {};
  return p;
}
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function num(v){ var n = parseFloat(v); return isFinite(n) ? n : 0; }
function money(v){ return (v == null || !isFinite(v)) ? '—' : (v < 0 ? '-$' + (-v).toFixed(2) : '$' + v.toFixed(2)); }
function pct(v){ return (v == null || !isFinite(v)) ? '—' : (v*100).toFixed(1) + '%'; }
function amt(v, unit){
  if (!isFinite(v)) return '—';
  if (unit === '个') return (Math.round(v*10)/10).toString();
  return v >= 10 ? Math.round(v).toString() : (Math.round(v*10)/10).toString();
}
function newId(){ return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function catOf(id){ for (var i=0;i<CATS.length;i++) if (CATS[i].id===id) return CATS[i]; return CATS[CATS.length-1]; }
function catIndex(id){ for (var i=0;i<CATS.length;i++) if (CATS[i].id===id) return i; return CATS.length-1; }

/* ---------- storage ---------- */
var chains = {};
function write(path, data, del){
  if (mode !== 'db') return Promise.resolve();
  var run = function(){ return del ? DB.doc(path).delete() : DB.doc(path).set(data); };
  var p = (chains[path] || Promise.resolve()).then(run).catch(function(e){
    if (e && e.code === 'unavailable'){
      return new Promise(function(r){ setTimeout(r, 700 + Math.random()*800); }).then(run).catch(showErr);
    }
    showErr(e);
  });
  chains[path] = p;
  return p;
}
function showErr(e){
  var c = e && e.code;
  if (c === 'invalid_argument') toast('你没有编辑权限，这次改动没有保存。');
  else if (c === 'quota_exceeded') toast('存储已满，删掉一些不用的配方或原料后再试。');
  else if (c === 'resource_exhausted') toast('操作太频繁，稍等几秒再改。');
  else toast('保存失败，请检查网络后重试。');
}
var toastTimer;
function toast(msg){
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.classList.remove('on'); }, 2600);
}
function saveIngredient(id, obj){ ING.set(id, obj); write('ingredients/' + id, obj); }
function deleteIngredient(id){ ING.delete(id); write('ingredients/' + id, null, true); }
function saveRecipe(id, obj){ REC.set(id, obj); write('recipes/' + id, obj); }
function deleteRecipe(id){ REC.delete(id); delete PLAN.orders[id]; write('recipes/' + id, null, true); savePlanNow(); }
var planTimer;
function savePlan(){ clearTimeout(planTimer); planTimer = setTimeout(savePlanNow, 500); }
function savePlanNow(){ write('plan/week', clone(PLAN)); }
function saveOrder(id, obj){ ORD.set(id, obj); write('orders/' + id, obj); }
function deleteOrder(id){ ORD.delete(id); write('orders/' + id, null, true); }
function saveCustomer(id, obj){ CUS.set(id, obj); write('customers/' + id, obj); }
function deleteCustomer(id){ CUS.delete(id); write('customers/' + id, null, true); }
function saveModule(id, obj){ MOD.set(id, obj); write('modules/' + id, obj); }
function deleteModule(id){ MOD.delete(id); write('modules/' + id, null, true); }

/* ---------- calculations ---------- */
function unitPrice(ing){
  if (!ing) return null;
  var p = parseFloat(ing.price), q = parseFloat(ing.qty);
  return (isFinite(p) && isFinite(q) && q > 0) ? p / q : null;
}
/* 新品价：取货日期在截止日（含）之前用新品价，之后自动恢复原价 */
function launchActive(r, date){ return !!r && r.launchPrice !== '' && r.launchPrice != null && !!r.launchUntil && (date || today()) <= r.launchUntil; }
function priceFor(r, date){ return launchActive(r, date) ? num(r.launchPrice) : num(r.price); }
/* 新品价截止 = 下单那一周的周二（每周从周三算到下周二；周三截单，过了周三就算下一周） */
function launchWeekEnd(){ var t = today(), p = t.split('-'), d = new Date(+p[0], +p[1]-1, +p[2]); d.setDate(d.getDate() + (3 - d.getDay() + 7) % 7 + 6); return ymd(d); }
function isBlind(r){ return !!r && (r.blind === false ? false : (!!r.blind || /盲盒/.test(String(r.name || '')))); }
function unitCostOf(rid){ var r = REC.get(rid); if (!r || isBlind(r)) return null; return calc(r).unitCost; }
/* 盲盒成本：按以往订单里实际给的产品平均；没有记录时按同分类产品平均 */
function blindEstimate(r){
  var sum = 0, n = 0, cnt = {};
  ORD.forEach(function(o){
    (o.items || []).forEach(function(it){
      if (REC.get(it.recipeId) !== r) return;
      (it.actual || []).forEach(function(aid){
        var c = aid ? unitCostOf(aid) : null; if (c == null) return;
        sum += c; n++; var nm = REC.get(aid).name; cnt[nm] = (cnt[nm] || 0) + 1;
      });
    });
  });
  var top = Object.keys(cnt).sort(function(a, b){ return cnt[b] - cnt[a]; }).slice(0, 3).map(function(k){ return k + ' ×' + cnt[k]; });
  if (n) return {cost:sum / n, n:n, top:top, from:'history'};
  var s2 = 0, n2 = 0;
  REC.forEach(function(x){ if (x === r || isBlind(x) || x.category !== r.category) return; var c = calc(x).unitCost; if (c > 0){ s2 += c; n2++; } });
  return n2 ? {cost:s2 / n2, n:0, top:[], from:'category'} : {cost:null, n:0, top:[], from:'none'};
}
function calc(r){
  if (isBlind(r) && !(r.items || []).length){
    var e = blindEstimate(r), uc = e.cost, pr0 = num(r.price), g0 = uc == null ? null : pr0 - uc;
    return {batch:0, perIng:uc, unitCost:uc, price:pr0, gross:g0, margin:(g0 != null && pr0 > 0) ? g0 / pr0 : null,
      missing:uc == null ? ['还没有可参考的成本'] : [], blindEst:e};
  }
  var batch = 0, missing = [];
  (r.items || []).forEach(function(it){
    var lc = lineCost(it);
    lc.missing.forEach(function(m){ if (missing.indexOf(m) < 0) missing.push(m); });
    if (lc.cost != null) batch += lc.cost;
  });
  var y = num(r.yield);
  var perIng = y > 0 ? batch / y : null;
  var unitCost = perIng == null ? null : perIng + num(r.packaging) + num(r.utilities);
  var price = num(r.price);
  var gross = unitCost == null ? null : price - unitCost;
  var margin = (gross != null && price > 0) ? gross / price : null;
  return {batch:batch, perIng:perIng, unitCost:unitCost, price:price, gross:gross, margin:margin, missing:missing};
}
function sortedRecipes(){
  return Array.from(REC.entries()).sort(function(a,b){
    var d = catIndex(a[1].category) - catIndex(b[1].category);
    return d !== 0 ? d : String(a[1].name||'').localeCompare(String(b[1].name||''), 'zh');
  });
}
function sortedIngredients(){
  return Array.from(ING.entries()).sort(function(a,b){
    return String(a[1].name||'').localeCompare(String(b[1].name||''), 'zh');
  });
}
function usage(ingId){
  var n = 0, has = function(x){ return (x.items || []).some(function(it){ return it.ingId === ingId; }); };
  REC.forEach(function(r){ if (has(r)) n++; }); MOD.forEach(function(m){ if (has(m)) n++; });
  return n;
}
/* ---------- modules: reusable parts (戚风、奶冻、奶油…) ---------- */
function modCost(m){
  var batch = 0, missing = [];
  (m.items || []).forEach(function(it){
    var ing = ING.get(it.ingId), up = unitPrice(ing);
    if (up == null){ missing.push(ing ? (ing.name || '未命名原料') : '已删除的原料'); return; }
    batch += up * num(it.amount);
  });
  var y = num(m.yieldQty);
  return {batch:batch, unit:y > 0 ? batch / y : null, missing:missing};
}
function lineCost(it){
  if (it.modId){
    var m = MOD.get(it.modId);
    if (!m) return {cost:null, missing:['已删除的模块']};
    var mc = modCost(m);
    return {cost:mc.unit == null ? null : mc.unit * num(it.amount), missing:mc.unit == null ? [m.name + '（产出数量没填）'] : mc.missing};
  }
  var ing = ING.get(it.ingId), up = unitPrice(ing);
  if (up == null) return {cost:null, missing:[ing ? (ing.name || '未命名原料') : '已删除的原料']};
  return {cost:up * num(it.amount), missing:[]};
}
function modUsage(modId){
  var out = []; REC.forEach(function(r, id){ if ((r.items || []).some(function(it){ return it.modId === modId; })) out.push([id, r]); });
  return out;
}
function stepsHtml(steps){
  if (!steps || !steps.length) return '<p class="muted small">还没有写步骤。</p>';
  return '<ol class="steps">' + steps.map(function(s){
    var chips = '';
    if (s.temp) chips += '<span class="chip">' + esc(s.temp) + '°C</span>';
    if (s.time) chips += '<span class="chip">' + esc(s.time) + ' 分钟</span>';
    return '<li><div>' + esc(s.text || '') + (chips ? '<div class="chips">' + chips + '</div>' : '') + '</div></li>';
  }).join('') + '</ol>';
}
function sortedModules(){
  return Array.from(MOD.entries()).sort(function(a, b){ return String(a[1].name || '').localeCompare(String(b[1].name || ''), 'zh'); });
}

function meter(margin){
  var t = PLAN.targetMargin, low = margin != null && margin < t;
  var w = margin == null ? 0 : Math.max(0, Math.min(1, margin)) * 100;
  return '<div class="meter' + (low ? ' low' : '') + '" role="img" aria-label="毛利率 ' + pct(margin) + '，目标 ' + pct(t) + '">' +
    '<i style="width:' + w + '%"></i><b style="left:calc(' + (t*100) + '% - 1px)"></b></div>' +
    '<span class="pct' + (low ? ' low' : '') + '">' + pct(margin) + '</span>';
}

/* ---------- render ---------- */
function isEditing(){
  var a = document.activeElement;
  return a && document.getElementById('app').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
}
function scheduleRender(fromSnapshot){
  if (fromSnapshot && isEditing()){ pendingRender = true; return; }
  render();
}
document.addEventListener('focusout', function(){
  setTimeout(function(){ if (pendingRender && !isEditing()){ pendingRender = false; render(); } }, 0);
});

function render(){
  document.querySelectorAll('nav.tabs button').forEach(function(b){
    if (b.dataset.tab === GROUPS[view.tab]) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  var app = document.getElementById('app');
  var html = banner ? '<div class="banner">' + esc(banner) + '</div>' : '';
  if (mode === 'loading' || (mode === 'db' && !(loaded.ing && loaded.rec && loaded.plan && loaded.ord && loaded.cus && loaded.mod))){
    app.innerHTML = html + '<p class="muted" style="margin-top:24px">正在读取你的数据…</p>';
    return;
  }
  var listPage = (view.tab === 'recipes' && !view.recipeId) || (view.tab === 'orders' && !view.orderId) ||
    (view.tab === 'customers' && !view.custId) || (view.tab === 'modules' && !view.modId) || view.tab === 'ingredients' || view.tab === 'week';
  app.className = 'wrap' + (listPage ? ' segp' : '');
  if (listPage && view.tab !== 'week') html += subSegHtml();
  lastSub[GROUPS[view.tab]] = view.tab; store('tab', view.tab); if (SUBS[GROUPS[view.tab]]) store('sub.' + GROUPS[view.tab], view.tab);
  if (view.tab === 'recipes') html += view.recipeId ? (view.editing ? renderEdit() : renderDetail()) : renderList();
  else if (view.tab === 'orders') html += view.orderId ? renderOrderEdit() : renderOrders();
  else if (view.tab === 'customers') html += view.custId ? (view.editing ? renderCustEdit() : renderCustDetail()) : renderCustomers();
  else if (view.tab === 'modules') html += view.modId ? (view.editing ? renderModEdit() : renderModDetail()) : renderModules();
  else if (view.tab === 'ingredients') html += renderIngredients();
  else html += wview === 'prod' ? renderProd() : renderSales();
  app.innerHTML = html;
  if (view.tab === 'recipes' && view.recipeId && !view.editing) updateScale();
  if (view.tab === 'orders' && view.orderId) updateCustHint();
  if (view.tab === 'week' && wview === 'sales' && typeof showAiButton === 'function') showAiButton();
}

function renderList(){
  var list = sortedRecipes();
  var h = '<div class="head"><h1 class="page">配方</h1><button class="btn" data-action="new-recipe">新建配方</button></div>';
  if (!list.length){
    return h + '<div class="empty">还没有配方。点「新建配方」开始；也可以把配方截图发给 Claude，让它直接帮你填进来。</div>';
  }
  var groups = {};
  list.forEach(function(e){ var c = catOf(e[1].category).id; (groups[c] = groups[c] || []).push(e); });
  CATS.forEach(function(c){
    if (!groups[c.id]) return;
    h += '<section class="group"><h2>' + esc(c.name) + '</h2><ul class="rlist">';
    groups[c.id].forEach(function(e){
      var id = e[0], r = e[1], k = calc(r);
      h += '<li><button class="row" data-action="open" data-id="' + esc(id) + '">' +
        '<span><span class="rname display">' + esc(r.name || '未命名配方') + '</span><br>' +
        '<span class="rmeta">每批出 ' + esc(amt(num(r.yield),'个')) + ' ' + esc(r.unitLabel || '个') +
        (k.missing.length ? '，有 ' + k.missing.length + ' 项原料缺价格' : '') + '</span></span>' +
        '<span class="rnums"><strong>' + (launchActive(r) ? '<span class="tag" style="margin-right:4px">新品 ' + money(num(r.launchPrice)) + '</span>' : '') + money(k.price) + '</strong>成本 ' + money(k.unitCost) + '</span>' +
        '<span class="mrow">' + meter(k.margin) + '</span></button></li>';
    });
    h += '</ul></section>';
  });
  return h;
}

function renderDetail(){
  var r = REC.get(view.recipeId);
  if (!r){ view.recipeId = null; return renderList(); }
  var k = calc(r), u = r.unitLabel || '个';
  if (view.scale == null) view.scale = num(r.yield) || 1;
  var h = '<button class="link" data-action="back">全部配方</button>' +
    '<h1 class="title display">' + esc(r.name || '未命名配方') + '</h1>' +
    '<p class="muted small" style="margin:0">' + esc(catOf(r.category).name) + '，每批出 ' + esc(amt(num(r.yield),'个')) + ' ' + esc(u) + '</p>' +
    '<div class="econ">' +
      '<div><div class="lbl">单个成本</div><div class="val">' + money(k.unitCost) + '</div></div>' +
      '<div><div class="lbl">售价</div><div class="val">' + money(k.price) + '</div></div>' +
      '<div><div class="lbl">单个毛利</div><div class="val">' + money(k.gross) + '</div></div>' +
      '<div><div class="lbl">原料 / 包装 / 水电</div><div class="val small" style="font-size:15px;padding-top:6px">' +
        money(k.perIng) + ' / ' + money(num(r.packaging)) + ' / ' + money(num(r.utilities)) + '</div></div>' +
      '<div class="mrow"><span class="small muted">毛利率</span>' + meter(k.margin) + '</div>' +
    '</div>';
  if (k.blindEst){
    var be = k.blindEst;
    h += '<div class="warn"><strong>盲盒成本怎么算：</strong>' + (be.from === 'history'
      ? '按最近 ' + be.n + ' 个盲盒实际给的产品平均，约 ' + money(be.cost) + ' / 个。最常给：' + esc(be.top.join('、')) + '。'
      : be.from === 'category' ? '还没填过实际给的产品，暂按同分类产品的平均成本 ' + money(be.cost) + ' 估算。'
      : '还没有可参考的成本。') + '每张订单在「订单」里填上实际给了哪款，毛利就按那款的成本算。</div>';
  } else if (k.missing.length){
    h += '<div class="warn"><strong>成本不完整：</strong>' + esc(k.missing.join('、')) + ' 还没有价格，去「原料」页补上。</div>';
  } else if (k.margin != null && k.margin < PLAN.targetMargin){
    h += '<div class="warn"><strong>低于目标毛利率 ' + pct(PLAN.targetMargin) + '。</strong>要达标，售价至少要到 ' +
      money(k.unitCost / (1 - PLAN.targetMargin)) + '。</div>';
  }
  h += '<h2>用量</h2><div class="scale"><label for="scaleN">按产量换算：做</label>' +
    '<input id="scaleN" type="number" inputmode="decimal" min="0" step="1" value="' + esc(view.scale) + '">' +
    '<span>' + esc(u) + '</span><span class="muted small">（原配方每批 ' + esc(amt(num(r.yield),'个')) + ' ' + esc(u) + '）</span></div>' +
    '<div class="tscroll"><table><thead><tr><th>原料</th><th class="n">用量</th><th class="n">成本</th></tr></thead>' +
    '<tbody id="scaleBody"></tbody><tfoot><tr><td>原料合计</td><td></td><td class="n" id="scaleTotal"></td></tr></tfoot></table></div>';
  var parts = [], seenM = {};
  (r.items || []).forEach(function(it){ if (it.modId && !seenM[it.modId] && MOD.get(it.modId)){ seenM[it.modId] = 1; parts.push(it.modId); } });
  h += '<h2>步骤</h2>';
  if (!parts.length) h += stepsHtml(r.steps);
  else {
    parts.forEach(function(mid){
      var m = MOD.get(mid);
      h += '<h3 class="part">' + esc(m.name) + '<a data-action="m-open" data-id="' + esc(mid) + '">查看模块</a></h3>' + stepsHtml(m.steps);
    });
    h += '<h3 class="part">组装</h3>' + stepsHtml(r.steps);
  }
  if (r.notes) h += '<h2>备注</h2><div class="notes">' + esc(r.notes) + '</div>';
  h += '<div class="actions"><button class="btn" data-action="edit">编辑配方</button>' +
    '<button class="btn danger" data-action="delete-recipe">删除配方</button></div>';
  return h;
}

function updateScale(){
  var r = REC.get(view.recipeId), body = document.getElementById('scaleBody');
  if (!r || !body) return;
  var y = num(r.yield) || 1, f = num(view.scale) / y, total = 0, rows = '';
  (r.items || []).forEach(function(it){
    var a = num(it.amount) * f;
    if (it.modId){
      var m = MOD.get(it.modId);
      if (!m){ rows += '<tr><td>已删除的模块</td><td class="n">—</td><td class="n">—</td></tr>'; return; }
      var mc = modCost(m), share = num(m.yieldQty) > 0 ? a / num(m.yieldQty) : 0;
      var c = mc.unit == null ? null : mc.unit * a; if (c != null) total += c;
      rows += '<tr class="modrow"><td><a data-action="m-open" data-id="' + esc(it.modId) + '">' + esc(m.name) + '</a><span class="modtag">模块</span></td><td class="n">' +
        esc(amt(a, m.yieldUnit)) + ' ' + esc(m.yieldUnit || '') + '</td><td class="n">' + money(c) + '</td></tr>';
      (m.items || []).forEach(function(x){
        var ing = ING.get(x.ingId), up = unitPrice(ing), q = num(x.amount) * share;
        rows += '<tr class="sub"><td>' + esc(ing ? ing.name : '已删除的原料') + '</td><td class="n">' + esc(amt(q, ing ? ing.unit : 'g')) + ' ' +
          esc(ing ? ing.unit : '') + '</td><td class="n">' + money(up == null ? null : up * q) + '</td></tr>';
      });
      return;
    }
    var ing = ING.get(it.ingId), up = unitPrice(ing);
    var c2 = up == null ? null : up * a; if (c2 != null) total += c2;
    rows += '<tr><td>' + esc(ing ? ing.name : '已删除的原料') + '</td><td class="n">' + esc(amt(a, ing ? ing.unit : 'g')) + ' ' +
      esc(ing ? ing.unit : '') + '</td><td class="n">' + money(c2) + '</td></tr>';
  });
  if (!rows) rows = '<tr><td colspan="3" class="muted">还没有添加原料。</td></tr>';
  body.innerHTML = rows;
  document.getElementById('scaleTotal').textContent = money(total);
}

function renderEdit(){
  var d = view.draft, ings = sortedIngredients();
  var h = '<button class="link" data-action="cancel-edit">取消编辑</button>' +
    '<h1 class="page">' + (REC.has(view.recipeId) ? '编辑配方' : '新建配方') + '</h1>' +
    '<label class="f" style="margin-top:12px">配方名称<input data-d="name" value="' + esc(d.name) + '" placeholder="例如：芋泥麻薯吐司"></label>' +
    '<div class="grid2">' +
      '<label class="f">分类<select data-d="category">' + CATS.map(function(c){
        return '<option value="' + c.id + '"' + (d.category === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f">每批产出数量<input type="number" inputmode="decimal" min="0" data-d="yield" value="' + esc(d.yield) + '"></label>' +
      '<label class="f">计量单位<input data-d="unitLabel" value="' + esc(d.unitLabel) + '" placeholder="条 / 罐 / 杯 / 个"></label>' +
      '<label class="f">售价 ($ / 个)<input type="number" inputmode="decimal" min="0" step="0.01" data-d="price" value="' + esc(d.price) + '"></label>' +
      '<label class="f">包装 ($ / 个)<input type="number" inputmode="decimal" min="0" step="0.01" data-d="packaging" value="' + esc(d.packaging) + '"></label>' +
      '<label class="f">水电 ($ / 个)<input type="number" inputmode="decimal" min="0" step="0.01" data-d="utilities" value="' + esc(d.utilities) + '"></label>' +
      '<label class="f">新品价 ($ / 个)<input type="number" inputmode="decimal" min="0" step="0.01" data-d="launchPrice" value="' + esc(d.launchPrice == null ? '' : d.launchPrice) + '" placeholder="不是新品就留空"></label>' +
      '<label class="f">新品价截止（取货日期）<input type="date" data-d="launchUntil" value="' + esc(d.launchUntil || '') + '"></label>' +
      '<div class="f" style="display:flex;align-items:flex-end"><button type="button" class="btn ghost small" data-action="launch-week">设为本周新品</button></div>' +
    '</div><p class="muted small" style="margin:6px 0 0">取货日期在截止日之前（含当天）按新品价算，之后自动恢复上面的售价。</p><label class="blindchk"><input type="checkbox" data-blind' + (isBlind(d) ? ' checked' : '') + '>这是盲盒：下单后再填实际给了哪款，按实际产品算成本</label><h2>原料和模块（一批的用量）</h2>';
  var mods = sortedModules();
  if (!ings.length && !mods.length){
    h += '<p class="muted">原料库还是空的，先去「原料」页添加原料和价格。</p>';
  } else {
    d.items.forEach(function(it, i){
      var ing = ING.get(it.ingId), mm = it.modId ? MOD.get(it.modId) : null;
      h += '<div class="erow"><select data-item="' + i + '" data-k="ref" aria-label="原料或模块"><option value="">选择原料或模块</option>' +
        (mods.length ? '<optgroup label="模块">' + mods.map(function(e){ return '<option value="m:' + esc(e[0]) + '"' + (e[0] === it.modId ? ' selected' : '') + '>' + esc(e[1].name) + '</option>'; }).join('') + '</optgroup>' : '') +
        '<optgroup label="原料">' + ings.map(function(e){ return '<option value="i:' + esc(e[0]) + '"' + (!it.modId && e[0] === it.ingId ? ' selected' : '') + '>' + esc(e[1].name) + '</option>'; }).join('') + '</optgroup>' +
        '</select><input type="number" inputmode="decimal" min="0" data-item="' + i + '" data-k="amount" value="' + esc(it.amount) + '" aria-label="用量">' +
        '<span class="u">' + esc(mm ? (mm.yieldUnit || '') : ing ? ing.unit : '') + '</span>' +
        '<button class="x" data-action="rm-item" data-i="' + i + '" aria-label="移除这一项">×</button></div>';
    });
    h += '<button class="btn ghost small" data-action="add-item">添加原料或模块</button>' +
      (mods.length ? '' : '<p class="muted small">提示：把戚风、奶冻、奶油这类会重复用的部分做成「模块」，以后建配方直接选模块就行。</p>');
  }
  h += '<h2>步骤</h2>';
  d.steps.forEach(function(s, i){
    h += '<div class="srow"><textarea data-step="' + i + '" data-k="text" aria-label="第 ' + (i+1) + ' 步" placeholder="第 ' + (i+1) + ' 步">' + esc(s.text) + '</textarea>' +
      '<input type="number" inputmode="decimal" data-step="' + i + '" data-k="temp" value="' + esc(s.temp) + '" placeholder="°C" aria-label="温度">' +
      '<input type="number" inputmode="decimal" data-step="' + i + '" data-k="time" value="' + esc(s.time) + '" placeholder="分钟" aria-label="时间（分钟）">' +
      '<button class="x" data-action="rm-step" data-i="' + i + '" aria-label="移除这一步">×</button></div>';
  });
  h += '<button class="btn ghost small" data-action="add-step">添加步骤</button>' +
    '<h2>备注</h2><textarea data-d="notes" placeholder="保存方式、容易失败的地方、客人反馈……">' + esc(d.notes) + '</textarea>' +
    '<div class="actions"><button class="btn" data-action="save-recipe">保存配方</button>' +
    '<button class="btn ghost" data-action="cancel-edit">取消</button></div>';
  return h;
}

function renderIngredients(){
  var list = sortedIngredients();
  var h = '<div class="head"><h1 class="page">原料</h1><button class="btn" data-action="new-ing">添加原料</button></div>' +
    '<p class="muted small">改了进价，所有用到它的配方成本会自动更新。规格的单位要和配方里用的单位一致。</p>';
  if (!list.length) return h + '<div class="empty">还没有原料。点「添加原料」，填上购买价格和规格就行。</div>';
  h += '<div class="tscroll"><table class="itable"><thead><tr><th>原料</th><th class="n">购买价格 $</th><th class="n">规格</th><th>单位</th><th class="n">单价</th><th>备注</th><th class="n">用在</th><th></th></tr></thead><tbody>';
  list.forEach(function(e){
    var id = esc(e[0]), g = e[1], up = unitPrice(g), used = usage(e[0]);
    h += '<tr><td><input class="w-name" data-ing="' + id + '" data-k="name" value="' + esc(g.name) + '" aria-label="原料名称"></td>' +
      '<td><input class="w-num" type="number" inputmode="decimal" step="0.01" min="0" data-ing="' + id + '" data-k="price" value="' + esc(g.price) + '" aria-label="购买价格"></td>' +
      '<td><input class="w-num" type="number" inputmode="decimal" min="0" data-ing="' + id + '" data-k="qty" value="' + esc(g.qty) + '" aria-label="规格数量"></td>' +
      '<td><select class="w-unit" data-ing="' + id + '" data-k="unit" aria-label="单位">' + UNITS.map(function(u){
        return '<option' + (g.unit === u ? ' selected' : '') + '>' + u + '</option>'; }).join('') + '</select></td>' +
      '<td class="n">' + (up == null ? '—' : '$' + (up < 0.1 ? up.toFixed(4) : up.toFixed(2)) + '/' + esc(g.unit)) + '</td>' +
      '<td><input class="w-note" data-ing="' + id + '" data-k="note" value="' + esc(g.note) + '" aria-label="备注"></td>' +
      '<td class="n muted">' + (used ? used + ' 个配方' : '—') + '</td>' +
      '<td><button class="x" data-action="rm-ing" data-id="' + id + '" aria-label="删除 ' + esc(g.name) + '">×</button></td></tr>';
  });
  return h + '</tbody></table></div>';
}

function weekData(){
  var rows = [], shop = new Map(), revenue = 0, gross = 0, cost = 0;
  sortedRecipes().forEach(function(e){
    var id = e[0], r = e[1], q = num(PLAN.orders[id]), y = num(r.yield), k = calc(r);
    var batches = (q > 0 && y > 0) ? Math.ceil(q / y) : 0;
    rows.push({id:id, r:r, q:q, batches:batches, made:batches*y, k:k});
    if (q > 0){ revenue += q * k.price; if (k.gross != null) gross += q * k.gross; }
    if (batches){
      (r.items || []).forEach(function(it){
        var s = shop.get(it.ingId) || {need:0};
        s.need += num(it.amount) * batches; shop.set(it.ingId, s);
      });
    }
  });
  var shopRows = [];
  shop.forEach(function(s, ingId){
    var g = ING.get(ingId);
    var packs = (g && num(g.qty) > 0) ? Math.ceil(s.need / num(g.qty)) : null;
    var spend = packs == null ? null : packs * num(g.price);
    if (spend != null) cost += spend;
    shopRows.push({g:g, need:s.need, packs:packs, spend:spend});
  });
  shopRows.sort(function(a,b){ return String(a.g ? a.g.name : '').localeCompare(String(b.g ? b.g.name : ''), 'zh'); });
  var hours = HOURS.reduce(function(t, h){ return t + num(PLAN.hours[h[0]]); }, 0);
  return {rows:rows, shop:shopRows, revenue:revenue, gross:gross, cost:cost, hours:hours};
}

function renderWeek(){
  var w = weekData();
  var h = wsegHtml() + '<div class="head"><h1 class="page">本周生产</h1>' +
    (w.rows.some(function(x){ return x.q > 0; }) ? '<button class="btn ghost small" data-action="clear-orders">清空订单</button>' : '') + '</div>';
  if (!w.rows.length) return h + '<div class="empty">先在「配方」里建好配方，这里就能填每周订单，自动算采购清单和时薪。</div>';

  h += '<h2>订单</h2><div class="tscroll"><table class="wtable"><thead><tr><th>产品</th><th class="n">订单数</th><th class="n">批数</th><th class="n">实际出品</th><th class="n">多出</th></tr></thead><tbody>';
  w.rows.forEach(function(x){
    var u = esc(x.r.unitLabel || '个');
    h += '<tr><td>' + esc(x.r.name || '未命名配方') + '</td>' +
      '<td class="n"><input type="number" inputmode="numeric" min="0" step="1" data-order="' + esc(x.id) + '" value="' + (x.q || '') + '" placeholder="0" aria-label="' + esc(x.r.name) + ' 订单数"></td>' +
      '<td class="n">' + (x.batches || '—') + '</td><td class="n">' + (x.batches ? amt(x.made,'个') + ' ' + u : '—') + '</td>' +
      '<td class="n">' + (x.batches && x.made - x.q > 0 ? amt(x.made - x.q,'个') + ' ' + u : '—') + '</td></tr>';
  });
  h += '</tbody></table></div>';

  var active = w.rows.filter(function(x){ return x.batches > 0; });
  h += '<h2>采购清单</h2>';
  if (!w.shop.length) h += '<p class="muted">填了订单数，这里会按整批自动算出要买什么。</p>';
  else {
    h += '<p class="muted small">按整批计算，已经包含多出的量；没有扣掉家里现有的库存。</p>' +
      '<div class="tscroll"><table><thead><tr><th>原料</th><th class="n">共需</th><th class="n">包装规格</th><th class="n">要买</th><th class="n">花费</th></tr></thead><tbody>';
    w.shop.forEach(function(s){
      var g = s.g, u = g ? g.unit : '';
      h += '<tr><td>' + esc(g ? g.name : '已删除的原料') + '</td><td class="n">' + esc(amt(s.need,u)) + ' ' + esc(u) + '</td>' +
        '<td class="n">' + (g ? esc(amt(num(g.qty),u)) + ' ' + esc(u) : '—') + '</td>' +
        '<td class="n">' + (s.packs == null ? '—' : s.packs + ' 份') + '</td><td class="n">' + money(s.spend) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td>合计</td><td></td><td></td><td></td><td class="n">' + money(w.cost) + '</td></tr></tfoot></table></div>';
  }

  h += '<h2>生产顺序</h2>';
  if (!active.length) h += '<p class="muted">有订单后，这里会按先后顺序排好每样要做几批。</p>';
  else {
    CATS.forEach(function(c){
      var xs = active.filter(function(x){ return catOf(x.r.category).id === c.id; });
      if (!xs.length) return;
      h += '<h3>' + esc(c.name) + '</h3>' + (c.hint ? '<p class="muted small" style="margin:0">' + esc(c.hint) + '</p>' : '');
      xs.forEach(function(x){
        var temps = (x.r.steps || []).filter(function(s){ return s.temp; }).map(function(s){
          return s.temp + '°C' + (s.time ? ' ' + s.time + ' 分钟' : ''); });
        h += '<div class="order-step"><strong>' + esc(x.r.name) + '</strong>：' + x.batches + ' 批，出 ' + amt(x.made,'个') + ' ' + esc(x.r.unitLabel || '个') +
          (temps.length ? '<div class="chips">' + temps.map(function(t){ return '<span class="chip">' + esc(t) + '</span>'; }).join('') + '</div>' : '') + '</div>';
      });
    });
  }

  var wage = w.hours > 0 ? w.gross / w.hours : null, target = num(PLAN.targetWage), need = target * w.hours;
  h += '<h2>时薪测算</h2><div class="hours">' + HOURS.map(function(x){
    return '<label class="f">' + esc(x[1]) + '（小时）<input type="number" inputmode="decimal" min="0" step="0.5" data-hour="' + x[0] + '" value="' + esc(PLAN.hours[x[0]]) + '"></label>';
  }).join('') +
    '<label class="f">目标时薪 ($)<input type="number" inputmode="decimal" min="0" step="1" data-plan="targetWage" value="' + esc(PLAN.targetWage) + '"></label>' +
    '<label class="f">目标毛利率 (%)<input type="number" inputmode="decimal" min="0" max="100" step="1" data-plan="targetMargin" value="' + esc(Math.round(PLAN.targetMargin*1000)/10) + '"></label>' +
    '</div><div class="figs">' +
      '<div class="fig hero"><div class="lbl">实际时薪</div><div class="val">' + money(wage) + '</div></div>' +
      '<div class="fig"><div class="lbl">每周毛利</div><div class="val">' + money(w.gross) + '</div></div>' +
      '<div class="fig"><div class="lbl">营业额</div><div class="val">' + money(w.revenue) + '</div></div>' +
      '<div class="fig"><div class="lbl">总工时</div><div class="val">' + (Math.round(w.hours*10)/10) + ' 小时</div></div>' +
    '</div>';
  if (w.gross > 0 && w.hours > 0){
    h += w.gross >= need
      ? '<p class="verdict ok">已达到目标时薪 ' + money(target) + '，多出 ' + money(w.gross - need) + '。</p>'
      : '<p class="verdict low">离目标时薪 ' + money(target) + ' 还差 ' + money(need - w.gross) + ' 的毛利。</p>';
  }
  h += '<p class="muted small">毛利按订单数计算，多出的产品不算收入。没有计入设备折旧、手续费和损耗。</p>';
  return h;
}

/* ---------- confirm dialog (native confirm() is blocked in embedded frames) ---------- */
function ask(msg, okLabel){
  return new Promise(function(res){
    var back = document.createElement('div');
    back.className = 'dlg-back';
    back.innerHTML = '<div class="dlg" role="alertdialog" aria-modal="true"><p></p><div class="row2">' +
      '<button class="btn ghost" data-r="0">取消</button><button class="btn danger-fill" data-r="1"></button></div></div>';
    back.querySelector('p').textContent = msg;
    back.querySelector('[data-r="1"]').textContent = okLabel || '确定';
    var done = function(ok){ document.removeEventListener('keydown', onKey); back.remove(); res(ok); };
    var onKey = function(e){ if (e.key === 'Escape') done(false); };
    back.addEventListener('click', function(e){
      var b = e.target.closest('[data-r]');
      if (b) done(b.dataset.r === '1'); else if (e.target === back) done(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    back.querySelector('[data-r="1"]').focus();
  });
}

/* ---------- events ---------- */
document.querySelector('nav.tabs').addEventListener('click', function(e){
  var b = e.target.closest('button[data-tab]'); if (!b) return;
  var tab = lastSub[b.dataset.tab] || b.dataset.tab;
  var go = function(){ view = {tab:tab, recipeId:null, editing:false, draft:null, scale:null}; render(); window.scrollTo(0,0); };
  if (view.editing) ask('还没保存的改动会丢失，确定离开？', '离开').then(function(ok){ if (ok) go(); });
  else go();
});

var app = document.getElementById('app');
app.addEventListener('click', function(e){
  var b = e.target.closest('[data-action]'); if (!b) return;
  var a = b.dataset.action, d = view.draft;
  if (a === 'open'){ view.recipeId = b.dataset.id; view.scale = null; render(); window.scrollTo(0,0); }
  else if (a === 'back'){ view.recipeId = null; render(); }
  else if (a === 'new-recipe'){
    view.recipeId = newId(); view.editing = true;
    view.draft = {name:'', category:'bread', yield:'', unitLabel:'个', price:'', packaging:'', utilities:'', items:[{ingId:'',amount:''}], steps:[{text:'',temp:'',time:''}], notes:''};
    render(); window.scrollTo(0,0);
  }
  else if (a === 'edit'){
    var r = clone(REC.get(view.recipeId));
    r.items = r.items || []; r.steps = r.steps || [];
    ['name','category','yield','unitLabel','price','packaging','utilities','notes'].forEach(function(k){ if (r[k] == null) r[k] = ''; });
    view.draft = r; view.editing = true; render(); window.scrollTo(0,0);
  }
  else if (a === 'cancel-edit'){
    view.editing = false; view.draft = null;
    if (!REC.has(view.recipeId)) view.recipeId = null;
    render();
  }
  else if (a === 'add-item'){ d.items.push({ingId:'',amount:''}); render(); }
  else if (a === 'rm-item'){ d.items.splice(+b.dataset.i, 1); render(); }
  else if (a === 'add-step'){ d.steps.push({text:'',temp:'',time:''}); render(); }
  else if (a === 'rm-step'){ d.steps.splice(+b.dataset.i, 1); render(); }
  else if (a === 'save-recipe'){
    if (!String(d.name).trim()){ toast('先填配方名称。'); return; }
    if (!(num(d.yield) > 0)){ toast('每批产出数量要大于 0。'); return; }
    var out = {
      name:String(d.name).trim(), category:d.category, yield:num(d.yield), unitLabel:String(d.unitLabel||'个').trim() || '个',
      price:num(d.price), packaging:num(d.packaging), utilities:num(d.utilities), blind:isBlind(d), launchPrice:d.launchPrice === '' || d.launchPrice == null ? '' : num(d.launchPrice), launchUntil:d.launchPrice === '' || d.launchPrice == null ? '' : (d.launchUntil || ''),
      items:d.items.filter(function(it){ return it.ingId || it.modId; }).map(function(it){ return it.modId ? {modId:it.modId, amount:num(it.amount)} : {ingId:it.ingId, amount:num(it.amount)}; }),
      steps:d.steps.filter(function(s){ return String(s.text).trim() || s.temp || s.time; }).map(function(s){
        return {text:String(s.text).trim(), temp:s.temp === '' ? '' : num(s.temp), time:s.time === '' ? '' : num(s.time)}; }),
      notes:String(d.notes || '')
    };
    saveRecipe(view.recipeId, out);
    view.editing = false; view.draft = null; view.scale = null; render(); toast('配方已保存。');
  }
  else if (a === 'delete-recipe'){
    var rr = REC.get(view.recipeId);
    var rid = view.recipeId;
    ask('删除「' + (rr ? rr.name : '') + '」？删除后无法恢复。', '删除').then(function(ok){
      if (!ok) return;
      deleteRecipe(rid); view.recipeId = null; render(); toast('配方已删除。');
    });
  }
  else if (a === 'new-ing'){
    var id = newId();
    saveIngredient(id, {name:'新原料', price:0, qty:0, unit:'g', note:''});
    render();
    var el = app.querySelector('input[data-ing="' + id + '"][data-k="name"]');
    if (el){ el.focus(); el.select(); }
  }
  else if (a === 'rm-ing'){
    var gid = b.dataset.id, g = ING.get(gid), n = usage(gid);
    var msg = n ? '有 ' + n + ' 个配方用到「' + (g ? g.name : '') + '」，删除后这些配方会缺这项成本。确定删除？' : '删除「' + (g ? g.name : '') + '」？';
    ask(msg, '删除').then(function(ok){ if (ok){ deleteIngredient(gid); render(); } });
  }
  else if (a === 'clear-orders'){
    ask('清空本周所有订单数？', '清空').then(function(ok){ if (ok){ PLAN.orders = {}; savePlanNow(); render(); } });
  }
});

app.addEventListener('input', function(e){
  var t = e.target;
  if (t.id === 'scaleN'){ view.scale = t.value; updateScale(); return; }
  var d = view.draft;
  if (d && t.dataset.d){ d[t.dataset.d] = t.value; return; }
  if (d && t.dataset.item != null){ d.items[+t.dataset.item][t.dataset.k] = t.value; return; }
  if (d && t.dataset.step != null){ d.steps[+t.dataset.step][t.dataset.k] = t.value; return; }
});

app.addEventListener('change', function(e){
  var t = e.target, d = view.draft;
  if (d && t.dataset.item != null && t.dataset.k === 'ingId'){ d.items[+t.dataset.item].ingId = t.value; render(); return; }
  if (t.dataset.ing){
    var id = t.dataset.ing, g = clone(ING.get(id) || {});
    var k = t.dataset.k;
    g[k] = (k === 'price' || k === 'qty') ? num(t.value) : t.value;
    saveIngredient(id, g);
    setTimeout(function(){ if (!isEditing()) render(); else pendingRender = true; }, 0);
    return;
  }
  if (t.dataset.order){
    var v = Math.max(0, Math.round(num(t.value)));
    if (v) PLAN.orders[t.dataset.order] = v; else delete PLAN.orders[t.dataset.order];
    savePlan(); pendingRender = true;
    setTimeout(function(){ if (!isEditing()){ pendingRender = false; render(); } }, 0);
    return;
  }
  if (t.dataset.hour){ PLAN.hours[t.dataset.hour] = Math.max(0, num(t.value)); savePlan(); pendingRender = true;
    setTimeout(function(){ if (!isEditing()){ pendingRender = false; render(); } }, 0); return; }
  if (t.dataset.plan){
    if (t.dataset.plan === 'targetMargin') PLAN.targetMargin = Math.min(0.99, Math.max(0, num(t.value) / 100));
    else PLAN.targetWage = Math.max(0, num(t.value));
    savePlan(); pendingRender = true;
    setTimeout(function(){ if (!isEditing()){ pendingRender = false; render(); } }, 0);
  }
});

app.addEventListener('keydown', function(e){
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
});


/* ---------- customer orders ---------- */
var PLACES = ['Brooklyn', 'Midtown', '哥大'];
var WD = ['周日','周一','周二','周三','周四','周五','周六'];
function ymd(d){ return d.getFullYear() + '-' + ('0' + (d.getMonth()+1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function today(){ return ymd(new Date()); }
function addDays(s, n){ var p = s.split('-'); var d = new Date(+p[0], +p[1]-1, +p[2]); d.setDate(d.getDate() + n); return ymd(d); }
function dayLabel(s){
  if (!s) return '未定日期';
  var p = s.split('-'), d = new Date(+p[0], +p[1]-1, +p[2]);
  var rel = s === today() ? '今天' : s === addDays(today(), 1) ? '明天' : s === addDays(today(), -1) ? '昨天' : '';
  return (+p[1]) + '月' + (+p[2]) + '日 ' + WD[d.getDay()] + (rel ? '（' + rel + '）' : '');
}
/* ---------- promotions: 满 $40 / 满 $80 ---------- */
var PROMOS = [
  {id:'off5',   min:40, label:'95 折',                       short:'95折',    rate:0.05},
  {id:'gift40', min:40, label:'送 2 个原味蛋挞',              short:'送2蛋挞', gifts:[['plain', 2]]},
  {id:'off10',  min:80, label:'9 折',                        short:'9折',     rate:0.10},
  {id:'gift80', min:80, label:'送 2 个原味蛋挞 + 2 个芋泥蛋挞', short:'送4蛋挞', gifts:[['plain', 2], ['taro', 2]]}
];
function r2(v){ return Math.round(v * 100) / 100; }
function promoById(id){ for (var i = 0; i < PROMOS.length; i++) if (PROMOS[i].id === id) return PROMOS[i]; return null; }
function promoTier(sub){ return sub >= 80 ? 80 : sub >= 40 ? 40 : 0; }
/* 现在不做满额优惠了：新订单不再出现优惠选项；以前用过优惠的订单金额保持不变 */
function promoOptions(sub){ return []; }
function validPromo(id, sub){ return promoOptions(sub).some(function(x){ return x.id === id; }) ? id : ''; }
function tartRecipe(kind){
  var exact = kind === 'taro' ? '芋泥蛋挞' : '原味蛋挞', hit = null, loose = null;
  REC.forEach(function(r, id){
    var n = String(r.name || '');
    if (n === exact) hit = id;
    else if (!loose && n.indexOf('挞') >= 0 && (kind === 'taro' ? n.indexOf('芋泥') >= 0 : !/芋泥|抹茶|开心果|巧克力|榴莲|葡挞/.test(n))) loose = id;
  });
  return hit || loose;
}
function giftsFor(id){
  var pr = promoById(id); if (!pr || !pr.gifts) return [];
  return pr.gifts.map(function(g){
    var rid = tartRecipe(g[0]), qty = g[1];
    // 如果蛋挞按盒卖（计量单位写成"盒（2个）"），送的个数换算成盒数
    var per = rid ? String(REC.get(rid).unitLabel || '').match(/(\d+)\s*个/) : null;
    if (per && +per[1] > 1) qty = Math.round(g[1] / +per[1] * 100) / 100;
    return {recipeId:rid || '', name:rid ? REC.get(rid).name : (g[0] === 'taro' ? '芋泥蛋挞' : '原味蛋挞'), qty:qty};
  });
}
function giftItems(o){ return (o.gifts || []).map(function(g){ return {recipeId:g.recipeId, name:g.name, qty:g.qty, price:0, gift:true}; }); }
function orderSubtotal(o){ return (o.items || []).reduce(function(t, it){ return t + num(it.qty) * num(it.price); }, 0); }
function orderDiscount(o){ var pr = promoById(o.promo); return pr && pr.rate ? r2(orderSubtotal(o) * pr.rate) : 0; }
function orderTotal(o){ return r2(orderSubtotal(o) - orderDiscount(o)); }
function promoHtml(d, sub){
  var opts = promoOptions(sub), cur = validPromo(d.promo, sub), pr = promoById(cur);
  var disc = pr && pr.rate ? r2(sub * pr.rate) : 0;
  var h = '<div class="promo"><div class="prow"><span>小计</span><span>' + money(sub) + '</span></div>';
  if (opts.length){
    h += '<div class="small muted" style="margin-top:6px">满 $' + opts[0].min + ' 优惠，选一个：</div><div class="tchips">' +
      opts.map(function(x){ return '<button type="button" data-action="o-promo" data-v="' + x.id + '" aria-pressed="' + (cur === x.id) + '">' +
        x.label + (x.rate ? '（-' + money(r2(sub * x.rate)) + '）' : '') + '</button>'; }).join('') +
      '<button type="button" data-action="o-promo" data-v="" aria-pressed="' + (cur === '') + '">不用优惠</button></div>';
  }
  if (pr && pr.gifts){
    var gs = giftsFor(cur), miss = gs.filter(function(g){ return !g.recipeId; });
    h += '<div class="gift">赠品：' + esc(gs.map(function(g){ return g.name + ' × ' + g.qty; }).join('，')) + '，会自动算进本周生产。' +
      (miss.length ? '<br><span class="muted">还没有「' + esc(miss.map(function(g){ return g.name; }).join('」「')) + '」配方，建好后赠品成本才会算进毛利。</span>' : '') + '</div>';
  }
  if (disc) h += '<div class="prow"><span>优惠</span><span>-' + money(disc) + '</span></div>';
  h += '<div class="prow pay"><strong>应付</strong><strong>' + money(sub - disc) + '</strong></div></div>';
  return h;
}
function promoTag(o){ var pr = promoById(o.promo); return pr ? '<span class="tag">' + pr.short + '</span>' : ''; }
app.addEventListener('click', function(e){
  var b = e.target.closest('[data-action="o-promo"]'); if (!b || !view.draft) return;
  view.draft.promo = b.dataset.v; render();
});
function orderItemsText(o){
  return (o.items || []).map(function(it){
    var r = REC.get(it.recipeId), s = (r ? r.name : (it.name || '已删除的产品')) + ' × ' + num(it.qty);
    if (isBlind(r)){
      var got = {}, pend = 0;
      for (var j = 0; j < num(it.qty); j++){ var a = (it.actual || [])[j], ar = a ? REC.get(a) : null; if (ar) got[ar.name] = (got[ar.name] || 0) + 1; else pend++; }
      var parts = Object.keys(got).map(function(k){ return k + '×' + got[k]; });
      if (parts.length) s += '（实际：' + parts.join('、') + (pend ? '，待定 ' + pend : '') + '）';
    }
    return s;
  }).join('，') + ((o.gifts || []).length ? '（送 ' + o.gifts.map(function(g){ return g.name + ' × ' + num(g.qty); }).join('，') + '）' : '') || '还没填产品';
}
function sortedOrders(){
  return Array.from(ORD.entries()).sort(function(a, b){
    var x = (a[1].date || '9999') + tkey(a[1].time), y = (b[1].date || '9999') + tkey(b[1].time);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

function renderOrders(){
  var all = sortedOrders(), t = today();
  var open = all.filter(function(e){ return !e[1].picked; });
  var todayN = open.filter(function(e){ return e[1].date === t; }).length;
  var unpaid = all.filter(function(e){ return !e[1].paid; }).reduce(function(s, e){ return s + orderTotal(e[1]); }, 0);
  var h = '<div class="head"><h1 class="page">订单</h1><button class="btn" data-action="new-order">新建订单</button></div>';
  h += '<div class="osum">' +
    '<div class="fig"><div class="lbl">今天取货</div><div class="val">' + todayN + ' 单</div></div>' +
    '<div class="fig"><div class="lbl">待取货</div><div class="val">' + open.length + ' 单</div></div>' +
    '<div class="fig"><div class="lbl">未收款</div><div class="val">' + money(unpaid) + '</div></div></div>';
  h += waitingBanner(prodData(), 'orders');
  h += '<div class="ofilter" role="group" aria-label="筛选">' +
    [['open','待取货'],['done','已取货'],['all','全部']].map(function(f){
      return '<button data-action="ofilter" data-f="' + f[0] + '" aria-pressed="' + (ofilter === f[0]) + '">' + f[1] + '</button>';
    }).join('') + '</div>';
  var list = all.filter(function(e){ return ofilter === 'all' ? true : ofilter === 'done' ? e[1].picked : !e[1].picked; });
  if (ofilter === 'done') list.reverse();
  if (!list.length){
    return h + '<div class="empty">' + (ORD.size ? '这里没有订单。' : '还没有订单。客人下单后点「新建订单」，记下是谁、要什么、几号几点在哪里取。') + '</div>';
  }
  var groups = [], cur = null;
  list.forEach(function(e){
    var d = e[1].date || '';
    if (!cur || cur.d !== d){ cur = {d:d, xs:[]}; groups.push(cur); }
    cur.xs.push(e);
  });
  groups.forEach(function(g){
    var notPicked = g.xs.filter(function(e){ return !e[1].picked; }).length;
    var past = g.d && g.d < t && notPicked > 0;
    var cnt = g.xs.length, sum = g.xs.reduce(function(s, e){ return s + orderTotal(e[1]); }, 0);
    h += '<section class="oday' + (past ? ' past' : '') + '"><h2>' + esc(dayLabel(g.d)) + (past ? '，' + (notPicked === g.xs.length ? '还没取' : '有 ' + notPicked + ' 单还没取') : '') +
      '<span>' + cnt + ' 单，' + money(sum) + '</span></h2>';
    g.xs.forEach(function(e){
      var id = e[0], o = e[1];
      h += '<div class="ocard' + (o.picked ? ' done' : '') + '">' +
        '<div class="top"><span class="who">' + (custIdFor(o) ? '<a class="who" data-action="c-open" data-id="' + esc(custIdFor(o)) + '">' + esc(o.customer) + '</a>' + segTag(custIdFor(o)) : esc(o.customer || '未填名字')) + '</span>' +
        '<span class="when">' + esc([o.time, o.place].filter(Boolean).join('，') || '时间地点未定') + '</span></div>' +
        '<div class="items">' + esc(orderItemsText(o)) + '</div>' + webLine(o) +
        (blindPending(o) ? '<div class="pend">盲盒还有 ' + blindPending(o) + ' 个没填实际给的<button data-action="o-edit" data-id="' + esc(id) + '">去填</button></div>' : '') +
        (o.contact ? '<div class="small muted" style="margin:-4px 0 8px">' + esc(o.contact) + '</div>' : '') +
        (o.notes ? '<div class="small muted" style="margin:-4px 0 8px">' + esc(o.notes) + '</div>' : '') +
        '<div class="bot"><span class="amt">' + money(orderTotal(o)) + ' ' + promoTag(o) + '</span>' +
        (o.paid ? '<span class="tag ok">已付款</span>' : '<button class="btn ghost small" data-action="o-paid" data-id="' + esc(id) + '">标记已付款</button>') +
        (o.picked ? '<button class="btn ghost small" data-action="o-unpick" data-id="' + esc(id) + '">改回待取</button>'
                  : '<button class="btn small" data-action="o-pick" data-id="' + esc(id) + '">已取货</button>') +
        '<button class="link" data-action="o-edit" data-id="' + esc(id) + '" style="margin-left:6px">编辑</button>' +
        '</div></div>';
    });
    h += '</section>';
  });
  return h;
}

function renderOrderEdit(){
  var d = view.draft, recs = sortedRecipes(), isNew = !ORD.has(view.orderId);
  var h = '<button class="link" data-action="o-cancel">返回订单</button>' +
    '<h1 class="page">' + (isNew ? '新建订单' : '编辑订单') + '</h1>' +
    '<div class="grid2">' +
      '<label class="f">客人名字<input data-od="customer" list="custList" autocomplete="off" value="' + esc(d.customer) + '" placeholder="输入名字，老客会自动带出"></label>' +
      '<label class="f">联系方式<input data-od="contact" value="' + esc(d.contact) + '" placeholder="微信 / 电话"></label>' +
      '<label class="f">取货地点<input data-od="place" list="placeList" value="' + esc(d.place) + '" placeholder="Brooklyn / Midtown / 哥大"></label>' +
      '<label class="f">取货日期<input type="date" data-od="date" value="' + esc(d.date) + '"></label>' +
      timeFieldHtml(d) +
    '</div><div class="hint" id="custHint"></div><datalist id="custList">' + Array.from(CUS.values()).map(function(c){ return '<option value="' + esc(c.name) + '">'; }).join('') + '</datalist><datalist id="placeList">' + PLACES.map(function(p){ return '<option value="' + esc(p) + '">'; }).join('') + '</datalist>' +
    '<h2>要什么</h2>';
  if (!recs.length) h += '<p class="muted">还没有配方，先去「配方」页建好产品。</p>';
  else {
    d.items.forEach(function(it, i){
      h += '<div class="orow"><select data-oi="' + i + '" data-k="recipeId" aria-label="产品"><option value="">选择产品</option>' +
        recs.map(function(e){ return '<option value="' + esc(e[0]) + '"' + (e[0] === it.recipeId ? ' selected' : '') + '>' +
          esc(e[1].name) + '（' + money(priceFor(e[1], d.date)) + (launchActive(e[1], d.date) ? ' 新品价' : '') + '）</option>'; }).join('') +
        (it.recipeId && !REC.has(it.recipeId) ? '<option value="' + esc(it.recipeId) + '" selected>' + esc(it.name || '已删除的产品') + '</option>' : '') +
        '</select><input type="number" inputmode="numeric" min="1" step="1" data-oi="' + i + '" data-k="qty" value="' + esc(it.qty) + '" aria-label="数量">' +
        '<button class="x" data-action="o-rm-item" data-i="' + i + '" aria-label="移除这项">×</button></div>';
      var br = REC.get(it.recipeId);
      if (isBlind(br)){
        var n = Math.max(0, Math.round(num(it.qty))), act = it.actual || [], opts = recs.filter(function(e){ return !isBlind(e[1]) && e[1].category === br.category; });
        if (!opts.length) opts = recs.filter(function(e){ return !isBlind(e[1]); });
        h += '<div class="oact"><div class="lbl">实际给的（取货前填，按实际产品算成本）</div>';
        for (var j = 0; j < n; j++){
          h += '<select data-oa="' + i + '" data-j="' + j + '" aria-label="第 ' + (j + 1) + ' 个盲盒实际给的"><option value="">第 ' + (j + 1) + ' 个：待定</option>' +
            opts.map(function(e){ return '<option value="' + esc(e[0]) + '"' + (act[j] === e[0] ? ' selected' : '') + '>' + esc(e[1].name) + '（成本 ' + money(calc(e[1]).unitCost) + '）</option>'; }).join('') + '</select>';
        }
        h += '</div>';
      }
    });
    h += '<button class="btn ghost small" data-action="o-add-item">再加一样</button>';
  }
  var total = d.items.reduce(function(t, it){
    var r = REC.get(it.recipeId); return t + num(it.qty) * (r ? priceFor(r, d.date) : num(it.price));
  }, 0);
  h += promoHtml(d, total) +
    '<div class="checks"><label><input type="checkbox" data-od="paid"' + (d.paid ? ' checked' : '') + '>已付款</label>' +
    '<label><input type="checkbox" data-od="picked"' + (d.picked ? ' checked' : '') + '>已取货</label></div>' +
    '<h2>备注</h2><textarea data-od="notes" placeholder="少糖、写字、过敏……">' + esc(d.notes) + '</textarea>' +
    '<div class="actions"><button class="btn" data-action="o-save">保存订单</button>' +
    '<button class="btn ghost" data-action="o-cancel">取消</button>' +
    (isNew ? '' : '<button class="btn danger" data-action="o-delete">删除订单</button>') + '</div>';
  return h;
}

function openOrder(id){
  var o = ORD.get(id);
  view.orderId = id; view.editing = true;
  view.draft = o ? clone(o) : {customer:'', contact:'', place:'', date:'', time:'', items:[{recipeId:'', qty:1}], paid:false, picked:false, notes:''};
  ['customer','contact','place','date','time','notes'].forEach(function(k){ if (view.draft[k] == null) view.draft[k] = ''; });
  view.draft.items = view.draft.items || [];
  render(); window.scrollTo(0,0);
}
function closeOrder(){ view.orderId = null; view.editing = false; view.draft = null; render(); window.scrollTo(0,0); }
function setOrderFlag(id, k, v){ var o = ORD.get(id); if (!o) return; o = clone(o); o[k] = v; saveOrder(id, o); render(); }

app.addEventListener('click', function(e){
  var b = e.target.closest('[data-action]'); if (!b) return;
  var a = b.dataset.action, d = view.draft;
  if (a === 'new-order') openOrder('o' + Date.now().toString(36) + Math.random().toString(36).slice(2,6));
  else if (a === 'o-edit') openOrder(b.dataset.id);
  else if (a === 'o-cancel') closeOrder();
  else if (a === 'ofilter'){ ofilter = b.dataset.f; render(); }
  else if (a === 'o-paid') setOrderFlag(b.dataset.id, 'paid', true);
  else if (a === 'o-pick'){ setOrderFlag(b.dataset.id, 'picked', true); toast('已标记取货。'); }
  else if (a === 'o-unpick') setOrderFlag(b.dataset.id, 'picked', false);
  else if (a === 'o-add-item'){ d.items.push({recipeId:'', qty:1}); render(); }
  else if (a === 'o-rm-item'){ d.items.splice(+b.dataset.i, 1); render(); }
  else if (a === 'o-save'){
    if (!String(d.customer).trim()){ toast('先填客人名字。'); return; }
    var items = d.items.filter(function(it){ return it.recipeId && num(it.qty) > 0; }).map(function(it){
      var r = REC.get(it.recipeId);
      var line = {recipeId:it.recipeId, name:r ? r.name : (it.name || ''), qty:Math.round(num(it.qty)), price:r ? priceFor(r, d.date) : num(it.price)};
      if (isBlind(r)){ var a = (it.actual || []).slice(0, line.qty); while (a.length < line.qty) a.push(''); line.actual = a; }
      return line;
    });
    if (!items.length){ toast('至少选一样产品。'); return; }
    var cid = ensureCustomer(d);
    saveOrder(view.orderId, {
      customerId:cid,
      customer:String(d.customer).trim(), contact:String(d.contact || '').trim(), place:String(d.place || '').trim(),
      date:d.date || '', time:d.time || '', items:items, promo:validPromo(d.promo, orderSubtotal({items:items})),
      gifts:giftsFor(validPromo(d.promo, orderSubtotal({items:items}))), paid:!!d.paid, picked:!!d.picked, notes:String(d.notes || ''),
      created:(ORD.get(view.orderId) || {}).created || Date.now()
    });
    closeOrder(); toast('订单已保存。');
  }
  else if (a === 'o-delete'){
    var oid = view.orderId;
    ask('删除「' + (d.customer || '') + '」的这个订单？删除后无法恢复。', '删除').then(function(ok){
      if (ok){ deleteOrder(oid); closeOrder(); toast('订单已删除。'); }
    });
  }
  else if (a === 'orders-to-week'){
    var t = today(), end = addDays(t, 6), sums = {}, n = 0;
    ORD.forEach(function(o){
      if (o.picked || !o.date || o.date < t || o.date > end) return;
      n++;
      (o.items || []).forEach(function(it){ if (REC.has(it.recipeId)) sums[it.recipeId] = (sums[it.recipeId] || 0) + num(it.qty); });
    });
    if (!n){ toast('接下来 7 天没有待取货的订单。'); return; }
    ask('用接下来 7 天的 ' + n + ' 个订单，替换「本周」现在填的订单数？', '替换').then(function(ok){
      if (!ok) return;
      PLAN.orders = sums; savePlanNow();
      wview = 'prod'; view = {tab:'week', recipeId:null, editing:false, draft:null, scale:null}; render(); window.scrollTo(0,0);
      toast('已汇总到本周。');
    });
  }
});
app.addEventListener('input', function(e){
  var t = e.target, d = view.draft;
  if (!d || view.tab !== 'orders') return;
  if (t.dataset.od){ d[t.dataset.od] = t.type === 'checkbox' ? t.checked : t.value; if (t.dataset.od === 'customer') updateCustHint(); }
  else if (t.dataset.oi != null) d.items[+t.dataset.oi][t.dataset.k] = t.value;
});
app.addEventListener('change', function(e){
  var t = e.target;
  if (view.tab === 'orders' && view.draft && t.dataset.oi != null) setTimeout(render, 0);
});


/* pickup time: 上午 / 下午 / 晚上 or an exact time */
var SLOTS = ['上午', '下午', '晚上'];
function tkey(t){ return t === '上午' ? '09:00~' : t === '下午' ? '14:00~' : t === '晚上' ? '19:00~' : (t || '99'); }
function timeMode(d){ return d.timeMode || (SLOTS.indexOf(d.time) >= 0 ? d.time : d.time ? 'exact' : ''); }
function timeFieldHtml(d){
  var m = timeMode(d);
  return '<div class="f"><span id="tlbl">取货时间</span><div class="tchips" role="group" aria-labelledby="tlbl">' +
    SLOTS.concat(['exact']).map(function(v){
      return '<button type="button" data-action="o-tmode" data-v="' + v + '" aria-pressed="' + (m === v) + '">' + (v === 'exact' ? '几点' : v) + '</button>'; }).join('') +
    '</div>' + (m === 'exact' ? '<input type="time" data-od="time" aria-label="具体时间" value="' + esc(SLOTS.indexOf(d.time) >= 0 ? '' : d.time) + '">' : '') + '</div>';
}
app.addEventListener('click', function(e){
  var b = e.target.closest('[data-action="o-tmode"]'); if (!b || !view.draft) return;
  var d = view.draft, v = b.dataset.v, cur = timeMode(d);
  if (cur === v){ d.timeMode = ''; d.time = ''; }
  else if (v === 'exact'){ d.timeMode = 'exact'; if (SLOTS.indexOf(d.time) >= 0) d.time = ''; }
  else { d.timeMode = v; d.time = v; }
  render();
  if (v === 'exact' && cur !== v){ var el = document.querySelector('[data-od="time"]'); if (el) el.focus(); }
});

/* ---------- this week's production (synced from orders) ---------- */
function placeKey(o){ return String(o.place || '').trim() || '没填地点'; }
function hasPflt(){ return Object.keys(pflt.place).length > 0 || Object.keys(pflt.date).length > 0; }
function prodData(flt, off){
  var ws = addDays(weekStart(today()), 7 * (off || 0)), we = addDays(ws, 6), rows = {}, total = 0, open = 0, sales = 0, cost = 0, costKnown = true, n = 0, disc = 0;
  var fp = flt && Object.keys(flt.place).length ? flt.place : null, fd = flt && Object.keys(flt.date).length ? flt.date : null;
  ORD.forEach(function(o){
    if (!o.date || o.date < ws || o.date > we) return;
    if (fp && !fp[placeKey(o)]) return;
    if (fd && !fd[o.date]) return;
    n++;
    disc += orderDiscount(o);
    (o.items || []).concat(giftItems(o)).forEach(function(it){
      var r = REC.get(it.recipeId), nm = r ? r.name : (it.name || '已删除的产品'), q = num(it.qty);
      var mk = function(nm2, r2_){ return rows[nm2] || (rows[nm2] = {name:nm2, unit:r2_ ? (r2_.unitLabel || '个') : '个', qty:0, blindQty:0, blindOpen:0, pending:0, blind:isBlind(r2_), open:0, rev:0, cost:0, noCost:false, cat:r2_ ? catIndex(r2_.category) : 99}); };
      var x = mk(nm, r);
      x.qty += q; if (!o.picked){ x.open += q; open += q; } x.rev += q * num(it.price);
      sales += q * num(it.price);
      var lc = lineCostTotal(it);
      if (lc.total == null){ costKnown = false; x.noCost = true; } else { cost += lc.total; x.cost += lc.total; if (lc.zero) x.noCost = true; }
      if (x.blind && !it.gift){
        x.pending += lc.pending;
        (it.actual || []).slice(0, q).forEach(function(aid){ var ar = aid ? REC.get(aid) : null; if (ar){ var br = mk(ar.name, ar); br.blindQty += 1; if (!o.picked) br.blindOpen += 1; } });
      }
    });
  });
  sales = r2(sales - disc);
  Object.keys(rows).forEach(function(k){ var x = rows[k]; x.make = x.blind ? x.pending : x.qty + x.blindQty; total += x.make; });
  var madeW = {};
  Object.keys(PLAN.made || {}).forEach(function(k){ if (k >= ws && k <= we) Object.assign(madeW, PLAN.made[k]); });
  Object.assign(madeW, (PLAN.made || {})[ws] || {});
  Object.keys(rows).forEach(function(k){ var x = rows[k];
    x.madeRaw = x.blind ? 0 : Math.max(0, Math.round(num(madeW[k])));
    x.made = Math.min(x.madeRaw, x.make);
    /* 先取走的算先做好的：做好了但还没被取走的数量 */
    x.waiting = x.blind ? 0 : Math.max(0, x.made - (x.make - (x.open + x.blindOpen)));
  });
  var list = Object.keys(rows).map(function(k){ return rows[k]; }).sort(function(a, b){ return a.cat - b.cat || b.qty - a.qty; });
  return {ws:ws, we:we, list:list, total:total, open:open, sales:sales, cost:cost, costKnown:costKnown, n:n, disc:disc};
}
function waitingBanner(P, where){
  var w = P.list.filter(function(x){ return x.waiting > 0; });
  if (!w.length) return '';
  return '<div class="banner madeban"><strong>做好了还没取：</strong>' + esc(w.map(function(x){ return x.name + ' ' + x.waiting + ' ' + x.unit; }).join('、')) +
    '。记得提醒客人来取' + (where === 'orders' ? '' : '，取走后在「订单」里点「已取货」') + '。</div>';
}
function pfltHtml(ws, we){
  var places = {}, dates = {};
  ORD.forEach(function(o){ if (!o.date || o.date < ws || o.date > we) return; places[placeKey(o)] = (places[placeKey(o)] || 0) + 1; dates[o.date] = (dates[o.date] || 0) + 1; });
  // 已经不存在的筛选项自动去掉
  Object.keys(pflt.place).forEach(function(k){ if (!places[k]) delete pflt.place[k]; });
  Object.keys(pflt.date).forEach(function(k){ if (!dates[k]) delete pflt.date[k]; });
  var pk = Object.keys(places).sort(function(a, b){ return places[b] - places[a]; }), dk = Object.keys(dates).sort();
  if (pk.length < 2 && dk.length < 2) return '';
  var WDS = ['周日','周一','周二','周三','周四','周五','周六'];
  var chip = function(g, v, label, cnt){ return '<button type="button" data-action="pf" data-g="' + g + '" data-v="' + esc(v) + '" aria-pressed="' + !!pflt[g][v] + '">' + esc(label) + ' <small>' + cnt + ' 单</small></button>'; };
  var h = '<div class="pflt">';
  if (pk.length > 1) h += '<div class="pfrow"><span class="pfl">地点</span><div class="tchips">' + pk.map(function(k){ return chip('place', k, k, places[k]); }).join('') + '</div></div>';
  if (dk.length > 1) h += '<div class="pfrow"><span class="pfl">取货日</span><div class="tchips">' + dk.map(function(k){
    var q = k.split('-'), d = new Date(+q[0], +q[1]-1, +q[2]); return chip('date', k, md(k) + ' ' + WDS[d.getDay()], dates[k]); }).join('') + '</div></div>';
  if (hasPflt()) h += '<button class="link" data-action="pf-clear">清除筛选，看全部</button>';
  return h + '</div>';
}
app.addEventListener('click', function(e){
  var b = e.target.closest('[data-action="pf"],[data-action="pf-clear"]'); if (!b) return;
  if (b.dataset.action === 'pf-clear') pflt = {place:{}, date:{}};
  else { var g = pflt[b.dataset.g]; if (g[b.dataset.v]) delete g[b.dataset.v]; else g[b.dataset.v] = 1; }
  render();
});
function renderProd(){
  var P = prodData(null, pOff), ws = P.ws, we = P.we;
  var filtering = hasPflt(), F = filtering ? prodData(pflt, pOff) : P;
  var list = F.list, total = F.total, open = F.open, sales = F.sales, cost = F.cost, costKnown = F.costKnown, n = F.n, disc = F.disc;
  var h = wsegHtml() + '<div class="wnav"><button class="x" data-action="pwk" data-d="-1" aria-label="上一周">‹</button>' +
    '<span class="lbl">' + (pOff === 0 ? '本周生产' : pOff === 1 ? '下周生产' : pOff === -1 ? '上周生产' : md(ws) + ' 那周生产') +
    '<small>' + md(ws) + '（周三）– ' + md(we) + '（周二），按订单的取货日期统计</small></span>' +
    '<button class="x" data-action="pwk" data-d="1" aria-label="下一周">›</button>' +
    (pOff ? '<button class="link" data-action="pwk" data-d="0">回到本周</button>' : '') + '</div>';
  h += '<h2>这周要做什么</h2>' + waitingBanner(P, 'prod') + pfltHtml(ws, we);
  if (filtering) h += '<p class="muted small" style="margin:6px 0 0">只显示筛选出来的订单。「做好了」按整周记录，清除筛选后再填。</p>';
  if (!list.length && filtering) h += '<div class="empty">筛选条件下没有订单。</div>';
  else if (!list.length) h += '<div class="empty">这周还没有订单。在「订单」里记下客人的订单，这里会自动汇总每样要做多少。</div>';
  else {
    h += '<div class="tscroll"><table class="prodt"><thead><tr><th>产品</th><th class="n">要做</th><th class="n">做好了</th><th class="n">还没取</th><th class="n">销售额</th><th class="n">成本</th></tr></thead><tbody>' +
      list.map(function(x){
        var mkTxt = x.blind ? (x.pending ? '待定 ' + x.pending : '<span class="muted">已分配</span>') + '<br><small class="muted">卖出 ' + x.qty + '</small>'
          : (x.qty + x.blindQty) + ' ' + esc(x.unit) + (x.blindQty ? '<br><small class="muted">含盲盒 ' + x.blindQty + '</small>' : '');
        var mdTxt = filtering || x.blind || !x.make ? '<span class="muted">—</span>'
          : '<span class="mwrap"><input type="number" inputmode="numeric" min="0" step="1" class="minp' + (x.made >= x.make ? ' full' : '') + '" data-made="' + esc(x.name) + '" data-ws="' + ws + '" value="' + (x.madeRaw || '') + '" placeholder="0" aria-label="' + esc(x.name) + ' 做好了几个">' +
            '</span>';
        return '<tr' + (x.waiting && !filtering ? ' class="waitrow"' : '') + '><td>' + esc(x.name) + '' + '</td><td class="n">' + mkTxt + '</td><td class="n">' + mdTxt + '</td><td class="n">' +
        (x.open ? x.open + ' ' + esc(x.unit) : '<span class="muted">都取了</span>') + '</td><td class="n">' + money(x.rev) + '</td><td class="n"' +
        (x.noCost ? ' style="color:var(--rose)"' : '') + '>' + money(x.cost) + (x.noCost ? ' ⚠' : '') + '</td></tr>'; }).join('') +
      '</tbody><tfoot>' + (disc ? '<tr><td>满额折扣</td><td></td><td></td><td></td><td class="n">-' + money(disc) + '</td><td></td></tr>' : '') + '<tr><td>' + (filtering ? '筛选合计' : '合计') + '（' + n + ' 单）</td><td class="n">' + total + '</td><td class="n">' + (filtering ? '' : list.reduce(function(t, x){ return t + x.made; }, 0)) + '</td><td class="n">' + open + '</td><td class="n">' + money(sales) + '</td><td class="n">' + money(cost) + '</td></tr></tfoot></table></div>';
    var bad = list.filter(function(x){ return x.noCost; });
    if (bad.length) h += '<div class="warn"><strong>成本没算全：</strong>' + esc(bad.map(function(x){ return x.name; }).join('、')) +
      ' 的成本是 0 或缺价格，毛利和时薪会被算高。去「菜单」里给它们补上原料、模块或包装成本。</div>';
  }
  sales = P.sales; cost = P.cost; costKnown = P.costKnown;   /* 时薪按整周算，不受筛选影响 */
  var gross = sales - cost, hours = HOURS.reduce(function(t, x){ return t + num(PLAN.hours[x[0]]); }, 0);
  var wage = hours > 0 ? gross / hours : null, target = num(PLAN.targetWage), need = target * hours;
  var HLBL = {production:['生产','备料、制作、包装'], purchase:['采购',''], comms:['接单发帖','回消息、发帖'], pickup:['自提等人','两地跑'], cleaning:['清洁收尾',''], other:['其他','']};
  var hrow = function(label, sub, attr, val, unit, step){
    return '<label class="hrow"><span>' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span>' +
      '<input type="number" inputmode="decimal" min="0" step="' + step + '" ' + attr + ' value="' + esc(val) + '"><span class="u">' + unit + '</span></label>';
  };
  h += '<h2>时薪测算</h2><div class="hgrid"><div class="hsub">每周花的时间</div>' + HOURS.map(function(x){
    var l = HLBL[x[0]] || [x[1], '']; return hrow(l[0], l[1], 'data-hour="' + x[0] + '"', PLAN.hours[x[0]], '小时', '0.5');
  }).join('') + '<div class="hsub">目标</div>' +
    hrow('目标时薪', '', 'data-plan="targetWage"', PLAN.targetWage, '$/时', '1') +
    hrow('目标毛利率', '', 'data-plan="targetMargin"', Math.round(PLAN.targetMargin * 1000) / 10, '%', '1') +
    '</div><div class="figs">' +
      '<div class="fig hero"><div class="lbl">实际时薪</div><div class="val">' + money(wage) + '</div></div>' +
      '<div class="fig"><div class="lbl">销售额</div><div class="val">' + money(sales) + '</div></div>' +
      '<div class="fig"><div class="lbl">减：成本</div><div class="val">-' + money(cost) + '</div></div>' +
      '<div class="fig"><div class="lbl">= 毛利</div><div class="val">' + money(gross) + '</div></div>' +
      '<div class="fig"><div class="lbl">总工时</div><div class="val">' + (Math.round(hours * 10) / 10) + ' 小时</div></div></div>';
  if (gross > 0 && hours > 0){
    h += gross >= need ? '<p class="verdict ok">已达到目标时薪 ' + money(target) + '，多出 ' + money(gross - need) + '。</p>'
      : '<p class="verdict low">离目标时薪 ' + money(target) + ' 还差 ' + money(need - gross) + ' 的毛利。</p>';
  }
  h += '<p class="muted small">时薪 =（销售额 − 成本）÷ 总工时。成本包括原料、模块和包装，按配方现在的进价估算' + (costKnown ? '' : '，有产品缺成本没算进去') + '；没有计入设备折旧、手续费和损耗。</p>';
  return h;
}

/* ---------- customers ---------- */
function normName(s){ return String(s || '').trim().toLowerCase(); }
function findCustByName(name){
  var n = normName(name); if (!n) return null;
  var hit = null; CUS.forEach(function(c, id){ if (!hit && normName(c.name) === n) hit = id; });
  return hit;
}
function custIdFor(o){
  if (o.customerId && CUS.has(o.customerId)) return o.customerId;
  return findCustByName(o.customer);
}
function ensureCustomer(d){
  var id = (d.customerId && CUS.has(d.customerId) && normName(CUS.get(d.customerId).name) === normName(d.customer)) ? d.customerId : findCustByName(d.customer);
  if (id){
    var c = CUS.get(id), changed = false; c = clone(c);
    if (!c.contact && d.contact){ c.contact = String(d.contact).trim(); changed = true; }
    if (!c.place && d.place){ c.place = String(d.place).trim(); changed = true; }
    if (changed) saveCustomer(id, c);
    return id;
  }
  id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  saveCustomer(id, {name:String(d.customer).trim(), contact:String(d.contact || '').trim(), place:String(d.place || '').trim(),
    source:'', birthday:'', likes:'', avoid:'', notes:'', lastContacted:'', redeemed:0, created:today()});
  return id;
}
function daysBetween(a, b){
  var p = a.split('-'), q = b.split('-');
  return Math.round((new Date(+q[0], +q[1]-1, +q[2]) - new Date(+p[0], +p[1]-1, +p[2])) / 864e5);
}
function bdayIn(bd){
  var m = String(bd || '').match(/(\d{1,2})\D+(\d{1,2})/); if (!m) return null;
  var t = today(), y = +t.slice(0,4);
  var s = y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  var n = daysBetween(t, s); if (n < 0) n = daysBetween(t, (y+1) + s.slice(4));
  return n;
}
function custStats(id){
  var c = CUS.get(id) || {}, t = today(), goal = PLAN.stampGoal || 8;
  var os = [];
  ORD.forEach(function(o, oid){ if (custIdFor(o) === id) os.push(Object.assign({id:oid}, o)); });
  os.sort(function(a, b){ return (a.date || '9999') < (b.date || '9999') ? -1 : 1; });
  var done = os.filter(function(o){ return o.picked || (o.date && o.date <= t); });
  var spend = done.reduce(function(s, o){ return s + orderTotal(o); }, 0);
  var dates = done.map(function(o){ return o.date; }).filter(Boolean);
  var last = dates.length ? dates[dates.length - 1] : '';
  var gaps = []; for (var i = 1; i < dates.length; i++){ var g = daysBetween(dates[i-1], dates[i]); if (g > 0) gaps.push(g); }
  var avgGap = gaps.length ? Math.round(gaps.reduce(function(a, b){ return a + b; }, 0) / gaps.length) : null;
  var since = last ? daysBetween(last, t) : null;
  var upcoming = os.some(function(o){ return !o.picked && (!o.date || o.date >= t); });
  var fav = {};
  os.forEach(function(o){ (o.items || []).forEach(function(it){
    var r = REC.get(it.recipeId), nm = r ? r.name : it.name; if (nm) fav[nm] = (fav[nm] || 0) + num(it.qty); }); });
  var favList = Object.keys(fav).sort(function(a, b){ return fav[b] - fav[a]; });
  var earned = os.filter(function(o){ return o.picked; }).length;
  var stamps = Math.max(0, earned - num(c.redeemed) * goal);
  /* 新客 = 第 1 单，回头客 = 第 2 单起（只要下了单就算，不管付没付、取没取）；未成交 = 有没付款的订单，可以和新客/回头客同时出现 */
  var n = os.length, unpaidOrders = os.filter(function(o){ return !o.paid; });
  var seg;
  if (!n) seg = 'none';
  else if (!upcoming && since != null && since > Math.max(45, (PLAN.recontactDays || 21) * 2)) seg = 'sleep';
  else if (n >= 5 || spend >= 150) seg = 'vip';
  else if (n >= 2) seg = 'back';
  else seg = 'new';
  return {orders:os, done:done, count:n, unpaid:unpaidOrders.length, unpaidAmt:unpaidOrders.reduce(function(s, o){ return s + orderTotal(o); }, 0),
    spend:spend, avg:done.length ? spend / done.length : 0, last:last, first:dates[0] || '',
    avgGap:avgGap, since:since, upcoming:upcoming, fav:fav, favList:favList, stamps:stamps, goal:goal, seg:seg};
}
var SEGS = {vip:['常客','seg-vip'], back:['回头客','seg-back'], 'new':['新客','seg-new'], sleep:['沉睡','seg-sleep'], none:['还没下单','seg-none']};
function segHtml(st, style){
  var s = SEGS[st.seg], a = style ? ' style="' + style + '"' : '';
  return '<span class="seg ' + s[1] + '"' + a + '>' + s[0] + '</span>' +
    (st.unpaid ? '<span class="seg seg-unpaid"' + a + ' title="有 ' + st.unpaid + ' 单还没付款">未成交</span>' : '');
}
function segTag(id){ return segHtml(custStats(id)); }
function relDays(n){ return n == null ? '—' : n === 0 ? '今天' : n === 1 ? '昨天' : n + ' 天前'; }

function dueList(){
  var t = today(), out = [];
  CUS.forEach(function(c, id){
    var st = custStats(id); if (!st.count) return;
    var lc = c.lastContacted ? daysBetween(c.lastContacted, t) : 999;
    if (lc < 3) return;
    var reasons = [];
    var b = bdayIn(c.birthday);
    if (b != null && b <= 7 && lc >= 20) reasons.push({type:'bday', pri:3, text:b === 0 ? '今天生日' : b + ' 天后生日'});
    var th = st.avgGap ? Math.max(7, Math.round(st.avgGap * 1.3)) : (PLAN.recontactDays || 21);
    if (!st.upcoming && st.since >= th && lc >= 7)
      reasons.push({type:'back', pri:1, text:st.since + ' 天没下单' + (st.avgGap ? '（平时大约每 ' + st.avgGap + ' 天一次）' : '')});
    if (!reasons.length) return;
    reasons.sort(function(a, b){ return b.pri - a.pri; });
    out.push({id:id, c:c, st:st, reasons:reasons, pri:reasons[0].pri});
  });
  out.sort(function(a, b){ return b.pri - a.pri || b.st.spend - a.st.spend; });
  return out;
}
function msgFor(id, type){
  var c = CUS.get(id), st = custStats(id), fav = st.favList[0], name = c.name;
  var place = c.place ? c.place + '自提' : '自提';
  if (type === 'bday') return name + '～提前祝你生日快乐🎂！生日那周下单的话我给你多准备一份小惊喜' +
    (fav ? '，要不要再来一份你喜欢的' + fav + '？' : '。') + '这周照常开放预订，' + place + '～';
  if (type === 'stamp'){
    if (st.stamps >= st.goal) return name + '～你的集点卡已经集满 ' + st.goal + ' 个章啦！下次下单可以兑换' + (PLAN.stampReward || '一份小礼物') + '，记得跟我说一声哦～';
    return name + '～你已经集了 ' + st.stamps + '/' + st.goal + ' 个章，再来一次就能兑换' + (PLAN.stampReward || '一份小礼物') + '啦！这周开放预订，' + place + '～';
  }
  return 'Hi ' + name + '～好久不见！' + (fav ? '上次的' + fav + '还合口味吗？' : '') + '这周开放预订啦，' +
    (fav ? '要不要还是给你留一份' + fav + '？' : '有新口味可以试试～') + place + '很方便～';
}

function renderCustomers(){
  var t = today(), ids = Array.from(CUS.keys());
  var stats = {}; ids.forEach(function(id){ stats[id] = custStats(id); });
  var buyers = ids.filter(function(id){ return stats[id].count > 0; });
  var repeat = buyers.filter(function(id){ return stats[id].count >= 2; });
  var monthNew = buyers.filter(function(id){ return stats[id].first && stats[id].first.slice(0,7) === t.slice(0,7); });
  var h = '<div class="head"><h1 class="page">客人</h1><button class="btn" data-action="c-new">新建客人</button></div>';
  h += '<div class="csum">' +
    '<div class="fig"><div class="lbl">下过单的客人</div><div class="val">' + buyers.length + ' 位</div></div>' +
    '<div class="fig"><div class="lbl">复购率</div><div class="val">' + (buyers.length ? Math.round(repeat.length / buyers.length * 100) + '%' : '—') + '</div></div>' +
    '<div class="fig"><div class="lbl">本月新客</div><div class="val">' + monthNew.length + ' 位</div></div></div>';
  var orphan = {};
  ORD.forEach(function(o){ if (o.customer && !custIdFor(o)) orphan[normName(o.customer)] = o; });
  var on = Object.keys(orphan).length;
  if (on) h += '<div class="banner">有 ' + on + ' 位客人下过单但还没有档案。 <button class="link" data-action="c-import">一键建立档案</button></div>';

  var due = dueList();
  h += '<h2>今天该联系谁</h2>';
  if (!due.length) h += '<p class="muted small">现在没有需要跟进的客人。客人太久没下单或快过生日时，会出现在这里。</p>';
  due.slice(0, 8).forEach(function(x){
    var r = x.reasons[0];
    h += '<div class="due"><div class="top"><a class="who" data-action="c-open" data-id="' + esc(x.id) + '"><strong>' + esc(x.c.name) + '</strong></a>' + segTag(x.id) +
      '<span class="small muted" style="margin-left:auto">共 ' + x.st.count + ' 单，' + money(x.st.spend) + '</span></div>' +
      '<div class="why">' + esc(x.reasons.map(function(r){ return r.text; }).join('；')) + (x.c.contact ? '。联系方式：' + esc(x.c.contact) : '') + '</div>' +
      '<div class="bot"><button class="btn small" data-action="c-msg" data-id="' + esc(x.id) + '" data-type="' + r.type + '">写好消息</button>' +
      '<button class="btn ghost small" data-action="c-contacted" data-id="' + esc(x.id) + '">已联系</button></div>' +
      (openMsg && openMsg.id === x.id ? msgBox(x.id, openMsg.type) : '') + '</div>';
  });
  if (due.length > 8) h += '<p class="muted small">还有 ' + (due.length - 8) + ' 位，先联系上面这些。</p>';

  h += '<h2>全部客人</h2><input class="search" id="csearch" type="search" placeholder="搜名字、联系方式、偏好" value="' + esc(csearch) + '">' +
    '<div class="ofilter" role="group" aria-label="筛选">' +
    [['all','全部'],['unpaid','未成交'],['new','新客'],['back','回头客'],['vip','常客'],['sleep','沉睡']].map(function(f){
      return '<button data-action="cseg" data-f="' + f[0] + '" aria-pressed="' + (cseg === f[0]) + '">' + f[1] + '</button>'; }).join('') + '</div>';
  h += '<div id="clistWrap">' + custListHtml(stats) + '</div>';

  h += '<h2>提醒设置</h2><div class="grid2">' +
    '<label class="f">几天没下单就提醒<input type="number" inputmode="numeric" min="1" data-crm="recontactDays" value="' + esc(PLAN.recontactDays) + '"></label>' +
    '</div><p class="muted small">老客如果有固定的购买节奏，会按她自己的节奏提醒，不用等到设定的天数。</p>';
  return h;
}
function custListHtml(stats){
  var q = normName(csearch);
  var list = Array.from(CUS.entries()).filter(function(e){
    var c = e[1], st = stats[e[0]];
    if (cseg === 'unpaid' ? !st.unpaid : (cseg !== 'all' && st.seg !== cseg)) return false;
    if (!q) return true;
    return [c.name, c.contact, c.likes, c.avoid, c.notes, c.source].some(function(v){ return normName(v).indexOf(q) >= 0; });
  }).sort(function(a, b){ return (stats[b[0]].last || '') < (stats[a[0]].last || '') ? -1 : 1; });
  if (!list.length) return '<div class="empty">' + (CUS.size ? '没有符合条件的客人。' : '还没有客人档案。在「订单」里记一单，客人档案就会自动建好。') + '</div>';
  return '<ul class="clist">' + list.map(function(e){
    var id = e[0], c = e[1], st = stats[id];
    return '<li><button class="crow" data-action="c-open" data-id="' + esc(id) + '"><span><span class="nm">' + esc(c.name) + '</span>' + segHtml(st) + '<br>' +
      '<span class="meta">' + (!st.count ? '还没下单' : st.since != null ? '上次 ' + relDays(st.since) + (st.favList[0] ? '，爱买' + esc(st.favList[0]) : '') : '第一单还没到取货日') +
      (st.unpaid ? '，<span style="color:var(--rose)">' + money(st.unpaidAmt) + ' 没付款</span>' : '') +
      (c.avoid ? '，<span style="color:var(--rose)">忌口：' + esc(c.avoid) + '</span>' : '') + '</span></span>' +
      '<span class="rt"><strong>' + money(st.spend) + '</strong>' + st.count + ' 单</span></button></li>';
  }).join('') + '</ul>';
}
function msgBox(id, type){
  return '<div class="msgbox"><textarea id="msgText" aria-label="消息内容">' + esc(msgFor(id, type)) + '</textarea>' +
    '<div class="bot" style="margin-top:8px"><button class="btn small" data-action="c-copy" data-id="' + esc(id) + '">复制并标记已联系</button>' +
    '<button class="btn ghost small" data-action="c-msg-close">收起</button></div></div>';
}

function renderCustDetail(){
  var id = view.custId, c = CUS.get(id);
  if (!c){ view.custId = null; return renderCustomers(); }
  var st = custStats(id);
  var h = '<button class="link" data-action="c-back">全部客人</button>' +
    '<h1 class="title display">' + esc(c.name) + segHtml(st, 'font-size:14px;font-family:inherit') + '</h1>';
  if (st.unpaid) h += '<div class="warn"><strong>未成交：</strong>有 ' + st.unpaid + ' 单还没付款，共 ' + money(st.unpaidAmt) + '。</div>';
  h += '<div class="figs">' +
    '<div class="fig hero"><div class="lbl">累计消费</div><div class="val">' + money(st.spend) + '</div></div>' +
    '<div class="fig"><div class="lbl">下单次数</div><div class="val">' + st.count + ' 次</div></div>' +
    '<div class="fig"><div class="lbl">平均客单价</div><div class="val">' + (st.done.length ? money(st.avg) : '—') + '</div></div>' +
    '<div class="fig"><div class="lbl">上次购买</div><div class="val">' + relDays(st.since) + '</div></div></div>';
  if (st.avgGap) h += '<p class="muted small">平均每 ' + st.avgGap + ' 天买一次。' + (st.upcoming ? '现在有待取货的订单。' : '') + '</p>';
  if (c.avoid) h += '<div class="warn"><strong>忌口 / 过敏：</strong>' + esc(c.avoid) + '</div>';


  h += '<h2>档案</h2><dl class="prof">' +
    [['联系方式', c.contact], ['来源', c.source], ['生日', c.birthday], ['喜欢的口味', c.likes], ['常用取货点', c.place], ['备注', c.notes],
     ['上次联系', c.lastContacted ? dayLabel(c.lastContacted) : '']].map(function(p){
      return '<dt>' + p[0] + '</dt><dd>' + (p[1] ? esc(p[1]) : '<span class="muted">—</span>') + '</dd>'; }).join('') +
    '<dt>最常买</dt><dd>' + (st.favList.length ? esc(st.favList.slice(0, 3).map(function(n){ return n + ' ×' + st.fav[n]; }).join('，')) : '<span class="muted">—</span>') + '</dd></dl>';

  h += '<h2>联系她</h2><div class="bot" style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="btn ghost small" data-action="c-msg" data-id="' + esc(id) + '" data-type="back">回购提醒</button>' +
    '<button class="btn ghost small" data-action="c-msg" data-id="' + esc(id) + '" data-type="bday">生日祝福</button></div>' +
    (openMsg && openMsg.id === id ? msgBox(id, openMsg.type) : '');

  h += '<h2>购买记录</h2>';
  if (!st.orders.length) h += '<p class="muted">还没有订单。</p>';
  else {
    h += '<ul class="hist">' + st.orders.slice().reverse().map(function(o){
      return '<li><span class="d">' + esc(o.date || '未定日期') + '</span><span>' + esc(orderItemsText(o)) +
        (!o.picked ? ' <span class="tag">待取货</span>' : '') + (!o.paid ? ' <span class="tag unpaid">没付款</span>' : '') + '</span><span>' + money(orderTotal(o)) + '</span></li>'; }).join('') + '</ul>';
  }
  h += '<div class="actions"><button class="btn" data-action="c-order">给她下新订单</button>' +
    '<button class="btn ghost" data-action="c-edit">编辑档案</button>' +
    '<button class="btn danger" data-action="c-delete">删除客人</button></div>';
  return h;
}

function renderCustEdit(){
  var d = view.draft, isNew = !CUS.has(view.custId);
  var f = function(k, label, ph){ return '<label class="f">' + label + '<input data-cd="' + k + '" value="' + esc(d[k]) + '" placeholder="' + esc(ph || '') + '"></label>'; };
  return '<button class="link" data-action="c-cancel">取消编辑</button><h1 class="page">' + (isNew ? '新建客人' : '编辑档案') + '</h1>' +
    '<div class="grid2">' + f('name','名字','例如：Lily') + f('contact','联系方式','微信 / 电话') + f('source','来源','NYU Tandon / 朋友介绍 / 小红书') +
    f('birthday','生日','例如 10-25') + f('place','常用取货点','Brooklyn / Midtown / 哥大') + f('likes','喜欢的口味','芋泥、少甜') + '</div>' +
    '<label class="f" style="margin-top:12px">忌口 / 过敏<input data-cd="avoid" value="' + esc(d.avoid) + '" placeholder="例如：花生过敏、不吃榴莲"></label>' +
    '<label class="f" style="margin-top:12px">备注<textarea data-cd="notes" placeholder="她提过的事、喜欢的包装、谁介绍来的……">' + esc(d.notes) + '</textarea></label>' +
    '<div class="actions"><button class="btn" data-action="c-save">保存档案</button><button class="btn ghost" data-action="c-cancel">取消</button></div>';
}

function updateCustHint(){
  var el = document.getElementById('custHint'); if (!el || !view.draft) return;
  var id = findCustByName(view.draft.customer);
  if (!id){ el.innerHTML = view.draft.customer && String(view.draft.customer).trim() ? '新客人，保存订单时会自动建立档案。' : ''; return; }
  var c = CUS.get(id), st = custStats(id), lastO = st.done[st.done.length - 1];
  el.innerHTML = '<strong>老客</strong>' + segTag(id) + '：下单 ' + st.count + ' 次，累计 ' + money(st.spend) +
    (lastO ? '。上次（' + esc(relDays(st.since)) + '）买了' + esc(orderItemsText(lastO)) : '') + '。' +
    (c.likes ? '<br>喜欢：' + esc(c.likes) : '') +
    (c.avoid ? '<br><span class="alert">忌口 / 过敏：' + esc(c.avoid) + '</span>' : '') +
    '';
}

function openCust(id){ view = {tab:'customers', recipeId:null, editing:false, draft:null, scale:null, custId:id}; openMsg = null; render(); window.scrollTo(0,0); }
function copyText(txt, after){
  var done = function(){ toast('已复制，去微信粘贴发送就行。'); if (after) after(); };
  var fallback = function(){
    var ta = document.getElementById('msgText');
    if (ta){ ta.focus(); ta.select(); try { if (document.execCommand('copy')){ done(); return; } } catch(e){} }
    toast('浏览器不让自动复制，文字已选中，长按复制就行。');
  };
  try { navigator.clipboard.writeText(txt).then(done, fallback); } catch(e){ fallback(); }
}
function markContacted(id){ var c = CUS.get(id); if (!c) return; c = clone(c); c.lastContacted = today(); saveCustomer(id, c); }

app.addEventListener('click', function(e){
  var b = e.target.closest('[data-action]'); if (!b) return;
  var a = b.dataset.action;
  if (a === 'c-open') openCust(b.dataset.id);
  else if (a === 'c-back'){ view.custId = null; openMsg = null; render(); }
  else if (a === 'cseg'){ cseg = b.dataset.f; render(); }
  else if (a === 'c-msg'){ openMsg = {id:b.dataset.id, type:b.dataset.type}; render(); var ta = document.getElementById('msgText'); if (ta) ta.scrollIntoView({block:'nearest'}); }
  else if (a === 'c-msg-close'){ openMsg = null; render(); }
  else if (a === 'c-copy'){ var ta2 = document.getElementById('msgText'); markContacted(b.dataset.id);
    copyText(ta2 ? ta2.value : '', function(){ openMsg = null; render(); }); }
  else if (a === 'c-contacted'){ markContacted(b.dataset.id); render(); toast('已记下，接下来一周不会再提醒她。'); }
  else if (a === 'c-redeem'){
    var c = clone(CUS.get(view.custId)); c.redeemed = num(c.redeemed) + 1; saveCustomer(view.custId, c); render(); toast('已兑换，集点卡重新开始。');
  }
  else if (a === 'c-new' || a === 'c-edit'){
    var isNew = a === 'c-new', cur = isNew ? {} : CUS.get(view.custId);
    if (isNew) view.custId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    view.draft = {}; ['name','contact','source','birthday','place','likes','avoid','notes'].forEach(function(k){ view.draft[k] = cur[k] || ''; });
    view.editing = true; render(); window.scrollTo(0,0);
  }
  else if (a === 'c-cancel'){ view.editing = false; view.draft = null; if (!CUS.has(view.custId)) view.custId = null; render(); }
  else if (a === 'c-save'){
    var d = view.draft;
    if (!String(d.name).trim()){ toast('先填名字。'); return; }
    var other = findCustByName(d.name);
    if (other && other !== view.custId){ toast('已经有叫「' + d.name + '」的客人了，换个能区分的名字。'); return; }
    var base = CUS.get(view.custId) || {redeemed:0, lastContacted:'', created:today()};
    var out = Object.assign(clone(base), {});
    ['name','contact','source','birthday','place','likes','avoid','notes'].forEach(function(k){ out[k] = String(d[k] || '').trim(); });
    saveCustomer(view.custId, out); view.editing = false; view.draft = null; render(); toast('档案已保存。');
  }
  else if (a === 'c-delete'){
    var cid = view.custId, cc = CUS.get(cid);
    ask('删除「' + (cc ? cc.name : '') + '」的档案？她的订单记录会保留。', '删除').then(function(ok){
      if (ok){ deleteCustomer(cid); view.custId = null; render(); toast('档案已删除。'); }
    });
  }
  else if (a === 'c-order'){
    var c3 = CUS.get(view.custId), cid3 = view.custId;
    view = {tab:'orders', recipeId:null, editing:false, draft:null, scale:null};
    openOrder('o' + Date.now().toString(36) + Math.random().toString(36).slice(2,6));
    view.draft.customer = c3.name; view.draft.customerId = cid3; view.draft.contact = c3.contact || ''; view.draft.place = c3.place || '';
    render();
  }
  else if (a === 'c-import'){
    var seen = {};
    sortedOrders().forEach(function(e){
      var o = e[1], n = normName(o.customer);
      if (!n || custIdFor(o) || seen[n]) return;
      seen[n] = 1; ensureCustomer({customer:o.customer, contact:o.contact, place:o.place});
    });
    render(); toast('已建立 ' + Object.keys(seen).length + ' 份客人档案。');
  }
});
app.addEventListener('input', function(e){
  var t = e.target;
  if (t.id === 'csearch'){ csearch = t.value; var stats = {}; CUS.forEach(function(c, id){ stats[id] = custStats(id); });
    document.getElementById('clistWrap').innerHTML = custListHtml(stats); return; }
  if (t.dataset.cd && view.draft) view.draft[t.dataset.cd] = t.value;
});
app.addEventListener('change', function(e){
  var t = e.target;
  if (t.dataset.crm){
    var k = t.dataset.crm;
    PLAN[k] = k === 'stampReward' ? (String(t.value).trim() || '一份小礼物') : Math.max(1, Math.round(num(t.value)) || 1);
    savePlan(); pendingRender = true;
    setTimeout(function(){ if (!isEditing()){ pendingRender = false; render(); } }, 0);
  }
  if (t.dataset.od === 'customer' && view.draft){
    var id = findCustByName(t.value);
    if (id){ var c = CUS.get(id); view.draft.customerId = id;
      if (!view.draft.contact && c.contact) view.draft.contact = c.contact;
      if (!view.draft.place && c.place) view.draft.place = c.place;
      setTimeout(render, 0); }
  }
});


/* ---------- sales analytics ---------- */
function wsegHtml(){
  return '<div class="wseg" role="group" aria-label="切换">' +
    [['sales','销售分析'],['prod','本周生产']].map(function(x){
      return '<button data-action="wview" data-v="' + x[0] + '" aria-pressed="' + (wview === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
}
function weekStart(s){
  var p = s.split('-'), d = new Date(+p[0], +p[1]-1, +p[2]);
  d.setDate(d.getDate() - ((d.getDay() + 4) % 7)); return ymd(d);   // 每周从周三算到下周二
}
function pws0(ws){ return addDays(ws, -7); }
function md(s){ var p = s.split('-'); return (+p[1]) + '/' + (+p[2]); }
function pctChange(a, b){ return b > 0 ? (a - b) / b : null; }
function itemCost(it){
  var r = REC.get(it.recipeId); if (!r) return null;
  var k = calc(r); return k.unitCost == null ? null : k.unitCost;
}
/* 一行订单的总成本；盲盒按实际给的产品算，没填的按估算 */
function lineCostTotal(it){
  var r = REC.get(it.recipeId), q = num(it.qty);
  if (it.gift || !isBlind(r)){ var c = itemCost(it); return {total:c == null ? null : c * q, zero:c === 0, pending:0}; }
  var act = it.actual || [], total = 0, pending = 0, est = calc(r).unitCost, bad = false;
  for (var j = 0; j < q; j++){
    var c2 = act[j] ? unitCostOf(act[j]) : null;
    if (c2 != null) total += c2; else { pending++; if (est == null) bad = true; else total += est; }
  }
  return {total:bad ? null : total, zero:!bad && total === 0, pending:pending};
}
function blindPending(o){
  return (o.items || []).reduce(function(s, it){ return s + (isBlind(REC.get(it.recipeId)) ? lineCostTotal(it).pending : 0); }, 0);
}
function custKey(o){ return custIdFor(o) || ('n:' + normName(o.customer)); }

function analyze(){
  var firstDate = {};
  ORD.forEach(function(o){ if (!o.date) return; var k = custKey(o); if (!firstDate[k] || o.date < firstDate[k]) firstDate[k] = o.date; });
  var weeks = {};
  ORD.forEach(function(o){
    if (!o.date) return;
    var ws = weekStart(o.date), w = weeks[ws] || (weeks[ws] = {ws:ws, sales:0, cost:0, costKnown:true, orders:0, products:{}, cust:{}, newC:{}, place:{}, unpaid:0, day:[0,0,0,0,0,0,0], disc:0, promoN:0, giftQty:0, giftCost:0});
    var tot = orderTotal(o), k = custKey(o);
    w.disc += orderDiscount(o); if (o.promo) w.promoN += 1;
    w.sales += tot; w.orders += 1;
    if (!o.paid) w.unpaid += tot;
    w.cust[k] = (w.cust[k] || 0) + tot;
    if (firstDate[k] >= ws) w.newC[k] = 1;
    var pl = o.place || '未填'; w.place[pl] = (w.place[pl] || 0) + tot;
    var p = o.date.split('-'); w.day[(new Date(+p[0], +p[1]-1, +p[2]).getDay() + 4) % 7] += tot;
    (o.items || []).concat(giftItems(o)).forEach(function(it){
      var r = REC.get(it.recipeId), nm = r ? r.name : (it.name || '已删除的产品');
      var pr = w.products[nm] || (w.products[nm] = {name:nm, id:it.recipeId, qty:0, rev:0, cost:0, costKnown:true});
      var q = num(it.qty), lt = lineCostTotal(it).total;
      if (it.gift){ w.giftQty += q; if (lt != null) w.giftCost += lt; }
      pr.qty += q; pr.rev += q * num(it.price);
      if (lt == null){ pr.costKnown = false; w.costKnown = false; } else { pr.cost += lt; w.cost += lt; }
    });
  });
  Object.keys(weeks).forEach(function(k){ var w = weeks[k]; w.gross = w.sales - w.cost; });
  return weeks;
}
function emptyWeek(ws){ return {ws:ws, sales:0, cost:0, gross:0, costKnown:true, orders:0, products:{}, cust:{}, newC:{}, place:{}, unpaid:0, day:[0,0,0,0,0,0,0], disc:0, promoN:0, giftQty:0, giftCost:0}; }
function getW(weeks, ws){ return weeks[ws] || emptyWeek(ws); }

function deltaHtml(cur, prev, isMoney){
  if (!prev){ return '<span>上周没有数据</span>'; }
  var p = pctChange(cur, prev);
  if (p == null) return '';
  if (Math.round(p * 100) === 0) return '<span>和上周持平</span>';
  var up = p >= 0;
  return '<span class="' + (up ? 'up' : 'dn') + '"><b>' + (up ? '▲ ' : '▼ ') + Math.abs(Math.round(p * 100)) + '%</b></span> 比上周';
}

function insightsFor(weeks, ws){
  var w = getW(weeks, ws), pw = getW(weeks, addDays(ws, -7)), out = [];
  if (!w.orders){ out.push(['', '这周还没有订单。']); }
  else {
    var p = pctChange(w.sales, pw.sales);
    out.push(['', '销售额 ' + money(w.sales) + '，' + w.orders + ' 单' + (p == null ? '。' : (Math.round(p * 100) === 0 ? '，和上周差不多。' : '，比上周' + (p >= 0 ? '增长 ' : '下降 ') + Math.abs(Math.round(p * 100)) + '%（上周 ' + money(pw.sales) + '）。'))]);
    // driver
    var names = {}; Object.keys(w.products).concat(Object.keys(pw.products)).forEach(function(n){ names[n] = 1; });
    var best = null;
    Object.keys(names).forEach(function(n){
      var d = (w.products[n] ? w.products[n].rev : 0) - (pw.products[n] ? pw.products[n].rev : 0);
      if (!best || Math.abs(d) > Math.abs(best.d)) best = {n:n, d:d};
    });
    if (pw.orders && best && Math.abs(best.d) >= 1) out.push(['', '变化最大的是' + best.n + '（' + (best.d >= 0 ? '+' : '-') + money(Math.abs(best.d)) + '）。']);
    var prods = Object.keys(w.products).map(function(k){ return w.products[k]; }).sort(function(a, b){ return b.rev - a.rev; });
    if (prods.length > 1) out.push(['', prods[0].name + ' 卖得最好，占这周销售额的 ' + Math.round(prods[0].rev / w.sales * 100) + '%。']);
    prods.forEach(function(pr){
      if (!pr.costKnown || !pr.rev) return;
      var m = (pr.rev - pr.cost) / pr.rev;
      if (m < PLAN.targetMargin){
        var r = REC.get(pr.id), k = r ? calc(r) : null;
        out.push(['bad', pr.name + ' 毛利率只有 ' + Math.round(m * 100) + '%，低于目标 ' + Math.round(PLAN.targetMargin * 100) + '%' +
          (k && k.unitCost ? '，售价至少要到 ' + money(k.unitCost / (1 - PLAN.targetMargin)) : '') + '。']);
      }
    });
    var ck = Object.keys(w.cust), nn = Object.keys(w.newC).length, ret = ck.length - nn;
    var retRev = ck.filter(function(k){ return !w.newC[k]; }).reduce(function(s, k){ return s + w.cust[k]; }, 0);
    out.push(['', ck.length + ' 位客人：' + nn + ' 位新客，' + ret + ' 位回头客' + (ret ? '，回头客贡献了 ' + Math.round(retRev / w.sales * 100) + '% 的销售额' : '') + '。']);
    if (w.unpaid > 0) out.push(['warnl', '还有 ' + money(w.unpaid) + ' 没收款。']);
    if (w.promoN){
      var dmx = getW(weeks, pws0(ws));
      out.push(['', w.promoN + ' 单用了满额优惠（占 ' + Math.round(w.promoN / w.orders * 100) + '%）' +
        (w.disc ? '，折扣让利 ' + money(w.disc) : '') + (w.giftQty ? '，送出蛋挞 ' + w.giftQty + ' 个' + (w.giftCost ? '（成本约 ' + money(w.giftCost) + '）' : '') : '') +
        '。客单价 ' + money(w.sales / w.orders) + (dmx.orders ? '，上周 ' + money(dmx.sales / dmx.orders) : '') + '。']);
    }
    var hrs = HOURS.reduce(function(t, x){ return t + num(PLAN.hours[x[0]]); }, 0);
    if (hrs > 0 && w.costKnown){
      var wage = w.gross / hrs;
      out.push([wage >= PLAN.targetWage ? '' : 'warnl', '按每周 ' + (Math.round(hrs * 10) / 10) + ' 小时算，这周时薪约 ' + money(wage) + (wage >= PLAN.targetWage ? '，达到' : '，没达到') + '目标 ' + money(PLAN.targetWage) + '。']);
    }
  }
  // 4-week trend
  var s4 = 0, p4 = 0;
  for (var i = 0; i < 4; i++){ s4 += getW(weeks, addDays(ws, -7 * i)).sales; p4 += getW(weeks, addDays(ws, -7 * (i + 4))).sales; }
  if (p4 > 0){ var t = pctChange(s4, p4); out.push([t < -0.1 ? 'warnl' : '', '最近 4 周平均每周 ' + money(s4 / 4) + '，' + (t >= 1 ? '是再往前 4 周的 ' + (Math.round((t + 1) * 10) / 10) + ' 倍。' : '比再往前 4 周' + (t >= 0 ? '高 ' : '低 ') + Math.abs(Math.round(t * 100)) + '%。')]); }
  // 8-week weekday & place
  var day = [0,0,0,0,0,0,0], place = {}, tot8 = 0, sold = {};
  for (var j = 0; j < 8; j++){
    var x = getW(weeks, addDays(ws, -7 * j));
    x.day.forEach(function(v, k){ day[k] += v; }); tot8 += x.sales;
    Object.keys(x.place).forEach(function(k){ place[k] = (place[k] || 0) + x.place[k]; });
    if (j < 4) Object.keys(x.products).forEach(function(n){ sold[n] = 1; });
  }
  if (tot8 > 0){
    var bd = day.indexOf(Math.max.apply(null, day)), WK = ['周三','周四','周五','周六','周日','周一','周二'];
    var pls = Object.keys(place).sort(function(a, b){ return place[b] - place[a]; });
    out.push(['', '最近 8 周' + WK[bd] + '取货最多（占 ' + Math.round(day[bd] / tot8 * 100) + '%）' + (pls.length > 1 ? '，' + pls[0] + ' 占 ' + Math.round(place[pls[0]] / tot8 * 100) + '%' : '') + '。']);
  }
  var stale = [];
  REC.forEach(function(r){
    if (sold[r.name]) return;
    var ever = false; Object.keys(weeks).forEach(function(k){ if (k < ws && weeks[k].products[r.name]) ever = true; });
    if (ever) stale.push(r.name);
  });
  if (stale.length) out.push(['warnl', stale.join('、') + ' 已经 4 周没人买，可以考虑换成季节限定或下架。']);
  return out;
}

function renderSales(){
  var weeks = analyze(), ws = addDays(weekStart(today()), 7 * wOff), pws = addDays(ws, -7);
  var w = getW(weeks, ws), pw = getW(weeks, pws);
  var h = wsegHtml() + '<div class="wnav"><button class="x" data-action="wk" data-d="-1" aria-label="上一周">‹</button>' +
    '<span class="lbl">' + (wOff === 0 ? '本周' : wOff === -1 ? '上周' : wOff === 1 ? '下周' : '第 ' + md(ws) + ' 周') +
    '<small>' + md(ws) + ' – ' + md(addDays(ws, 6)) + '，按取货日期统计</small></span>' +
    '<button class="x" data-action="wk" data-d="1" aria-label="下一周">›</button>' +
    (wOff ? '<button class="link" data-action="wk" data-d="0">回到本周</button>' : '') + '</div>';
  var aov = w.orders ? w.sales / w.orders : 0, paov = pw.orders ? pw.sales / pw.orders : 0;
  var mg = w.sales ? w.gross / w.sales : null;
  h += '<div class="kpis">' +
    '<div class="kpi hero"><div class="lbl">销售额</div><div class="val">' + money(w.sales) + '</div><div class="d">' + deltaHtml(w.sales, pw.sales) + '</div></div>' +
    '<div class="kpi"><div class="lbl">订单数</div><div class="val">' + w.orders + '</div><div class="d">' + deltaHtml(w.orders, pw.orders) + '</div></div>' +
    '<div class="kpi"><div class="lbl">客单价</div><div class="val">' + (w.orders ? money(aov) : '—') + '</div><div class="d">' + (w.orders ? deltaHtml(aov, paov) : '') + '</div></div>' +
    '<div class="kpi"><div class="lbl">毛利' + (w.costKnown ? '' : '（部分缺成本）') + '</div><div class="val">' + money(w.gross) + '</div><div class="d">' + (mg == null ? '' : '毛利率 ' + pct(mg)) + '</div></div></div>';

  h += '<h2>数据分析</h2><ul class="insights">' + insightsFor(weeks, ws).map(function(x){
    return '<li class="' + x[0] + '">' + esc(x[1]) + '</li>'; }).join('') + '</ul>';
  h += '<div style="margin-top:10px" id="aiWrap"><button class="btn ghost small" data-action="ai" ' + (aiBusy ? 'disabled' : '') + ' hidden>' +
    (aiBusy ? '分析中…' : aiText ? '让 Claude 重新分析' : '让 Claude 深入分析') + '</button>' +
    (aiBusy ? ' <button class="link" data-action="ai-stop">停止</button>' : '') + '<div class="ai" id="aiOut">' + aiFmt(aiText) + '</div></div>';

  // 12-week trend
  var cols = [], mx = 0;
  for (var i = 11; i >= 0; i--){ var x = getW(weeks, addDays(ws, -7 * i)); cols.push(x); if (x.sales > mx) mx = x.sales; }
  h += '<h2>近 12 周销售额</h2>';
  if (!mx) h += '<p class="muted">还没有销售数据。在「订单」里记下订单后，这里会出现趋势。</p>';
  else {
    h += '<div class="vbars">' + cols.map(function(x){
      var hp = x.sales / mx * 100, sel = x.ws === ws;
      var tip = md(x.ws) + ' – ' + md(addDays(x.ws, 6)) + '\n销售额 ' + money(x.sales) + '\n毛利 ' + money(x.gross) + '\n' + x.orders + ' 单';
      return '<div class="col' + (sel ? ' sel' : '') + '" data-action="wk-jump" data-ws="' + x.ws + '" data-tip="' + esc(tip) + '" role="img" aria-label="' + esc(tip.replace(/\n/g, '，')) + '">' +
        (sel && x.sales ? '<span class="v">' + money(x.sales) + '</span>' : '') + '<div class="bar" style="height:' + hp + '%"></div></div>';
    }).join('') + '</div><div class="vlabels">' + cols.map(function(x){ return '<span>' + md(x.ws) + '</span>'; }).join('') + '</div>' +
    '<details class="tbl"><summary>查看表格</summary><div class="tscroll"><table><thead><tr><th>周</th><th class="n">销售额</th><th class="n">订单</th><th class="n">客单价</th><th class="n">毛利</th></tr></thead><tbody>' +
      cols.slice().reverse().map(function(x){ return '<tr><td>' + md(x.ws) + ' – ' + md(addDays(x.ws, 6)) + '</td><td class="n">' + money(x.sales) + '</td><td class="n">' + x.orders +
        '</td><td class="n">' + (x.orders ? money(x.sales / x.orders) : '—') + '</td><td class="n">' + money(x.gross) + '</td></tr>'; }).join('') +
    '</tbody></table></div></details>';
  }

  // products
  var prods = Object.keys(w.products).map(function(k){ return w.products[k]; }).sort(function(a, b){ return b.rev - a.rev; });
  h += '<h2>产品表现</h2>';
  if (!prods.length) h += '<p class="muted">这周没有产品销售。</p>';
  else {
    var pmax = prods[0].rev || 1;
    h += prods.map(function(pr){
      var m = pr.costKnown && pr.rev ? (pr.rev - pr.cost) / pr.rev : null;
      var tip = pr.name + '\n卖出 ' + pr.qty + ' 个\n销售额 ' + money(pr.rev) + '\n毛利 ' + (pr.costKnown ? money(pr.rev - pr.cost) : '缺成本') + (m != null ? '（' + pct(m) + '）' : '');
      return '<div class="hbar" data-tip="' + esc(tip) + '"><span class="nm">' + esc(pr.name) + '</span><span class="track"><i style="width:' + (pr.rev / pmax * 100) + '%"></i></span>' +
        '<span class="num">' + money(pr.rev) + '<small>' + pr.qty + ' 个' + (m != null ? '，毛利率 <span style="color:' + (m < PLAN.targetMargin ? 'var(--rose)' : 'inherit') + '">' + Math.round(m * 100) + '%</span>' : '') + '</small></span></div>';
    }).join('');
  }

  // weekday + place (8 weeks)
  var day = [0,0,0,0,0,0,0], place = {}, tot = 0;
  for (var j = 0; j < 8; j++){ var y = getW(weeks, addDays(ws, -7 * j)); y.day.forEach(function(v, k){ day[k] += v; }); tot += y.sales;
    Object.keys(y.place).forEach(function(k){ place[k] = (place[k] || 0) + y.place[k]; }); }
  if (tot > 0){
    var WK = ['三','四','五','六','日','一','二'], dmx = Math.max.apply(null, day) || 1;
    var pls = Object.keys(place).sort(function(a, b){ return place[b] - place[a]; }), pmx = place[pls[0]] || 1;
    h += '<div class="twocol"><div><h2>哪天取货多（近 8 周）</h2><div class="vbars" style="height:120px">' + day.map(function(v, k){
        var tip = '周' + WK[k] + '\n' + money(v) + '（' + Math.round(v / tot * 100) + '%）';
        return '<div class="col sel" data-tip="' + esc(tip) + '" role="img" aria-label="' + esc(tip.replace('\n', '，')) + '"><div class="bar" style="height:' + (v / dmx * 100) + '%"></div></div>'; }).join('') +
      '</div><div class="vlabels">' + WK.map(function(x){ return '<span style="visibility:visible">' + x + '</span>'; }).join('') + '</div></div>' +
      '<div><h2>取货地点（近 8 周）</h2>' + pls.map(function(k){
        return '<div class="hbar" data-tip="' + esc(k + '\n' + money(place[k])) + '"><span class="nm">' + esc(k) + '</span><span class="track"><i style="width:' + (place[k] / pmx * 100) + '%"></i></span>' +
          '<span class="num">' + Math.round(place[k] / tot * 100) + '%<small>' + money(place[k]) + '</small></span></div>'; }).join('') + '</div></div>';
  }
  h += '<p class="muted small" style="margin-top:18px">销售额按订单里的成交价，毛利按配方现在的成本估算。没填取货日期的订单不计入。</p>';
  return h;
}

/* tooltip */
(function(){
  var tip = document.getElementById('tip'), cur = null;
  function show(el, x, y){
    tip.textContent = el.getAttribute('data-tip'); tip.classList.add('on');
    var r = tip.getBoundingClientRect(), vw = window.innerWidth;
    var left = Math.min(Math.max(8, x - r.width / 2), vw - r.width - 8), top = y - r.height - 12;
    if (top < 8) top = y + 16;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  document.addEventListener('pointermove', function(e){
    var el = e.target.closest && e.target.closest('[data-tip]');
    if (!el){ if (cur){ tip.classList.remove('on'); cur = null; } return; }
    cur = el; show(el, e.clientX, e.clientY);
  });
  document.addEventListener('pointerdown', function(e){
    var el = e.target.closest && e.target.closest('[data-tip]');
    if (el && e.pointerType !== 'mouse'){ cur = el; show(el, e.clientX, e.clientY); setTimeout(function(){ tip.classList.remove('on'); }, 2200); }
  });
  window.addEventListener('scroll', function(){ tip.classList.remove('on'); cur = null; }, {passive:true});
})();

/* Claude analysis (only where the page can ask Claude) */
var SAMPLE = null;
function aiFmt(t){ return esc(t || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^#{1,4}\s*/gm, ''); }
function showAiButton(){ var b = document.querySelector('[data-action="ai"]'); if (b && SAMPLE) b.hidden = false; }
if (window.claude && typeof window.claude.use === 'function'){
  window.claude.use('sample').then(function(s){ SAMPLE = s; showAiButton(); }).catch(function(){});
}
function aiPayload(){
  var weeks = analyze(), ws = addDays(weekStart(today()), 7 * wOff), list = [];
  for (var i = 11; i >= 0; i--){ var x = getW(weeks, addDays(ws, -7 * i));
    list.push({week:x.ws, sales:Math.round(x.sales), gross:Math.round(x.gross), orders:x.orders, newCustomers:Object.keys(x.newC).length, customers:Object.keys(x.cust).length}); }
  var w = getW(weeks, ws);
  var prods = Object.keys(w.products).map(function(k){ var p = w.products[k];
    return {name:p.name, qty:p.qty, revenue:Math.round(p.rev), grossMargin:p.costKnown && p.rev ? Math.round((p.rev - p.cost) / p.rev * 100) + '%' : 'unknown'}; });
  var menu = sortedRecipes().map(function(e){ var k = calc(e[1]); return {name:e[1].name, price:num(e[1].price), unitCost:k.unitCost == null ? null : Math.round(k.unitCost * 100) / 100}; });
  var segs = {}; CUS.forEach(function(c, id){ var s = custStats(id).seg; segs[s] = (segs[s] || 0) + 1; });
  return {selectedWeek:ws, weekly:list, selectedWeekProducts:prods, menu:menu, customerSegments:segs,
    targetMargin:PLAN.targetMargin, targetHourlyWage:PLAN.targetWage, weeklyHours:HOURS.reduce(function(t, x){ return t + num(PLAN.hours[x[0]]); }, 0),
    ruleBasedFindings:insightsFor(weeks, ws).map(function(x){ return x[1]; })};
}
function runAI(){
  if (!SAMPLE || aiBusy) return;
  aiBusy = true; aiText = ''; aiCtl = new AbortController(); render();
  var prompt = '你是一家纽约家庭烘焙小店的数据分析师。店主一个人做，主要客人是留学生（Brooklyn 的 NYU Tandon、哥大）和 Midtown 上班族，预订制、自提。每周按周三到下周二算。' +
    '下面是店里的销售数据（JSON，金额是美元，week 是那一周的周三日期，每周从周三到下周二）。请用中文写一份简短分析：\n' +
    '1. 先用一两句话总结这周的情况。\n2. 列出 3 条最值得注意的发现，每条都要引用具体数字。\n3. 给出 3 条下周就能执行的具体建议（定价、产品、复购、取货安排等）。\n' +
    '要求：只根据数据说话，数据不够时直接说明，不要编造；语气像朋友给建议；不要用表格；总长度控制在 300 字以内。\n\n' +
    JSON.stringify(aiPayload());
  SAMPLE(prompt, {signal:aiCtl.signal, cache:false, onText:function(u){ aiText = u.text; var el = document.getElementById('aiOut'); if (el) el.innerHTML = aiFmt(aiText); }})
    .then(function(r){ aiText = r.text; })
    .catch(function(e){
      if (e && e.text) aiText = e.text;
      var c = e && e.code;
      if (c === 'not_granted'){ SAMPLE = null; toast('没有开启 Claude 分析权限。'); }
      else if (c === 'rate_limited') toast('请求太频繁，过一会儿再试。');
      else if (c !== 'cancelled') toast('分析没有完成，稍后再试。');
    })
    .then(function(){ aiBusy = false; aiCtl = null; if (view.tab === 'week' && wview === 'sales') render(); });
}

app.addEventListener('click', function(e){
  var b = e.target.closest('[data-action]'); if (!b) return;
  var a = b.dataset.action;
  if (a === 'wview'){ wview = b.dataset.v; render(); }
  else if (a === 'wk'){ var dd = +b.dataset.d; wOff = dd === 0 ? 0 : wOff + dd; aiText = ''; render(); }
  else if (a === 'wk-jump'){ var tws = weekStart(today()); wOff = Math.round(daysBetween(tws, b.dataset.ws) / 7); aiText = ''; render(); }
  else if (a === 'ai') runAI();
  else if (a === 'ai-stop'){ if (aiCtl) aiCtl.abort(); }
});

app.addEventListener('click', function(e){
  var b = e.target.closest('[data-action="sub"]'); if (!b) return;
  view = {tab:b.dataset.v, recipeId:null, editing:false, draft:null, scale:null}; render(); window.scrollTo(0,0);
});

/* ---------- module pages ---------- */
function renderModules(){
  var list = sortedModules();
  var h = '<div class="head"><h1 class="page">模块</h1><button class="btn" data-action="m-new">新建模块</button></div>';
  if (!list.length) return h + '<div class="empty">模块是会在好几个配方里重复用到的部分，比如戚风蛋糕胚、椰奶冻、打发奶油、芋泥馅。' +
    '把它的原料、做法和产出量记一次，以后建盒子蛋糕时直接「添加模块」就行，成本也会自动算好。</div>';
  return h + '<ul class="rlist" style="margin-top:14px">' + list.map(function(e){
    var id = e[0], m = e[1], mc = modCost(m), used = modUsage(id).length;
    return '<li><button class="row" data-action="m-open" data-id="' + esc(id) + '"><span><span class="rname display">' + esc(m.name || '未命名模块') + '</span><br>' +
      '<span class="rmeta">每批出 ' + esc(amt(num(m.yieldQty), m.yieldUnit)) + ' ' + esc(m.yieldUnit || '') + (used ? '，用在 ' + used + ' 个配方' : '，还没用在配方里') +
      (mc.missing.length ? '，有 ' + mc.missing.length + ' 项原料缺价格' : '') + '</span></span>' +
      '<span class="rnums"><strong>' + money(mc.batch) + '</strong>' + (mc.unit == null ? '—' : money(mc.unit) + ' / ' + esc(m.yieldUnit || '份')) + '</span></button></li>';
  }).join('') + '</ul>';
}
function renderModDetail(){
  var id = view.modId, m = MOD.get(id);
  if (!m){ view.modId = null; return renderModules(); }
  var mc = modCost(m), used = modUsage(id);
  var h = '<button class="link" data-action="m-back">全部模块</button>' +
    '<h1 class="title display">' + esc(m.name) + '</h1><p class="muted small" style="margin:0">每批出 ' + esc(amt(num(m.yieldQty), m.yieldUnit)) + ' ' + esc(m.yieldUnit || '') + '</p>' +
    '<div class="econ"><div><div class="lbl">一批成本</div><div class="val">' + money(mc.batch) + '</div></div>' +
    '<div><div class="lbl">每 ' + esc(m.yieldUnit || '份') + ' 成本</div><div class="val">' + (mc.unit == null ? '—' : money(mc.unit < 0.1 ? r2(mc.unit * 1000) / 1000 : mc.unit)) + '</div></div>' +
    '<div><div class="lbl">用在</div><div class="val">' + used.length + ' 个配方</div></div><div><div class="lbl">原料</div><div class="val">' + (m.items || []).length + ' 种</div></div></div>';
  if (mc.missing.length) h += '<div class="warn"><strong>成本不完整：</strong>' + esc(mc.missing.join('、')) + ' 还没有价格。</div>';
  h += '<h2>原料（一批）</h2><div class="tscroll"><table><thead><tr><th>原料</th><th class="n">用量</th><th class="n">成本</th></tr></thead><tbody>' +
    ((m.items || []).map(function(it){ var ing = ING.get(it.ingId), up = unitPrice(ing);
      return '<tr><td>' + esc(ing ? ing.name : '已删除的原料') + '</td><td class="n">' + esc(amt(num(it.amount), ing ? ing.unit : 'g')) + ' ' + esc(ing ? ing.unit : '') +
        '</td><td class="n">' + money(up == null ? null : up * num(it.amount)) + '</td></tr>'; }).join('') || '<tr><td colspan="3" class="muted">还没有原料。</td></tr>') +
    '</tbody><tfoot><tr><td>合计</td><td></td><td class="n">' + money(mc.batch) + '</td></tr></tfoot></table></div>';
  h += '<h2>做法</h2>' + stepsHtml(m.steps);
  if (m.notes) h += '<h2>备注</h2><div class="notes">' + esc(m.notes) + '</div>';
  h += '<h2>用在这些配方</h2>' + (used.length ? '<ul class="hist">' + used.map(function(e){
      var it = (e[1].items || []).filter(function(x){ return x.modId === id; })[0];
      return '<li><span class="d">' + esc(amt(num(it.amount), m.yieldUnit)) + ' ' + esc(m.yieldUnit || '') + '</span><span><a class="who" data-action="open-recipe" data-id="' + esc(e[0]) + '">' + esc(e[1].name) + '</a></span><span></span></li>'; }).join('') + '</ul>'
    : '<p class="muted small">还没有配方用到它。去配方里点「添加原料或模块」就能选到。</p>');
  h += '<div class="actions"><button class="btn" data-action="m-edit">编辑模块</button><button class="btn ghost" data-action="m-copy">复制一份</button>' +
    '<button class="btn danger" data-action="m-delete">删除模块</button></div>';
  return h;
}
function renderModEdit(){
  var d = view.draft, ings = sortedIngredients(), isNew = !MOD.has(view.modId);
  var h = '<button class="link" data-action="m-cancel">取消编辑</button><h1 class="page">' + (isNew ? '新建模块' : '编辑模块') + '</h1>' +
    '<label class="f" style="margin-top:12px">模块名称<input data-d="name" value="' + esc(d.name) + '" placeholder="例如：8 寸戚风蛋糕胚"></label>' +
    '<div class="grid2"><label class="f">每批产出数量<input type="number" inputmode="decimal" min="0" data-d="yieldQty" value="' + esc(d.yieldQty) + '"></label>' +
    '<label class="f">产出单位<input data-d="yieldUnit" list="unitList" value="' + esc(d.yieldUnit) + '" placeholder="个 / g / ml / 份"></label></div>' +
    '<datalist id="unitList"><option value="个"><option value="g"><option value="ml"><option value="份"></datalist>' +
    '<p class="muted small">配方里用模块时按这个单位填，比如产出"2 个"戚风，配方里填 0.5 就是用半个；产出"900 g"奶冻，配方里填 150 就是用 150 g。</p>' +
    '<h2>原料（一批的用量）</h2>';
  if (!ings.length) h += '<p class="muted">原料库还是空的，先去「原料」页添加原料和价格。</p>';
  else {
    d.items.forEach(function(it, i){
      var ing = ING.get(it.ingId);
      h += '<div class="erow"><select data-item="' + i + '" data-k="ingId" aria-label="原料"><option value="">选择原料</option>' +
        ings.map(function(e){ return '<option value="' + esc(e[0]) + '"' + (e[0] === it.ingId ? ' selected' : '') + '>' + esc(e[1].name) + '</option>'; }).join('') +
        '</select><input type="number" inputmode="decimal" min="0" data-item="' + i + '" data-k="amount" value="' + esc(it.amount) + '" aria-label="用量">' +
        '<span class="u">' + esc(ing ? ing.unit : '') + '</span><button class="x" data-action="rm-item" data-i="' + i + '" aria-label="移除这项原料">×</button></div>';
    });
    h += '<button class="btn ghost small" data-action="add-item">添加原料</button>';
  }
  h += '<h2>做法</h2>';
  d.steps.forEach(function(s, i){
    h += '<div class="srow"><textarea data-step="' + i + '" data-k="text" aria-label="第 ' + (i+1) + ' 步" placeholder="第 ' + (i+1) + ' 步">' + esc(s.text) + '</textarea>' +
      '<input type="number" inputmode="decimal" data-step="' + i + '" data-k="temp" value="' + esc(s.temp) + '" placeholder="°C" aria-label="温度">' +
      '<input type="number" inputmode="decimal" data-step="' + i + '" data-k="time" value="' + esc(s.time) + '" placeholder="分钟" aria-label="时间（分钟）">' +
      '<button class="x" data-action="rm-step" data-i="' + i + '" aria-label="移除这一步">×</button></div>';
  });
  return h + '<button class="btn ghost small" data-action="add-step">添加步骤</button>' +
    '<h2>备注</h2><textarea data-d="notes" placeholder="保存方式、能提前几天做……">' + esc(d.notes) + '</textarea>' +
    '<div class="actions"><button class="btn" data-action="m-save">保存模块</button><button class="btn ghost" data-action="m-cancel">取消</button></div>';
}
function openModEdit(id, src){
  var m = src ? clone(src) : {name:'', yieldQty:'', yieldUnit:'个', items:[{ingId:'', amount:''}], steps:[{text:'', temp:'', time:''}], notes:''};
  m.items = m.items && m.items.length ? m.items : [{ingId:'', amount:''}]; m.steps = m.steps && m.steps.length ? m.steps : [{text:'', temp:'', time:''}];
  ['name','yieldQty','yieldUnit','notes'].forEach(function(k){ if (m[k] == null) m[k] = ''; });
  view = {tab:'modules', recipeId:null, editing:true, draft:m, scale:null, modId:id}; render(); window.scrollTo(0,0);
}
function newModId(){ return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
app.addEventListener('click', function(e){
  var b = e.target.closest('[data-action]'); if (!b) return;
  var a = b.dataset.action, d = view.draft;
  if (a === 'm-open'){ view = {tab:'modules', recipeId:null, editing:false, draft:null, scale:null, modId:b.dataset.id}; render(); window.scrollTo(0,0); }
  else if (a === 'm-back'){ view.modId = null; render(); }
  else if (a === 'open-recipe'){ view = {tab:'recipes', recipeId:b.dataset.id, editing:false, draft:null, scale:null}; render(); window.scrollTo(0,0); }
  else if (a === 'm-new') openModEdit(newModId());
  else if (a === 'm-edit') openModEdit(view.modId, MOD.get(view.modId));
  else if (a === 'm-copy'){ var src = clone(MOD.get(view.modId)); src.name = src.name + '（副本）'; openModEdit(newModId(), src); }
  else if (a === 'm-cancel'){ view.editing = false; view.draft = null; if (!MOD.has(view.modId)) view.modId = null; render(); }
  else if (a === 'm-save'){
    if (!String(d.name).trim()){ toast('先填模块名称。'); return; }
    if (!(num(d.yieldQty) > 0)){ toast('每批产出数量要大于 0。'); return; }
    saveModule(view.modId, {
      name:String(d.name).trim(), yieldQty:num(d.yieldQty), yieldUnit:String(d.yieldUnit || '').trim() || '份',
      items:d.items.filter(function(it){ return it.ingId; }).map(function(it){ return {ingId:it.ingId, amount:num(it.amount)}; }),
      steps:d.steps.filter(function(s){ return String(s.text).trim() || s.temp || s.time; }).map(function(s){
        return {text:String(s.text).trim(), temp:s.temp === '' ? '' : num(s.temp), time:s.time === '' ? '' : num(s.time)}; }),
      notes:String(d.notes || '')
    });
    view.editing = false; view.draft = null; render(); toast('模块已保存。');
  }
  else if (a === 'm-delete'){
    var mid = view.modId, mm = MOD.get(mid), used = modUsage(mid);
    ask(used.length ? '有 ' + used.length + ' 个配方用到「' + mm.name + '」，删除后这些配方会缺这部分成本。确定删除？' : '删除「' + mm.name + '」？', '删除').then(function(ok){
      if (ok){ deleteModule(mid); view.modId = null; render(); toast('模块已删除。'); }
    });
  }
});
app.addEventListener('change', function(e){
  var t = e.target;
  if (t.dataset.k === 'ref' && t.dataset.item != null && view.draft){
    var it = view.draft.items[+t.dataset.item], v = t.value;
    delete it.ingId; delete it.modId;
    if (v.indexOf('m:') === 0) it.modId = v.slice(2); else if (v.indexOf('i:') === 0) it.ingId = v.slice(2);
    render();
  }
});

app.addEventListener('change', function(e){
  var t = e.target, d = view.draft; if (!d) return;
  if (t.hasAttribute('data-blind')){ d.blind = t.checked; return; }
  if (t.dataset.oa != null){
    var it = d.items[+t.dataset.oa]; it.actual = (it.actual || []).slice(); it.actual[+t.dataset.j] = t.value;
  }
});

app.addEventListener('click', function(e){
  var b = e.target.closest('[data-action="launch-week"]'); if (!b || !view.draft) return;
  var d = view.draft;
  if (d.launchPrice === '' || d.launchPrice == null) d.launchPrice = 10;
  d.launchUntil = launchWeekEnd(); render(); toast('已设为本周新品：' + money(num(d.launchPrice)) + '，截止 ' + d.launchUntil + '。保存后生效。');
});

function setMade(name, v, ws){
  ws = ws || weekStart(today());
  var m = PLAN.made = Object.assign({}, PLAN.made || {}), we = addDays(ws, 6), w = {};
  Object.keys(m).forEach(function(k){ if (k >= ws && k <= we){ Object.assign(w, m[k]); if (k !== ws) delete m[k]; } });
  Object.assign(w, m[ws] || {}); m[ws] = w;
  if (v) w[name] = v; else delete w[name];
  var cur = weekStart(today());
  Object.keys(m).forEach(function(k){ if (k < addDays(cur, -35)) delete m[k]; }); /* 只留最近 5 周 */
  savePlan(); render();
}
app.addEventListener('click', function(e){
  var b = e.target.closest('[data-action="pwk"]'); if (!b) return;
  var dd = +b.dataset.d; pOff = dd === 0 ? 0 : pOff + dd; pflt = {place:{}, date:{}}; render();
});
app.addEventListener('change', function(e){
  var el = e.target.closest('[data-made]'); if (!el) return;
  setMade(el.dataset.made, Math.max(0, Math.round(num(el.value))), el.dataset.ws);
});
app.addEventListener('keydown', function(e){
  if (e.key === 'Enter' && e.target.closest('[data-made]')) e.target.blur();
});
app.addEventListener('click', function(e){
  var b = e.target.closest('[data-action="p-made"]'); if (!b) return;
  var ws = weekStart(today()), v = Math.max(0, Math.round(num(b.dataset.v)));
  var m = PLAN.made = Object.assign({}, PLAN.made || {}); var w = m[ws] = Object.assign({}, m[ws] || {});
  if (v) w[b.dataset.name] = v; else delete w[b.dataset.name];
  Object.keys(m).forEach(function(k){ if (k < addDays(ws, -35)) delete m[k]; }); /* 只留最近 5 周 */
  savePlan(); render();
  toast(v ? b.dataset.name + ' 标记为做好了。' : '已改回没做。');
});

/* ---------- remiiibake.com 后台：店主登录 + Google 表格存储 ----------
 * 原「私厨烘焙本」的数据存到 Google 表格的「后台数据」表；网站订单直接读「订单」/「订单存档」表，
 * 在这里勾 已付款 / 已取货 / 删除（= 取消）会同步回表格。 */
var TOKEN_KEY = 'rb-admin-token';
var WEB = new Map();     // 'w_' + 订单号 -> 网站订单原始数据
var ITEMMAP = {};        // 网站商品代号 -> 配方 ID（手动对照过的）
var refreshing = false, pendingWrites = 0, lastLoad = 0;

function token(){ try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
function setToken(t){ try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

function call(action, body){
  var url = window.API_URL || '';
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) return Promise.reject({code:'failed', message:'接口网址没配置好（config.js）'});
  return fetch(url, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify(Object.assign({action:action}, body || {})), redirect:'follow'})
    .then(function(r){ if (!r.ok) throw {code:'unavailable', message:'接口返回错误 ' + r.status}; return r.json(); },
          function(){ throw {code:'unavailable', message:'连不上接口，请检查网络'}; })
    .then(function(j){
      if (j && j.ok) return j.data;
      var msg = (j && j.error) || '出错了';
      if (msg === 'LOGIN_REQUIRED'){ setToken(''); showLogin('登录已过期，请重新登录。'); throw {code:'unauthenticated', message:msg}; }
      throw {code:'failed', message:msg};
    });
}
function adminCall(op, body){ return call('admin', Object.assign({token:token(), op:op}, body || {})); }
function tracked(p){ pendingWrites++; return p.then(function(x){ pendingWrites--; return x; }, function(e){ pendingWrites--; throw e; }); }

/* 原来的 write() 通过 DB.doc(path).set/delete 保存，这里换成调用表格接口 */
DB = {doc:function(path){ return {
  set:function(data){ return tracked(adminCall('put', {path:path, data:data})); },
  delete:function(){ return tracked(adminCall('del', {path:path})); }
}; }};
var baseShowErr = showErr;
showErr = function(e){
  if (e && e.code === 'unauthenticated') return;
  if (e && e.code === 'failed' && e.message){ toast('保存失败：' + e.message); return; }
  baseShowErr(e);
};
function chainRun(key, fn){
  var p = (chains[key] || Promise.resolve()).then(function(){ return tracked(fn()); }).catch(showErr);
  chains[key] = p; return p;
}

/* ---------- 网站订单 ---------- */
function keyOf(name){ return String(name || '').replace(/^\s*[【\[]\s*新品\s*[】\]]\s*/, '').replace(/\s+/g, ' ').trim(); }
function normKey(s){ return String(s || '').replace(/[\s（）()【】\[\]·・,，。.、]/g, '').toLowerCase(); }
function exactRecipe(k){ var hit = ''; REC.forEach(function(r, id){ if (!hit && keyOf(r.name) === k) hit = id; }); return hit; }
function mapRecipe(k){
  if (ITEMMAP[k] && REC.has(ITEMMAP[k])) return ITEMMAP[k];
  var hit = exactRecipe(k); if (hit) return hit;
  var nk = normKey(k), best = '', bestLen = 0;
  REC.forEach(function(r, id){
    var nr = normKey(r.name); if (!nr) return;
    if (nr === nk){ best = id; bestLen = 1e9; return; }
    if ((nk.indexOf(nr) >= 0 || nr.indexOf(nk) >= 0) && nr.length > bestLen){ best = id; bestLen = nr.length; }
  });
  return best;
}
function webOrder(w, ov){
  var items = [], gifts = [];
  (w.items || []).forEach(function(it){
    var k = it.k || keyOf(it.n), rid = mapRecipe(k);
    if (it.g){ gifts.push({recipeId:rid, name:k, qty:num(it.q)}); return; }
    items.push({recipeId:rid, name:k, qty:num(it.q), price:it.p != null ? num(it.p) : null, k:k});
  });
  // 早期订单没有记录单价：先用配方价，剩下的按商品金额平均分
  items.forEach(function(it){ if (it.price == null && REC.has(it.recipeId)) it.price = priceFor(REC.get(it.recipeId), w.date); });
  var known = items.reduce(function(t, it){ return t + (it.price != null ? it.qty * it.price : 0); }, 0);
  var unknownQty = items.reduce(function(t, it){ return t + (it.price == null ? it.qty : 0); }, 0);
  items.forEach(function(it){ if (it.price == null) it.price = unknownQty ? r2(Math.max(0, num(w.goods) - known) / unknownQty) : 0; });
  var notes = [w.note, '网站订单 ' + w.orderId, w.pay + (w.payCur === 'CNY' && w.payAmt ? ' ¥' + w.payAmt : ''), w.promo,
    w.place === '配送' && w.address ? '配送：' + w.address : ''].filter(Boolean).join('；');
  var o = {web:true, webId:w.orderId, webGoods:num(w.goods), webFee:num(w.fee), webAmount:num(w.amount), proofs:w.proofs || [], claimed:!!w.claimed,
    customer:w.name, contact:w.contact, place:w.place, date:w.date, time:w.time, items:items, gifts:gifts, promo:'', notes:notes,
    paid:!!w.paid, picked:!!w.picked, created:w.placedAt || Date.now()};
  if (ov){
    ['customerId', 'customer', 'contact', 'place', 'date', 'time', 'notes'].forEach(function(f){ if (ov[f] != null && ov[f] !== '') o[f] = ov[f]; });
    if (Array.isArray(ov.items) && ov.items.length) o.items = ov.items.map(function(x, i){
      var b = items[i] || {}; return Object.assign({}, b, x, {price:b.price != null ? b.price : num(x.price), k:b.k});
    });
  }
  return o;
}
function webFlags(webId, f){ return chainRun('webflags/' + webId, function(){ return adminCall('webflags', Object.assign({orderId:webId}, f)); }); }

var baseOrderTotal = orderTotal;
orderTotal = function(o){ return o && o.web ? r2(num(o.webGoods)) : baseOrderTotal(o); };

var baseSaveOrder = saveOrder, baseDeleteOrder = deleteOrder;
saveOrder = function(id, obj){
  if (String(id).indexOf('w_') !== 0) return baseSaveOrder(id, obj);
  var cur = ORD.get(id) || {};
  var items = (obj.items || []).map(function(it, i){
    var b = (cur.items || [])[i] || {};
    return Object.assign({}, it, {price:b.price != null ? b.price : it.price, k:b.k});
  });
  var mapChanged = false;
  items.forEach(function(it){
    if (it.k && it.recipeId && ITEMMAP[it.k] !== it.recipeId && exactRecipe(it.k) !== it.recipeId){ ITEMMAP[it.k] = it.recipeId; mapChanged = true; }
  });
  var next = Object.assign({}, cur, obj, {items:items, web:true, webId:cur.webId, webGoods:cur.webGoods, webFee:cur.webFee,
    webAmount:cur.webAmount, proofs:cur.proofs, claimed:cur.claimed, created:cur.created});
  ORD.set(id, next);
  write('weborders/' + cur.webId, {customerId:next.customerId || '', customer:next.customer || '', contact:next.contact || '',
    place:next.place || '', date:next.date || '', time:next.time || '', notes:next.notes || '',
    items:items.map(function(it){ var x = {recipeId:it.recipeId, name:it.name, qty:it.qty}; if (it.actual) x.actual = it.actual; return x; })});
  if (!!cur.paid !== !!next.paid || !!cur.picked !== !!next.picked) webFlags(cur.webId, {paid:!!next.paid, picked:!!next.picked});
  if (mapChanged) write('settings/itemmap', clone(ITEMMAP));
};
deleteOrder = function(id){
  if (String(id).indexOf('w_') !== 0) return baseDeleteOrder(id);
  var cur = ORD.get(id); ORD.delete(id);
  if (cur) webFlags(cur.webId, {cancelled:true});
};
// 网站订单保存前，每样商品都要先对应到配方（否则会被当成空行丢掉）
app.addEventListener('click', function(e){
  var b = e.target.closest('[data-action="o-save"]');
  if (!b || String(view.orderId || '').indexOf('w_') !== 0 || !view.draft) return;
  var miss = (view.draft.items || []).filter(function(it){ return !it.recipeId; });
  if (miss.length){
    e.stopImmediatePropagation();
    toast('「' + miss.map(function(it){ return it.name || '某样商品'; }).join('」「') + '」还没对应到配方，请先在下拉框里选好。');
  }
}, true);
// 订单卡片上：网站标记、顾客说已付、付款截图链接
function webLine(o){
  if (!o.web) return '';
  var bits = ['<span class="tag">网站 ' + esc(o.webId) + '</span>'];
  if (o.claimed && !o.paid) bits.push('<span class="tag" style="background:var(--mango-soft);color:var(--mango)">顾客说已付</span>');
  (o.proofs || []).forEach(function(u, i){
    if (/^https:\/\//.test(u)) bits.push('<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">付款截图' + (o.proofs.length > 1 ? ' ' + (i + 1) : '') + '</a>');
  });
  if (o.webFee) bits.push('<span class="muted">配送费 ' + money(o.webFee) + '</span>');
  return '<div class="small" style="margin:-4px 0 8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' + bits.join('') + '</div>';
}

/* ---------- 登录 ---------- */
function setChrome(on){
  var nav = document.querySelector('nav.tabs'), out = document.getElementById('logoutBtn');
  if (nav) nav.hidden = !on; if (out) out.hidden = !on;
}
function showLogin(msg){
  mode = 'login'; setChrome(false);
  app.className = 'wrap';
  app.innerHTML = '<p class="muted" style="margin-top:24px">正在连接…</p>';
  call('admin_status').then(function(s){ drawLogin(s.configured, msg); }).catch(function(e){ drawLogin(true, msg || e.message); });
}
function drawLogin(configured, msg){
  app.innerHTML = '<form class="login" id="loginForm" style="max-width:380px;margin:40px auto 0">' +
    '<h1 class="page">' + (configured ? '店主登录' : '设置后台密码') + '</h1>' +
    (msg ? '<div class="warn">' + esc(msg) + '</div>' : '') +
    (configured ? '' : '<p class="muted small">在 Google 表格菜单「🥐 remiiibake → 设置 / 重设后台密码」里拿到初始化码（30 分钟内有效）。</p>' +
      '<label class="f" style="margin-top:12px">初始化码<input name="code" autocomplete="off" autocapitalize="characters" required></label>') +
    '<label class="f" style="margin-top:12px">' + (configured ? '密码' : '新密码（至少 8 位）') +
      '<input type="password" name="password" autocomplete="' + (configured ? 'current-password' : 'new-password') + '" required' + (configured ? '' : ' minlength="8"') + '></label>' +
    (configured ? '' : '<label class="f" style="margin-top:12px">再输一次<input type="password" name="password2" autocomplete="new-password" required></label>') +
    '<div class="actions"><button class="btn" type="submit">' + (configured ? '登录' : '设置并登录') + '</button></div>' +
    (configured ? '<p class="muted small" style="margin-top:16px">忘记密码：在 Google 表格菜单「🥐 remiiibake → 设置 / 重设后台密码」重新设置。</p>' : '') +
    '</form>';
  document.getElementById('loginForm').addEventListener('submit', function(e){
    e.preventDefault();
    var f = e.target, btn = f.querySelector('button[type="submit"]'), label = btn.textContent;
    if (!configured && f.password.value !== f.password2.value){ toast('两次输入的密码不一样。'); return; }
    btn.disabled = true; btn.textContent = '请稍候…';
    call(configured ? 'admin_login' : 'admin_setup', configured ? {password:f.password.value} : {code:f.code.value, password:f.password.value})
      .then(function(r){ setToken(r.token); boot(); })
      .catch(function(err){ btn.disabled = false; btn.textContent = label; toast(err.message || '登录失败'); });
  });
}
var baseRender = render;
render = function(){ if (mode === 'login') return; baseRender(); };

/* ---------- 读取数据 ---------- */
function toMap(o){ return new Map(Object.keys(o || {}).map(function(k){ return [k, o[k]]; })); }
function applyData(d){
  var docs = d.docs || {};
  ING = toMap(docs.ingredients); REC = toMap(docs.recipes); MOD = toMap(docs.modules); CUS = toMap(docs.customers);
  PLAN = docs.plan && docs.plan.week ? mergePlan(docs.plan.week) : defaultPlan();
  ITEMMAP = (docs.settings && docs.settings.itemmap) || {};
  ORD = toMap(docs.orders);
  WEB = new Map();
  (d.web || []).forEach(function(w){
    if (w.cancelled) return;
    var id = 'w_' + w.orderId;
    WEB.set(id, w);
    ORD.set(id, webOrder(w, (docs.weborders || {})[w.orderId]));
  });
}
function reload(silent){
  if (refreshing || mode === 'login') return Promise.resolve();
  refreshing = true;
  return adminCall('load').then(function(d){
    if (pendingWrites) return; // 还有没存完的改动，这次先不覆盖
    applyData(d); lastLoad = Date.now();
    mode = 'db'; banner = ''; loaded = {ing:true, rec:true, plan:true, ord:true, cus:true, mod:true};
    if (isEditing() || view.editing) pendingRender = true; else render();
  }).catch(function(e){
    if (e.code === 'unauthenticated') return;
    if (!silent){ banner = '读取数据失败：' + (e.message || '') + '。刷新页面重试。'; if (mode === 'loading') mode = 'db'; render(); }
  }).then(function(){ refreshing = false; });
}
function boot(){
  if (!token()){ showLogin(''); return; }
  setChrome(true); mode = 'loading'; render();
  reload(false);
}
// 回到页面或每 3 分钟，自动拉一次新订单
document.addEventListener('visibilitychange', function(){ if (!document.hidden && mode === 'db' && Date.now() - lastLoad > 30000) reload(true); });
setInterval(function(){ if (!document.hidden && mode === 'db' && !view.editing && !isEditing()) reload(true); }, 180000);
(function(){
  var out = document.getElementById('logoutBtn');
  if (out) out.addEventListener('click', function(){ setToken(''); location.reload(); });
})();
boot();

})();
