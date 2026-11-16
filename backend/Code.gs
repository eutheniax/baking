/**
 * remiiibake 下单系统 —— Google 表格 + Apps Script（网站在 Netlify，这里只做接口）
 *
 * 表格：
 *   设置       店名、本周说明、截单、配送、付款……
 *   取货地点   每个自提点一行：地点 / 楼名 / 地址 / 取货日 / 时间段 / 可配送
 *   分类       一行一个分类：中文名 / 英文名，行的顺序 = 网站上的顺序
 *   本周菜单   上架、分类、名称、介绍、价格、库存（已售自动算）
 *   订单       顾客下单自动写入；勾「已付」「已取货」「已取消」
 *   汇总       应收 / 已收 / 未付订单
 *
 * 表格菜单「🥐 remiiibake」：初始化 / 开始新一周 / 重新计算已售
 * 接口：GET ?action=menu ；POST {action:'order'|'my'|'claim'|'cancel'}
 *
 * 订单表「_data」列：每款一项 { n:下单时的名称, q:数量, p:当时单价, k:商品代号 }，赠品另带 g:1。
 *   k = 去掉【新品】标记后的名称，同一款蛋糕无论是否标新品都算同一个商品（给销量统计用）。
 *   老订单没有 p / k，统计时按 n 现算代号。
 */

/* ============================== 常量 ============================== */

const SHEET = { settings: '设置', places: '取货地点', cats: '分类', menu: '本周菜单', orders: '订单', summary: '汇总' };
const ARCHIVE_PREFIX = '订单存档';
const DAYS = { '周日': 0, '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6 };

// 订单表列（从 1 开始）。新列只能加在最后，老订单才对得上。
const COL = {
  id: 1, time: 2, name: 3, contact: 4, pickup: 5, arrive: 6, detail: 7, qty: 8, amount: 9, pay: 10, note: 11,
  claimed: 12, paid: 13, picked: 14, cancelled: 15, data: 16, promo: 17, proof: 18,
  mode: 19, address: 20, fee: 21, goods: 22, payCur: 23, payAmt: 24, rate: 25,
};
const ORDER_HEADERS = ['订单号', '下单时间', '姓名', '微信/电话', '取货', '预计到达', '明细', '件数', '应付金额(USD)', '付款方式', '备注',
  '顾客说已付', '已付', '已取货', '已取消', '_data', '优惠', '付款凭证',
  '收货方式', '配送地址 / lobby 备注', '配送费', '商品金额', '付款币种', '付款金额', '汇率'];

const MENU_HEADERS = ['上架', '分类', '名称', '介绍', '价格', '库存', '已售', '剩余', '图片链接'];
const M = { on: 0, cat: 1, name: 2, desc: 3, price: 4, stock: 5, sold: 6, left: 7, img: 8 }; // 读取用（从 0 开始）

const PLACE_HEADERS = ['开放', '地点', '楼名', '地址', '取货日', '时间段（多个用逗号隔开）', '可配送', '备注（只给自己看）'];
const P = { on: 0, area: 1, name: 2, address: 3, day: 4, slots: 5, delivery: 6 };
const PLACE_DEFAULTS = [
  [true, 'Midtown', 'Two Worldwide Plaza Condominium', '309 W 49th St, New York, NY 10019', '周四', '12:00pm-5pm', false, ''],
  [true, 'Downtown Brooklyn', 'The Fleet Apartment', '165 Willoughby St, Brooklyn, NY 11201', '周五', '1:00am-5pm，6:30pm-10:30pm', true, ''],
  [true, '哥大', '1440 Amsterdam', '1440 Amsterdam Ave, New York, NY 10027', '周五', '1:00am-5pm，6:30pm-10:30pm', false, ''],
];

const CAT_DEFAULTS = [['盒子蛋糕', 'Box Cakes'], ['六寸蛋糕', '6-inch Cakes'], ['蛋挞', 'Egg Tarts']];

// 设置表每一行：[项目, 默认值, 说明]。缺的行会自动补上；已有的不会被改。
const SETTINGS = [
  ['店名', 'remiiibake', '显示在网站上'],
  ['本周说明', '', '可选：填了就显示在网站首页 This Week 卡片，留空就不显示。{周二} 会自动变成日期，如 11/10；可用 {周日}~{周六}'],
  ['本周日期（周日）', '', '这周从哪个周日开始。「开始新一周」会自动填；订单号也按它编'],
  ['截单时间', '周二 20:00', '到点自动停止接单（纽约时间）；留空 = 不自动截单'],
  ['开放下单', '是', '填「否」立刻暂停接单'],
  ['订单号前缀', 'O', '订单号 = 前缀 + 月份 + 第几周 + -第几单，如 11 月第 2 周第 1 单：O112-1'],
  ['每单最多件数', '10', ''],
  ['满额优惠', '', '一行一档：满多少 | 折扣 | 赠品名称，如「40 | 95折 | 原味蛋挞*2」。留空 = 没有活动'],
  ['配送时间', '周五 5:00-6:30pm', '一行一个时段，开头写周几。配送范围固定为 Downtown Brooklyn 地图'],
  ['配送门槛', '40', '商品满多少美元才可以配送'],
  ['配送费', '5', '地图浅色区域的配送费（深色区域免费）'],
  ['Zelle', '', 'Zelle 手机号或邮箱；留空且没有收款码 = 不开放 Zelle'],
  ['Zelle 收款人', '', ''],
  ['Zelle 收款码', '', '可选：网站 images 文件夹里的文件名，或 Google Drive 分享链接'],
  ['支付宝账号', '', '留空且没有收款码 = 不开放支付宝'],
  ['支付宝收款人', '', ''],
  ['支付宝收款码', '', '可选：images 文件夹里的文件名，或 Google Drive 分享链接'],
  ['支付宝汇率', '6.7', '1 美元 = 多少人民币'],
];
const OBSOLETE_SETTINGS = ['取货选项', 'Venmo', '微信/支付宝', '零头']; // 旧版用的，升级时删掉

// 配送范围（和网站 walking-map 同一份数据，[纬度, 经度]）：FREE_ZONE 免配送费，FEE_ZONE 收配送费
const FREE_ZONE = [[40.696062060912496, -73.98709702730397], [40.69595874956074, -73.98236392798742], [40.69362587941523, -73.98249729737552], [40.69344660390319, -73.97783373105503], [40.6897811875501, -73.9770994594675], [40.6899964080473, -73.9815026259067], [40.6899394624499, -73.9814745913373], [40.6891884719579, -73.981077508282], [40.6889849049046, -73.9809691508984], [40.6889107294444, -73.9809296681413], [40.6889461795292, -73.9810193078554], [40.689154416781, -73.9815544226193], [40.6893662618071, -73.9820988194824], [40.689708072033, -73.9829582832598], [40.6899304235539, -73.9835112617133], [40.6900149712853, -73.9837215513509], [40.6901513313524, -73.9840717812937], [40.6903004249095, -73.9844336034751], [40.6905693981179, -73.9851055607906], [40.6906748657561, -73.9853653595318], [40.6910587628572, -73.9863327914725], [40.6911118640752, -73.9864658034616], [40.6914616302198, -73.9873348845137]];
const FEE_ZONE = [[40.69857, -73.9887], [40.698345, -73.982225], [40.6975145543484, -73.98227498316], [40.6962352715589, -73.9823525950406], [40.69595874956074, -73.98236392798742], [40.69362587941523, -73.98249729737552], [40.69344660390319, -73.97783373105503], [40.6897811875501, -73.9770994594675], [40.6871927939223, -73.9765941233621], [40.6869832898592, -73.9765426952584], [40.6853017336967, -73.9762021164714], [40.6852009621536, -73.9770289285797], [40.6851501500624, -73.977586908141], [40.6851185414545, -73.977948778729], [40.6851185414545, -73.9782156], [40.684923191745, -73.9780787342523], [40.6840605384738, -73.9774586585718], [40.6829804659645, -73.9766680317948], [40.6837525744062, -73.9787051195581], [40.683809449456, -73.9788453735009], [40.6846967009078, -73.9811337126241], [40.6854593894765, -73.9830928203996], [40.6863023615954, -73.985260642788], [40.6871469047526, -73.9874306853002], [40.6880000886927, -73.9896138643656], [40.6885792881273, -73.9910948378081], [40.6891449962871, -73.9907081377413], [40.6891763572029, -73.9905461888149], [40.6897377861729, -73.9901676212154], [40.6903682252281, -73.9897383430413], [40.6910006890999, -73.9893120562279], [40.6914518086974, -73.9891845446205], [40.6921321139187, -73.9890308896501], [40.6928579547619, -73.9889529917362], [40.6943543034281, -73.9888827939806], [40.6962089364011, -73.9888904693936], [40.6973750630924, -73.9887646655101]];

/* ============================== 表格菜单 ============================== */

function onOpen() {
  try { upgrade_(); } catch (e) { /* 升级失败不影响菜单 */ }
  SpreadsheetApp.getUi()
    .createMenu('🥐 remiiibake')
    .addItem('① 初始化表格（只需一次）', 'setup')
    .addItem('开始新一周（归档订单、清零已售、更新日期）', 'startNewWeek')
    .addItem('重新计算已售', 'recalcSold')
    .addToUi();
}

// 勾选/取消「已取消」时，库存自动还回去
function onEdit(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== SHEET.orders) return;
  if (e.range.getColumn() <= COL.cancelled && e.range.getLastColumn() >= COL.cancelled) recalcSold();
}

/* ============================== 初始化 & 升级 ============================== */

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('America/New_York');

  if (!ss.getSheetByName(SHEET.settings)) {
    const s = ss.insertSheet(SHEET.settings, 0);
    s.getRange(1, 1, 1, 3).setValues([['项目', '内容', '说明']]).setFontWeight('bold');
    s.setColumnWidth(1, 140); s.setColumnWidth(2, 360); s.setColumnWidth(3, 420);
    s.getRange('C:C').setFontColor('#888888');
    s.setFrozenRows(1);
  }

  if (!ss.getSheetByName(SHEET.menu)) {
    const m = ss.insertSheet(SHEET.menu, 2);
    m.getRange(1, 1, 1, MENU_HEADERS.length).setValues([MENU_HEADERS]).setFontWeight('bold');
    m.getRange('H1').setFormula('={"剩余";ARRAYFORMULA(IF(C2:C="","",F2:F-G2:G))}');
    m.getRange('A2:A200').insertCheckboxes();
    m.getRange('E2:E200').setNumberFormat('$0.00');
    m.getRange('G2:H200').setBackground('#f3f3f3');
    m.setColumnWidth(2, 90); m.setColumnWidth(3, 260); m.setColumnWidth(4, 340); m.setColumnWidth(9, 200);
    m.setFrozenRows(1);
    m.getRange('K1').setValue('每周改这里：勾「上架」、填分类（盒子蛋糕 / 六寸蛋糕 / 蛋挞…）、价格和库存。名称前写【新品】会显示 NEW 标签。「已售」「剩余」自动算，不要手改。图片链接：images 文件夹里的文件名，或 Google Drive 分享链接；多张用换行隔开。').setFontColor('#888888');
  }

  if (!ss.getSheetByName(SHEET.orders)) {
    const o = ss.insertSheet(SHEET.orders, 3);
    o.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS]).setFontWeight('bold');
    o.setFrozenRows(1);
    o.hideColumns(COL.data);
    o.getRange('B:B').setNumberFormat('m/d h:mm');
    o.getRange('L:L').setNumberFormat('m/d h:mm');
    o.getRange('I:I').setNumberFormat('$0.00');
    o.setColumnWidth(COL.pickup, 220); o.setColumnWidth(COL.detail, 280); o.setColumnWidth(COL.address, 260);
    const rule = SpreadsheetApp.newConditionalFormatRule;
    o.setConditionalFormatRules([
      rule().whenFormulaSatisfied('=$O2=TRUE').setFontColor('#aaaaaa').setStrikethrough(true).setRanges([o.getRange('A2:N1000')]).build(), // 已取消：灰色划线
      rule().whenFormulaSatisfied('=$M2=TRUE').setBackground('#e6f4ea').setRanges([o.getRange('A2:K1000')]).build(),                    // 已付：绿
      rule().whenFormulaSatisfied('=AND($A2<>"",$L2<>"")').setBackground('#fff4d6').setRanges([o.getRange('A2:K1000')]).build(),        // 顾客说已付：黄
      rule().whenFormulaSatisfied('=$A2<>""').setBackground('#fde8e4').setRanges([o.getRange('A2:K1000')]).build(),                     // 未付：红
    ]);
  }

  if (!ss.getSheetByName(SHEET.summary)) {
    const sum = ss.insertSheet(SHEET.summary, 4);
    const O = "'" + SHEET.orders + "'!";
    const live = `(${O}A2:A<>"")*(${O}O2:O<>TRUE)`;
    sum.getRange('A1:B6').setValues([
      ['本周汇总', ''],
      ['有效订单数', `=SUMPRODUCT(${live})`],
      ['应收总额(USD)', `=SUMPRODUCT(${live}*${O}I2:I)`],
      ['已收', `=SUMPRODUCT(${live}*(${O}M2:M=TRUE)*${O}I2:I)`],
      ['未收', '=B3-B4'],
      ['未付订单数', `=SUMPRODUCT(${live}*(${O}M2:M<>TRUE))`],
    ]);
    sum.getRange('A1').setFontWeight('bold').setFontSize(14);
    sum.getRange('B3:B5').setNumberFormat('$0.00');
    sum.getRange('A8').setValue('未付款订单（在「订单」表勾「已付」后自动消失）').setFontWeight('bold');
    sum.getRange('A9:F9').setValues([['订单号', '姓名', '应付(USD)', '付款方式', '付款金额', '顾客说已付']]).setFontWeight('bold');
    sum.getRange('A10').setFormula(`=IFERROR(FILTER({${O}A2:A,${O}C2:C,${O}I2:I,${O}J2:J,${O}X2:X,${O}L2:L},${O}A2:A<>"",${O}M2:M<>TRUE,${O}O2:O<>TRUE),"全部已付 🎉")`);
    sum.getRange('F10:F300').setNumberFormat('m/d h:mm');
  }

  const blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('工作表1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  upgrade_(ss);
  SpreadsheetApp.getUi().alert('初始化完成 ✅\n\n1. 在「设置」填付款信息；2. 在「取货地点」改地点和时间；3. 部署 → 网页应用，把网址填进网站的 config.js。');
}

// 补齐缺的设置行、取货地点表、订单表的新列；删除旧版用不到的设置行。可以重复运行。
function upgrade_(ss) {
  ss = ss || SpreadsheetApp.getActive();

  const s = ss.getSheetByName(SHEET.settings);
  if (s) {
    for (let r = s.getLastRow(); r >= 2; r--) {
      if (OBSOLETE_SETTINGS.indexOf(String(s.getRange(r, 1).getValue()).trim()) >= 0) s.deleteRow(r);
    }
    const have = s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, 1).getValues().map(r => String(r[0]).trim()) : [];
    SETTINGS.forEach(row => {
      if (have.indexOf(row[0]) >= 0) return;
      const r = s.getLastRow() + 1;
      s.getRange(r, 1, 1, 3).setValues([row]);
      s.getRange(r, 2, 1, 2).setWrap(true).setVerticalAlignment('top');
      s.getRange(r, 3).setFontColor('#888888');
    });
    // 旧版前缀（如 R、O4-）换成新编号规则的默认值
    const keys = s.getRange(2, 1, s.getLastRow() - 1, 1).getValues().map(r => String(r[0]).trim());
    const i = keys.indexOf('订单号前缀');
    if (i >= 0 && !/^[A-Za-z]{1,3}$/.test(String(s.getRange(i + 2, 2).getValue()).trim())) {
      s.getRange(i + 2, 2, 1, 2).setValues([['O', SETTINGS.filter(x => x[0] === '订单号前缀')[0][2]]]);
    }
    if (!getSettings_()['本周日期（周日）']) setWeekStart_(ss, defaultWeekStart_());
  }

  if (!ss.getSheetByName(SHEET.places)) {
    const p = ss.insertSheet(SHEET.places, 1);
    p.getRange(1, 1, 1, PLACE_HEADERS.length).setValues([PLACE_HEADERS]).setFontWeight('bold');
    p.getRange(2, 1, PLACE_DEFAULTS.length, PLACE_HEADERS.length).setValues(PLACE_DEFAULTS);
    p.getRange('A2:A20').insertCheckboxes(); p.getRange('G2:G20').insertCheckboxes();
    p.getRange(2, 1, PLACE_DEFAULTS.length, 1).setValues(PLACE_DEFAULTS.map(r => [r[0]]));
    p.getRange(2, 7, PLACE_DEFAULTS.length, 1).setValues(PLACE_DEFAULTS.map(r => [r[6]]));
    p.setColumnWidth(2, 150); p.setColumnWidth(3, 230); p.setColumnWidth(4, 300); p.setColumnWidth(6, 280);
    p.setFrozenRows(1);
    p.getRange('J1').setValue('每周改这里：不开的地点取消勾选「开放」；时间段写法如「11:00am-5pm，6:30pm-10:30pm」，网站会自动加上日期。「可配送」只对 Downtown Brooklyn 有意义（配送范围是地图）。').setFontColor('#888888');
  }

  if (!ss.getSheetByName(SHEET.cats)) {
    const c = ss.insertSheet(SHEET.cats, 2);
    c.getRange(1, 1, 1, 2).setValues([['分类（和「本周菜单」里写的一样）', '英文名']]).setFontWeight('bold');
    c.getRange(2, 1, CAT_DEFAULTS.length, 2).setValues(CAT_DEFAULTS);
    c.setColumnWidth(1, 240); c.setColumnWidth(2, 200); c.setFrozenRows(1);
    c.getRange('D1').setValue('上下拖动行就能调整网站上分类的顺序。菜单里用了、这里没写的分类会排在最后，英文名显示默认值。').setFontColor('#888888');
  }

  const o = ss.getSheetByName(SHEET.orders);
  if (o && o.getRange(1, COL.rate).getValue() !== '汇率') {
    if (o.getMaxColumns() < COL.rate) o.insertColumnsAfter(o.getMaxColumns(), COL.rate - o.getMaxColumns());
    o.getRange(1, COL.promo, 1, COL.rate - COL.promo + 1).setValues([ORDER_HEADERS.slice(COL.promo - 1, COL.rate)]).setFontWeight('bold');
  }
}

/* ============================== 读取表格 ============================== */

function getSettings_() {
  const s = SpreadsheetApp.getActive().getSheetByName(SHEET.settings);
  const out = {};
  if (!s || s.getLastRow() < 2) return out;
  s.getRange(2, 1, s.getLastRow() - 1, 2).getDisplayValues().forEach(r => { if (r[0]) out[String(r[0]).trim()] = String(r[1]).trim(); });
  return out;
}

// 分类表：[{ zh, en }]，按表格里的顺序
function readCats_(ss) {
  const c = ss.getSheetByName(SHEET.cats);
  if (!c || c.getLastRow() < 2) return [];
  return c.getRange(2, 1, c.getLastRow() - 1, 2).getDisplayValues()
    .map(r => ({ zh: String(r[0]).trim(), en: String(r[1]).trim() })).filter(x => x.zh);
}

function readMenu_(ss) {
  const m = ss.getSheetByName(SHEET.menu);
  if (!m || m.getLastRow() < 2) return [];
  const sold = countSold_(ss);
  return m.getRange(2, 1, m.getLastRow() - 1, MENU_HEADERS.length).getValues()
    .filter(r => r[M.on] === true && String(r[M.name]).trim())
    .map(r => {
      const name = String(r[M.name]).trim();
      return {
        cat: String(r[M.cat] || '').trim() || '其他',
        name: name,
        desc: String(r[M.desc] || ''),
        price: Number(r[M.price]) || 0,
        left: Math.max((Number(r[M.stock]) || 0) - (sold[name] || 0), 0), // 只用来限制数量，网站不显示
        imgs: images_(r[M.img]),
      };
    });
}

// 「周五」+ 本周日期 → 「周五 11/13」
function dayLabel_(day, start) {
  const ymd = addDays_(start, DAYS[day]);
  return day + ' ' + Number(ymd.slice(5, 7)) + '/' + Number(ymd.slice(8, 10));
}
function splitSlots_(text) {
  return String(text || '').split(/[,，;；、\n]+/).map(x => x.trim().replace(/\s*[-–~～]\s*/g, '–')).filter(Boolean);
}

// 开放的取货地点，时间段带上日期：{ id, area, name, address, slots:['周五 11/13 11:00am–5pm', …], delivery }
function readPlaces_(ss, st) {
  const p = ss.getSheetByName(SHEET.places);
  if (!p || p.getLastRow() < 2) return [];
  const start = weekStart_(st);
  return p.getRange(2, 1, p.getLastRow() - 1, PLACE_HEADERS.length).getDisplayValues()
    .filter(r => r[P.on] === 'TRUE' && String(r[P.area]).trim())
    .map(r => {
      const day = String(r[P.day]).trim();
      const prefix = DAYS[day] === undefined ? day : dayLabel_(day, start);
      return {
        id: String(r[P.area]).trim(),
        area: String(r[P.area]).trim(),
        name: String(r[P.name]).trim(),
        address: String(r[P.address]).trim(),
        slots: splitSlots_(r[P.slots]).map(t => (prefix ? prefix + ' ' : '') + t),
        delivery: r[P.delivery] === 'TRUE',
      };
    })
    .filter(x => x.slots.length);
}

// 配送：设置里的「配送时间」每行开头写周几
function readDelivery_(st, places) {
  const start = weekStart_(st);
  const slots = String(st['配送时间'] || '').split(/\n|[;；]/).map(x => x.trim()).filter(Boolean).map(line => {
    const m = line.match(/^(周[日一二三四五六])\s*(.*)$/);
    return m ? dayLabel_(m[1], start) + ' ' + m[2].replace(/\s*[-–~～]\s*/g, '–') : line;
  });
  const areas = places.filter(x => x.delivery).map(x => x.area);
  return {
    enabled: areas.length > 0 && slots.length > 0,
    areas: areas,
    slots: slots,
    min: Number(st['配送门槛']) || 0,
    fee: Number(st['配送费']) || 0,
  };
}

/* ============================== 付款 / 优惠 / 配送范围 ============================== */

function payConfig_(st) {
  return {
    alipay: { label: '支付宝 · 人民币', currency: 'CNY', rate: Number(st['支付宝汇率']) || 6.7, recipient: st['支付宝收款人'] || '', account: st['支付宝账号'] || '', qrImage: images_(st['支付宝收款码'])[0] || '' },
    zelle: { label: 'Zelle · 美元', currency: 'USD', rate: 1, recipient: st['Zelle 收款人'] || '', account: st['Zelle'] || '', qrImage: images_(st['Zelle 收款码'])[0] || '' },
  };
}
function convert_(usd, rate) { return Math.round(Math.round(usd * 100) * rate) / 100; }
function payKeyFromLabel_(label, cfg) {
  label = String(label || '');
  return Object.keys(cfg).filter(k => cfg[k].label === label)[0] || (/zelle/i.test(label) ? 'zelle' : /支付宝/.test(label) ? 'alipay' : '');
}

// 「40 | 95折 | 原味蛋挞*2」→ { min:40, rate:0.95, gift:'原味蛋挞*2' }
function promos_(st) {
  return String(st['满额优惠'] || '').split(/\n/).map(line => {
    const p = line.split(/[|｜]/).map(x => x.trim());
    const min = Number(String(p[0] || '').replace(/[^\d.]/g, ''));
    const zhe = String(p[1] || '').match(/^(\d+(?:\.\d+)?)\s*折$/);
    let rate = zhe ? Number(zhe[1]) / (Number(zhe[1]) >= 10 ? 100 : 10) : Number(p[1]);
    if (!(rate > 0 && rate < 1)) rate = 0;
    return { min: min, rate: rate, gift: String(p[2] || '') };
  }).filter(x => x.min > 0 && (x.rate || x.gift)).sort((a, b) => a.min - b.min);
}
function rateLabel_(rate) { const z = Math.round(rate * 100); return (z % 10 === 0 ? z / 10 : z) + '折'; }

function inPoly_(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (((a[0] > lat) !== (b[0] > lat)) && (lon < (b[1] - a[1]) * (lat - a[0]) / (b[0] - a[0]) + a[1])) inside = !inside;
  }
  return inside;
}
function zoneOf_(lat, lon) { return inPoly_(lat, lon, FREE_ZONE) ? 'free' : inPoly_(lat, lon, FEE_ZONE) ? 'paid' : 'outside'; }

// 服务器自己用 Google 地图查地址（不相信网页传来的坐标）
function geocode_(address) {
  const q = /brooklyn|new york|\bny\b/i.test(address) ? address : address + ', Brooklyn, NY';
  const cache = CacheService.getScriptCache();
  const key = 'geo:' + hash_(q.toLowerCase());
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const res = Maps.newGeocoder().setRegion('us').setBounds(40.67, -74.01, 40.71, -73.96).geocode(q);
  let out = null;
  if (res && res.status === 'OK' && res.results && res.results.length) {
    const r = res.results[0];
    const exact = (r.types || []).some(t => ['street_address', 'premise', 'subpremise'].indexOf(t) >= 0) &&
      ['ROOFTOP', 'RANGE_INTERPOLATED'].indexOf(r.geometry.location_type) >= 0;
    if (exact) out = { address: r.formatted_address, lat: r.geometry.location.lat, lon: r.geometry.location.lng };
  }
  cache.put(key, JSON.stringify(out), 21600);
  return out;
}

/* ============================== 日期 & 周 ============================== */

function tz_() { return SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'America/New_York'; }
function addDays_(ymd, n) {
  const p = ymd.split('-').map(Number);
  return Utilities.formatDate(new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)), 'UTC', 'yyyy-MM-dd');
}
// 周日~周四 = 本周的周日；周五/周六 = 下一个周日（提前准备下周）
function defaultWeekStart_() {
  const now = new Date();
  const today = Utilities.formatDate(now, tz_(), 'yyyy-MM-dd');
  const dow = Number(Utilities.formatDate(now, tz_(), 'u')) % 7;
  return dow >= 5 ? addDays_(today, 7 - dow) : addDays_(today, -dow);
}
function weekStart_(st) {
  const v = String(st['本周日期（周日）'] || '');
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Utilities.formatDate(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), 'UTC', 'yyyy-MM-dd');
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return Utilities.formatDate(new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])), 'UTC', 'yyyy-MM-dd');
  return defaultWeekStart_();
}
function setWeekStart_(ss, ymd) {
  const s = ss.getSheetByName(SHEET.settings);
  const keys = s.getRange(2, 1, s.getLastRow() - 1, 1).getValues().map(r => String(r[0]).trim());
  const i = keys.indexOf('本周日期（周日）');
  if (i >= 0) s.getRange(i + 2, 2).setNumberFormat('@').setValue(ymd);
}
// 「{周二}」→「11/10」，「{周六日}」→「14」
function fillDates_(text, start) {
  return String(text || '').replace(/\{(周[日一二三四五六])(日?)\}/g, (_, day, onlyDay) => {
    const ymd = addDays_(start, DAYS[day]);
    return onlyDay ? String(Number(ymd.slice(8, 10))) : Number(ymd.slice(5, 7)) + '/' + Number(ymd.slice(8, 10));
  });
}
// 截单时间「周二 20:00」→ { at:'2026-11-10 20:00', label:'周二 11/10 8:00 PM' }
function cutoff_(st) {
  const m = String(st['截单时间'] || '').match(/(周[日一二三四五六])\s*(\d{1,2})[:：](\d{2})/);
  if (!m) return null;
  const h = Number(m[2]);
  return {
    at: addDays_(weekStart_(st), DAYS[m[1]]) + ' ' + ('0' + h).slice(-2) + ':' + m[3],
    label: dayLabel_(m[1], weekStart_(st)) + ' ' + ((h + 11) % 12 + 1) + ':' + m[3] + (h < 12 ? ' AM' : ' PM'),
  };
}
function isOpen_(st) {
  if ((st['开放下单'] || '是') === '否') return false;
  const c = cutoff_(st);
  return !c || Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm') < c.at;
}

// 订单号：前缀 + 月份 + 这个月第几个周日 + '-' + 本周第几单。11/8 那周第 1 单 = O112-1
function nextOrderId_(st, existingIds) {
  const start = weekStart_(st);
  const prefix = (String(st['订单号前缀'] || '').match(/[A-Za-z]+/) || ['O'])[0];
  const base = prefix + Number(start.slice(5, 7)) + Math.ceil(Number(start.slice(8, 10)) / 7) + '-';
  const props = PropertiesService.getScriptProperties();
  const key = 'seq:' + start;
  let n = Number(props.getProperty(key) || 0);
  do { n++; } while (existingIds.indexOf(base + n) >= 0);
  props.setProperty(key, String(n));
  return base + n;
}

/* ============================== 每周操作 ============================== */

function startNewWeek() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const next = defaultWeekStart_();
  const ok = ui.alert('开始新一周？',
    '本周订单会复制到「' + ARCHIVE_PREFIX + '」表，然后清空订单、已售清零。\n新一周从 ' + next + '（周日）开始，订单号从 1 重新编。',
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const o = ss.getSheetByName(SHEET.orders);
    if (o.getLastRow() > 1) {
      const name = ARCHIVE_PREFIX + ' ' + weekStart_(getSettings_());
      const copy = o.copyTo(ss).setName(ss.getSheetByName(name) ? name + ' ' + Utilities.formatDate(new Date(), tz_(), 'HHmm') : name);
      ss.setActiveSheet(copy); ss.moveActiveSheet(ss.getSheets().length);
      const r = o.getRange(2, 1, o.getMaxRows() - 1, ORDER_HEADERS.length);
      r.clearContent(); r.clearDataValidations();
    }
    const m = ss.getSheetByName(SHEET.menu);
    if (m.getLastRow() > 1) m.getRange(2, M.sold + 1, m.getLastRow() - 1, 1).setValue(0);
    setWeekStart_(ss, next);
    ss.setActiveSheet(m);
  } finally {
    lock.releaseLock();
  }
  ui.alert('好了 ✅\n去「本周菜单」改蛋糕和库存，去「取货地点」改这周的取货时间。\n「开放下单」如果是「否」，记得改回「是」。');
}

// 按「订单」表（不算已取消）重新统计每款已售
function recalcSold() {
  const ss = SpreadsheetApp.getActive();
  upgrade_(ss);
  const counts = countSold_(ss);
  const m = ss.getSheetByName(SHEET.menu);
  if (m.getLastRow() < 2) return;
  const names = m.getRange(2, M.name + 1, m.getLastRow() - 1, 1).getValues();
  m.getRange(2, M.sold + 1, names.length, 1).setValues(names.map(r => [counts[String(r[0]).trim()] || 0]));
}

function countSold_(ss) {
  const o = ss.getSheetByName(SHEET.orders);
  const counts = {};
  if (!o || o.getLastRow() < 2) return counts;
  o.getRange(2, 1, o.getLastRow() - 1, ORDER_HEADERS.length).getValues().forEach(r => {
    if (!r[COL.id - 1] || r[COL.cancelled - 1] === true) return;
    try { JSON.parse(r[COL.data - 1] || '[]').forEach(it => { counts[it.n] = (counts[it.n] || 0) + Number(it.q); }); } catch (e) { /* 手动改坏的行跳过 */ }
  });
  return counts;
}

/* ============================== 接口 ============================== */

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'menu') return json_(run_(getPublicData));
  return json_({ ok: true, data: 'remiiibake api' });
}

function doPost(e) {
  const raw = e && e.postData && e.postData.contents;
  if (!raw || raw.length > 3000000) return json_({ ok: false, error: '请求太大了，请换一张小一点的截图' });
  let body;
  try { body = JSON.parse(raw); } catch (err) { return json_({ ok: false, error: '请求无效' }); }
  if (!body || typeof body !== 'object' || body.website) return json_({ ok: false, error: '请求无效' }); // website = 防机器人隐藏栏
  if (body.action !== 'claim' && raw.length > 8000) return json_({ ok: false, error: '请求无效' });
  const fn = { order: placeOrder, my: myOrders, claim: claimPaid, cancel: cancelOrder }[body.action];
  return json_(fn ? run_(() => fn(body)) : { ok: false, error: '请求无效' });
}

function run_(fn) {
  try { return { ok: true, data: fn() }; }
  catch (err) { return { ok: false, error: String(err && err.message || err).slice(0, 200) }; }
}
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/* ============================== 小工具 ============================== */

function hash_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)).slice(0, 22); }
function norm_(s) { return String(s || '').toLowerCase().replace(/[\s\-()（）+]/g, ''); }
// 商品代号：去掉名称开头的【新品】/[新品] 标记和多余空格
function itemKey_(name) { return String(name || '').replace(/^\s*[【\[]\s*新品\s*[】\]]\s*/, '').replace(/\s+/g, ' ').trim(); }
// 防止有人在姓名、备注里写 =公式
function safe_(v) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
// 同一个 key 在 windowSec 秒内最多 max 次
function rateLimit_(key, max, windowSec, msg) {
  const cache = CacheService.getScriptCache();
  const k = 'rl:' + hash_(key);
  const n = Number(cache.get(k) || 0);
  if (n >= max) throw new Error(msg || '操作太频繁，请稍后再试');
  cache.put(k, String(n + 1), windowSec);
}
// 图片：Google Drive 分享链接 / https 链接 / images 文件夹里的文件名；多张用换行隔开
function images_(cell) {
  return String(cell || '').split(/[\n;；,，\s]+/).map(x => x.trim()).filter(Boolean).map(u => {
    const drive = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/);
    if (drive) return 'https://lh3.googleusercontent.com/d/' + drive[1] + '=w1200';
    if (/^https:\/\/[^\s"'<>]+$/i.test(u)) return u;
    if (/^[\w\-. ]+\.(jpe?g|png|webp|gif|avif)$/i.test(u)) return 'images/' + encodeURIComponent(u);
    return '';
  }).filter(Boolean).slice(0, 6);
}

/* ============================== 菜单 ============================== */

function getPublicData() {
  const ss = SpreadsheetApp.getActive();
  const st = getSettings_();
  const places = readPlaces_(ss, st);
  const c = cutoff_(st);
  return {
    shop: st['店名'] || 'remiiibake',
    notice: fillDates_(st['本周说明'] || '', weekStart_(st)),
    open: isOpen_(st),
    cutoff: c ? c.label : '',
    maxQty: Number(st['每单最多件数']) || 10,
    capabilities: { fulfillmentV2: true },
    locations: places,
    delivery: readDelivery_(st, places),
    payments: payConfig_(st),
    categories: readCats_(ss),
    promos: promos_(st).map(x => ({ min: x.min, rate: x.rate, rateLabel: x.rate ? rateLabel_(x.rate) : '', gift: x.gift })),
    pickups: [], // 旧版网站用的字段，保留为空
    menu: readMenu_(ss),
  };
}

/* ============================== 下单 ============================== */

function placeOrder(form) {
  const ss = SpreadsheetApp.getActive();
  const st = getSettings_();
  if (!isOpen_(st)) throw new Error('本周已截单，下周早点来哦～');
  rateLimit_('order:all', 60, 600, '现在下单的人太多了，请过几分钟再试');

  const name = String(form.name || '').trim().slice(0, 40);
  const contact = String(form.contact || '').trim().slice(0, 60);
  const arrive = String(form.arrive || '').trim().slice(0, 40);
  const note = String(form.note || '').trim().slice(0, 200);
  if (!name || !contact) throw new Error('请填写微信昵称和电话');

  // 付款方式
  const cfg = payConfig_(st);
  const payKey = String(form.payment && form.payment.method || payKeyFromLabel_(form.pay, cfg));
  const pm = cfg[payKey];
  if (!pm) throw new Error('请选择付款方式');
  if (!pm.account && !pm.qrImage) throw new Error('该付款方式暂未开放，请联系店主。');

  // 收货方式（地点和时间以表格为准）
  const places = readPlaces_(ss, st);
  const delivery = readDelivery_(st, places);
  const f = form.fulfillment && typeof form.fulfillment === 'object' ? form.fulfillment : {};
  const mode = f.mode === 'delivery' ? 'delivery' : 'pickup';
  let place = null, deliverTo = null, unit = '', slot = '', pickupText = '';
  if (mode === 'pickup') {
    place = places.filter(x => x.id === String(f.location || ''))[0];
    slot = String(f.pickup || '');
    if (!place || place.slots.indexOf(slot) < 0) throw new Error('请选择自提地点和时间（页面可能过期，请刷新）');
    pickupText = place.area + ' · ' + slot;
  } else {
    if (!delivery.enabled) throw new Error('本周暂不配送，请选择自提');
    slot = String(f.deliveryTime || '');
    if (delivery.slots.indexOf(slot) < 0) throw new Error('请选择配送时间（页面可能过期，请刷新）');
    unit = String(f.unit || '').trim().slice(0, 80);
    const addr = String((f.match && f.match.address) || f.address || '').trim().slice(0, 180);
    if (!/^\d+[\w-]*\s+\S+/.test(addr)) throw new Error('请填写完整的配送地址（门牌号 + 街道）');
    rateLimit_('geo:' + norm_(contact), 15, 3600, '查询地址太频繁了，请稍后再试');
    const g = geocode_(addr);
    if (!g) throw new Error('地址无法确认，请检查门牌号和街道，或联系店主');
    const zone = zoneOf_(g.lat, g.lon);
    if (zone === 'outside') throw new Error('这个地址不在配送范围内，请选择自提或更换地址');
    deliverTo = { address: g.address, zone: zone };
    pickupText = '配送（仅送 lobby） · ' + slot + ' · ' + g.address + (unit ? ' · ' + unit : '');
  }

  // 商品（同名合并）
  const merged = {};
  (Array.isArray(form.items) ? form.items : []).slice(0, 50).forEach(it => {
    const n = String(it && it.name || '').slice(0, 100), q = Math.floor(Number(it && it.qty));
    if (n && q > 0 && q <= 100) merged[n] = (merged[n] || 0) + q;
  });
  const want = Object.keys(merged).map(n => ({ n: n, q: merged[n] }));
  if (!want.length) throw new Error('还没选甜品哦');
  const total = want.reduce((a, b) => a + b.q, 0);
  const maxQty = Number(st['每单最多件数']) || 10;
  if (total > maxQty) throw new Error('一个订单最多 ' + maxQty + ' 件');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // 库存和价格以表格为准
    const byName = {};
    readMenu_(ss).forEach(x => { byName[x.name] = x; });
    let subtotal = 0;
    want.forEach(it => {
      const item = byName[it.n];
      if (!item) throw new Error('「' + it.n + '」已下架，请刷新页面');
      if (item.left < it.q) throw new Error(item.left ? '「' + it.n + '」库存不够了，最多还能订 ' + item.left + ' 份' : '「' + it.n + '」刚刚售罄了');
      it.p = item.price;      // 当时单价：以后改价不影响这张订单的统计
      it.k = itemKey_(it.n);  // 商品代号
      subtotal += item.price * it.q;
    });
    subtotal = Math.round(subtotal * 100) / 100;

    // 满额优惠（设置里留空 = 没有）：最高一档，折扣 / 赠品二选一
    let goods = subtotal, promoText = '', gift = null;
    const tier = promos_(st).filter(x => subtotal >= x.min).pop();
    if (tier) {
      let choice = form.promo === 'gift' || form.promo === 'rate' ? form.promo : (tier.rate ? 'rate' : 'gift');
      if (choice === 'rate' && !tier.rate) choice = 'gift';
      if (choice === 'gift' && !tier.gift) choice = 'rate';
      if (choice === 'gift') {
        const g = byName[tier.gift];
        if (!g || g.left < (merged[tier.gift] || 0) + 1) throw new Error('赠品「' + tier.gift + '」已经送完了' + (tier.rate ? '，请改选' + rateLabel_(tier.rate) : ''));
        gift = { n: tier.gift, q: 1, g: 1, p: 0, k: itemKey_(tier.gift) };
        promoText = '满$' + tier.min + ' 送' + tier.gift;
      } else {
        goods = Math.round(subtotal * tier.rate * 100) / 100;
        promoText = '满$' + tier.min + ' ' + rateLabel_(tier.rate) + '（−$' + (subtotal - goods).toFixed(2) + '）';
      }
    }

    // 配送费由服务器按地址区域决定；门槛按优惠后的商品金额
    const fee = deliverTo && deliverTo.zone === 'paid' ? delivery.fee : 0;
    if (deliverTo && goods < delivery.min) throw new Error('商品满 $' + delivery.min + ' 才可配送，还差 $' + (delivery.min - goods).toFixed(2));
    const amount = Math.round((goods + fee) * 100) / 100;
    const payAmount = convert_(amount, pm.rate);

    upgrade_(ss);
    const o = ss.getSheetByName(SHEET.orders);
    const existing = o.getLastRow() >= 2 ? o.getRange(2, 1, o.getLastRow() - 1, ORDER_HEADERS.length).getValues() : [];

    // 同一个联系方式 1 小时最多成功下 5 单（失败的尝试不算）
    rateLimit_('order:' + norm_(contact), 5, 3600, '你刚刚已经下过几单了，如需修改请直接联系店主');
    const orderId = nextOrderId_(st, existing.map(r => String(r[COL.id - 1])));

    const detail = want.map(it => it.n + ' ×' + it.q).join('；') + (gift ? '；🎁 ' + gift.n + ' ×1（赠品）' : '');
    let row = 2;
    existing.forEach((r, i) => { if (r[0]) row = i + 3; });
    o.getRange(row, 1, 1, ORDER_HEADERS.length).setValues([[
      orderId, new Date(), safe_(name), safe_(contact), safe_(pickupText), safe_(arrive), safe_(detail), total, amount, pm.label, safe_(note),
      '', false, false, false, JSON.stringify(gift ? want.concat([gift]) : want), promoText, '',
      mode === 'delivery' ? '配送' : '自提 · ' + place.area,
      deliverTo ? safe_(deliverTo.address + (unit ? ' ｜ lobby 备注：' + unit : '')) : '',
      fee, goods, pm.currency, payAmount, pm.rate,
    ]]);
    o.getRange(row, COL.paid, 1, 3).insertCheckboxes();
    SpreadsheetApp.flush();
    recalcSold();

    return {
      orderId: orderId, amount: amount, subtotal: subtotal, goods: goods, deliveryFee: fee, detail: detail, promo: promoText,
      pickup: pickupText, arrive: arrive, pay: pm.label, payInfo: pm.account,
      fulfillment: { mode: mode, location: place ? place.id : '', pickup: place ? slot : '', deliveryTime: deliverTo ? slot : '',
        address: deliverTo ? deliverTo.address : '', unit: unit, zone: deliverTo ? deliverTo.zone : '' },
      payment: { method: payKey, label: pm.label, currency: pm.currency, rate: pm.rate, amount: payAmount, usdAmount: amount,
        recipient: pm.recipient, account: pm.account, qrImage: pm.qrImage },
    };
  } finally {
    lock.releaseLock();
  }
}

/* ============================== 我的订单 ============================== */

// 用「姓名 + 微信/电话」查订单（本周 + 最近 6 周存档）
function myOrders(form) {
  const name = norm_(form && form.name);
  const contact = norm_(form && form.contact);
  if (!name || !contact) throw new Error('请填写下单时用的微信昵称和电话');
  rateLimit_('my:' + contact, 20, 600);
  rateLimit_('my:all', 300, 600);
  const ss = SpreadsheetApp.getActive();
  const st = getSettings_();
  const cfg = payConfig_(st);
  const open = isOpen_(st);
  const sheets = [ss.getSheetByName(SHEET.orders)].concat(
    ss.getSheets().filter(s => s.getName().indexOf(ARCHIVE_PREFIX) === 0).sort((a, b) => a.getName() < b.getName() ? 1 : -1).slice(0, 6));
  const out = [];
  sheets.forEach((sh, idx) => {
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, ORDER_HEADERS.length).getValues().forEach(r => {
      if (!r[COL.id - 1] || norm_(r[COL.name - 1]) !== name || norm_(r[COL.contact - 1]) !== contact) return;
      const pk = payKeyFromLabel_(r[COL.pay - 1], cfg), pc = cfg[pk];
      const usd = Number(r[COL.amount - 1]) || 0;
      const cur = String(r[COL.payCur - 1] || (pc ? pc.currency : ''));
      const rate = Number(r[COL.rate - 1]) || (pc ? pc.rate : 1);
      const isDelivery = String(r[COL.mode - 1]) === '配送';
      out.push({
        orderId: String(r[COL.id - 1]),
        time: r[COL.time - 1] instanceof Date ? r[COL.time - 1].getTime() : 0,
        detail: String(r[COL.detail - 1]),
        pickup: String(r[COL.pickup - 1]),
        arrive: String(r[COL.arrive - 1]),
        amount: usd,
        pay: String(r[COL.pay - 1]),
        payInfo: pc ? pc.account : '',
        payment: pc ? { method: pk, label: pc.label, currency: cur, rate: rate, amount: Number(r[COL.payAmt - 1]) || convert_(usd, cur === 'CNY' ? rate : 1),
          usdAmount: usd, recipient: pc.recipient, account: pc.account, qrImage: pc.qrImage } : null,
        goods: r[COL.goods - 1] === '' ? usd : Number(r[COL.goods - 1]) || 0,
        deliveryFee: Number(r[COL.fee - 1]) || 0,
        fulfillment: { mode: isDelivery ? 'delivery' : 'pickup', address: isDelivery ? String(r[COL.address - 1]) : '' },
        promo: String(r[COL.promo - 1] || ''),
        claimed: !!r[COL.claimed - 1],
        hasProof: !!r[COL.proof - 1],
        paid: r[COL.paid - 1] === true,
        picked: r[COL.picked - 1] === true,
        cancelled: r[COL.cancelled - 1] === true,
        current: idx === 0,
        canCancel: idx === 0 && open && r[COL.cancelled - 1] !== true && r[COL.picked - 1] !== true,
      });
    });
  });
  return out.sort((a, b) => b.time - a.time);
}

// 本周订单里属于这个顾客的那一行
function findMyOrder_(o, form) {
  const name = norm_(form && form.name), contact = norm_(form && form.contact);
  const id = String(form && form.orderId || '').slice(0, 20);
  if (!name || !contact || !id || o.getLastRow() < 2) throw new Error('找不到这个订单');
  const vals = o.getRange(2, 1, o.getLastRow() - 1, ORDER_HEADERS.length).getValues();
  for (let i = 0; i < vals.length; i++) {
    const r = vals[i];
    if (String(r[COL.id - 1]) === id && norm_(r[COL.name - 1]) === name && norm_(r[COL.contact - 1]) === contact) return { row: i + 2, r: r };
  }
  throw new Error('找不到这个订单（只能操作本周的订单）');
}

// 付款截图存到你 Google Drive 的「remiiibake 付款凭证」文件夹（不公开）
function proofFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('proofFolder');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 被删了就重建 */ } }
  const f = DriveApp.createFolder('remiiibake 付款凭证');
  props.setProperty('proofFolder', f.getId());
  return f;
}

function claimPaid(form) {
  rateLimit_('claim:' + norm_(form && form.contact), 10, 600);
  const m = String(form && form.image || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('请先选择付款截图');
  const bytes = Utilities.base64Decode(m[1]);
  if (bytes.length > 2000000 || bytes.length < 1000 || (bytes[0] & 255) !== 0xFF || (bytes[1] & 255) !== 0xD8) throw new Error('截图格式不对，请换一张');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const o = SpreadsheetApp.getActive().getSheetByName(SHEET.orders);
    const f = findMyOrder_(o, form);
    if (f.r[COL.cancelled - 1] === true) throw new Error('这个订单已经取消了');
    if (f.r[COL.paid - 1] === true) throw new Error('店主已经确认收款啦');
    const file = proofFolder_().createFile(Utilities.newBlob(bytes, 'image/jpeg', f.r[COL.id - 1] + '_' + Utilities.formatDate(new Date(), tz_(), 'MMdd-HHmm') + '.jpg'));
    o.getRange(f.row, COL.claimed).setValue(new Date());
    o.getRange(f.row, COL.proof).setValue(file.getUrl());
    return true;
  } finally {
    lock.releaseLock();
  }
}

// 顾客自己取消：只能在截单前
function cancelOrder(form) {
  rateLimit_('cancel:' + norm_(form && form.contact), 10, 600);
  if (!isOpen_(getSettings_())) throw new Error('已经截单了，不能自己取消。如需修改或取消，请直接联系店主');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const o = SpreadsheetApp.getActive().getSheetByName(SHEET.orders);
    const f = findMyOrder_(o, form);
    if (f.r[COL.cancelled - 1] === true) return true;
    if (f.r[COL.picked - 1] === true) throw new Error('这个订单已经取货了');
    const prev = String(f.r[COL.note - 1] || '');
    o.getRange(f.row, COL.cancelled).setValue(true);
    o.getRange(f.row, COL.note).setValue(safe_(prev + (prev ? '；' : '') + '顾客自己取消 ' + Utilities.formatDate(new Date(), tz_(), 'M/d HH:mm')));
    SpreadsheetApp.flush();
    recalcSold();
    return true;
  } finally {
    lock.releaseLock();
  }
}