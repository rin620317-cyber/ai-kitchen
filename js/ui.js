// 画面描画・シート・オーバーレイ・操作ハンドラ。
import { ic } from './icons.js';
import { todayLabel, clockLabel, ageLabel, birthLabel, expiryInfo, daysUntil, esc, CATEGORIES, guessCategory, estimateExpiry } from './util.js';
import * as store from './store.js';
import { buildContext, generateRecipes, extractReceiptItems, SAMPLE_RECIPES } from './api.js';
import { APP_VERSION } from './version.js';
import * as sync from './sync.js';

let curTab = 'home';
let segIndex = 0;
let curRecipes = [];   // 献立タブに表示中のレシピ群
let curRecipe = null;  // レシピ詳細で開いている1件
let makeCtx = null;    // 「作った」更新シートの状態
let gen = { loading: false, error: '' };
let nutriDemo = 'male';  // 栄養バーの対象（男性/女性/子ども/シニア）
let rcptLoading = false;  // レシート読み取り中
let rcptCtx = null;       // レシート抽出結果（確認シート用）
let overlayIsSettings = false;  // 設定オーバーレイ表示中か（同期反映時の再描画用）
let sheetIsSync = false;        // 共有シート表示中か
let useIng = [];                // 「使いたい食材」指定提案で選んだ食材名
const reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;

const TONE_AV = { green: 'a-green', rose: 'a-rose', amber: 'a-amber' };
const TONE_CHIP = { green: 'c-green', rose: 'c-rose', amber: 'c-amber' };

function q(id) { return document.getElementById(id); }

// ---------- 小さな部品 ----------
function ring(pct, color, label, val) {
  const r = 22, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return '<div style="text-align:center"><svg class="ring" width="58" height="58" viewBox="0 0 60 60">' +
    '<circle class="track" cx="30" cy="30" r="' + r + '" fill="none" stroke-width="6"/>' +
    '<circle class="val" cx="30" cy="30" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="6" ' +
    'stroke-dasharray="' + c + '" stroke-dashoffset="' + c + '" data-off="' + off + '"/></svg>' +
    '<div style="font-size:12px;font-weight:700;margin-top:2px">' + val + '</div>' +
    '<div style="font-size:10.5px;color:var(--muted)">' + label + '</div></div>';
}
function nchip(label, val, unit) {
  return '<div class="card soft" style="padding:11px 8px;text-align:center">' +
    '<div class="sub" style="font-size:10.5px">' + label + '</div>' +
    '<div class="num" style="font-size:17px;font-weight:700;margin-top:2px">' + val +
    '<span style="font-size:11px;font-weight:500"> ' + unit + '</span></div></div>';
}

// 1食あたりの栄養目安（1日の推奨量のおおよそ1/3）。年代・性別で異なる。
const NUTRI_REF = {
  male:   { label: '男性', kcal: 880, protein: 22, fat: 24, carb: 123, salt: 2.5, veg: 117 },
  female: { label: '女性', kcal: 667, protein: 17, fat: 18, carb: 92, salt: 2.2, veg: 117 },
  child:  { label: '子ども', kcal: 533, protein: 15, fat: 15, carb: 73, salt: 1.7, veg: 100 },
  senior: { label: 'シニア', kcal: 667, protein: 20, fat: 18, carb: 92, salt: 2.3, veg: 117 }
};
function nbar(label, val, target, unit) {
  const pct = Math.round(val / target * 100);
  const over = (label === '塩分') && (pct > 100);
  const color = over ? '#C64A38' : '#E0812A';
  return '<div style="margin:11px 0 0">' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">' +
    '<span style="font-size:12.5px">' + label + '</span>' +
    '<span class="num" style="font-size:11.5px;color:var(--muted)">' + val + unit + ' ・ ' + pct + '%' + (over ? '（多め）' : '') + '</span></div>' +
    '<div class="nbar"><span style="width:' + Math.min(100, pct) + '%;background:' + color + '"></span></div></div>';
}
function nutriBlock(r) {
  const ref = NUTRI_REF[nutriDemo] || NUTRI_REF.male;
  const n = r.nutrition;
  const tabs = '<div class="seg">' + Object.keys(NUTRI_REF).map(k =>
    '<button class="' + (k === nutriDemo ? 'on' : '') + '" onclick="APP.nutriTab(\'' + k + '\')">' + NUTRI_REF[k].label + '</button>').join('') + '</div>';
  return tabs +
    nbar('エネルギー', r.kcal, ref.kcal, 'kcal') +
    nbar('たんぱく質', n.protein_g, ref.protein, 'g') +
    nbar('脂質', n.fat_g, ref.fat, 'g') +
    nbar('炭水化物', n.carb_g, ref.carb, 'g') +
    nbar('塩分', n.salt_g, ref.salt, 'g') +
    nbar('野菜', n.veg_g, ref.veg, 'g');
}

// ---------- ホーム ----------
function todaysDinner() {
  const h = store.hh();
  if (h.savedRecipes && h.savedRecipes.length) return h.savedRecipes[0];
  return SAMPLE_RECIPES[0];
}

function homeScreen() {
  const h = store.hh();
  if (h.mode === 'senior') return seniorHome();
  const r = todaysDinner();
  const alerts = h.fridge.filter(f => f.expiry && daysUntil(f.expiry) <= 1)
    .sort((a, b) => daysUntil(a.expiry) - daysUntil(b.expiry));
  const proteinPct = Math.round(r.nutrition.protein_g / 30 * 100);
  const vegPct = Math.round(r.nutrition.veg_g / 150 * 100);
  const enePct = Math.round(r.kcal / 700 * 100);
  const modeChip = h.mode === 'growing' ? '<span class="chip hero-chip">食べ盛り対応</span>' : '';
  return '<div class="fade">' +
    '<div style="padding:10px 2px 14px"><div class="sub">' + todayLabel() + '</div>' +
    '<h2 class="kv" style="margin-top:3px">こんばんは、<br>なにを作ろう？</h2></div>' +
    '<div class="hero g1 tap" onclick="APP.openRecipe(-1)"><div class="glo"></div>' +
    '<button class="hero-refresh' + (gen.loading ? ' spinning' : '') + '" onclick="event.stopPropagation();APP.generate()" aria-label="いまの在庫で献立を作り直す">' +
    ic('refresh') + '<span>' + (gen.loading ? '考え中' : '更新') + '</span></button>' +
    '<div class="hero-in">' +
    '<div style="font-size:11.5px;opacity:.85;font-weight:600">今日の夕食' + (h.savedRecipes.length ? '・AIの提案' : '・見本') + '</div>' +
    '<div style="font-size:20px;font-weight:700;margin:2px 0 6px">' + esc(r.name) + '</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
    '<span class="chip hero-chip">' + store.servingCount() + '人分</span>' +
    '<span class="chip hero-chip">約' + r.minutes + '分</span>' + modeChip +
    (r.toddler_note ? '<span class="chip hero-chip">取り分けOK</span>' : '') +
    '</div></div></div>' +
    (gen.error
      ? '<div class="card danger-card" style="margin-top:12px" onclick="APP.' + (gen.error.indexOf('APIキー') >= 0 ? 'openApiKey()' : 'generate()') + '">' + ic('alert') +
        '<span style="font-size:12.5px;font-weight:600">' + esc(gen.error) + (gen.error.indexOf('APIキー') >= 0 ? '（タップで設定）' : '（タップで再試行）') + '</span></div>'
      : '') +
    '<div class="card" style="margin-top:14px"><div class="row"><b style="font-size:14px">今日の夕食の栄養（1人分）</b>' +
    '<span class="sub">目安</span></div>' +
    '<div style="display:flex;justify-content:space-around;margin-top:12px" id="rings">' +
    ring(proteinPct, '#E3A62E', 'たんぱく質', r.nutrition.protein_g + 'g') +
    ring(vegPct, '#E0812A', '野菜', r.nutrition.veg_g + 'g') +
    ring(enePct, '#D8552E', 'エネルギー', r.kcal + 'kcal') + '</div></div>' +
    (alerts.length
      ? '<div class="card danger-card" style="margin-top:12px" onclick="APP.go(\'stock\')">' + ic('alert') +
      '<span style="font-size:12.5px;font-weight:600">期限が近い：' +
      alerts.map(a => esc(a.name) + '（' + expiryInfo(a.expiry).text + '）').join('、') + '</span></div>'
      : '') +
    '<div class="row" style="margin:20px 2px 8px"><b style="font-size:14px">今日やること</b></div>' +
    quickRow('cart', '買い物リストを確認', 'shop', (h.shopping.filter(s => !s.done).length) + '点') +
    quickRow('book', '献立を提案してもらう', 'menu', '') +
    quickRow('fridge', '冷蔵庫を更新', 'stock', h.fridge.length + '品') +
    '<div style="text-align:center;color:var(--faint);font-size:11px;margin:22px 0 6px" class="num">AI Kitchen　v' + APP_VERSION + '</div>' +
    '</div>';
}
function quickRow(icon, label, tab, badge) {
  return '<div class="card tap" style="display:flex;align-items:center;gap:12px;margin-bottom:8px" onclick="APP.go(\'' + tab + '\')">' +
    '<span style="color:var(--green)">' + ic(icon) + '</span>' +
    '<div style="flex:1;font-size:14.5px">' + label + '</div>' +
    (badge ? '<span class="chip c-line">' + badge + '</span>' : '') +
    '<span style="color:var(--faint)">' + ic('right') + '</span></div>';
}

function seniorHome() {
  const h = store.hh(); const r = todaysDinner();
  return '<div class="fade">' +
    '<div style="padding:12px 2px 16px"><div class="sub" style="font-size:15px">' + todayLabel() + '</div>' +
    '<h2 class="kv" style="margin-top:6px">今日の夕食</h2></div>' +
    '<div class="card bigcard" style="padding:22px">' +
    '<div class="thumb g1" style="width:100%;height:120px;border-radius:18px;margin-bottom:16px"></div>' +
    '<b style="font-size:24px;font-weight:700;display:block">' + esc(r.name) + '</b>' +
    '<div style="font-size:16px;color:var(--muted);margin-top:8px">' + store.servingCount() + '人分 ・ 約' + r.minutes + '分</div>' +
    '<div class="card" style="background:var(--green-soft);border:none;margin-top:14px;color:var(--green-deep);font-size:15px;font-weight:600;display:flex;gap:9px;align-items:center">' +
    ic('heart') + '薄味・やわらかめに作れます</div>' +
    '<button class="btn primary" style="margin-top:16px" onclick="APP.openRecipe(-1)">作り方をみる</button>' +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.generate()">ほかの料理にする</button></div>' +
    ((h.guests || 0) > 0
      ? '<div class="card" style="margin-top:14px;background:var(--amber-soft);border:none;display:flex;gap:10px;align-items:center;color:var(--amber-ink);font-size:15px;font-weight:600">' +
      ic('users') + '今日は' + h.guests + '人多く来ます。多めに作ります</div>'
      : '') +
    '<div class="card tap" style="margin-top:14px;display:flex;gap:10px;align-items:center" onclick="APP.go(\'stock\')">' +
    '<span style="color:var(--green)">' + ic('fridge') + '</span>' +
    '<div style="flex:1"><b style="font-size:16px">冷蔵庫をみる</b></div>' +
    '<span style="color:var(--faint)">' + ic('right') + '</span></div>' +
    '<div style="text-align:center;color:var(--faint);font-size:12px;margin:22px 0 6px" class="num">AI Kitchen　v' + APP_VERSION + '</div>' +
    '</div>';
}

// ---------- 在庫・常備品 ----------
function stockScreen() {
  return '<div class="fade">' +
    '<div class="row" style="padding:10px 2px 6px"><h2 class="kv">在庫・常備品</h2>' +
    '<button class="round-btn" onclick="APP.toast(\'音声入力は今後対応予定です\')" aria-label="音声で追加">' + ic('mic') + '</button></div>' +
    '<div class="sub" style="margin-bottom:12px">冷蔵庫の中身はあなたが入力。常備品は切れそうな時だけ通知。</div>' +
    '<input type="file" id="rcpt-file" accept="image/*" capture="environment" style="display:none" onchange="APP.receiptFile(this)" />' +
    '<button class="btn primary" style="margin-bottom:14px"' + (rcptLoading ? ' disabled' : '') + ' onclick="APP.openReceipt()">' +
    (rcptLoading ? spinner() + ' レシートを読み取り中…' : ic('camera') + ' レシート撮影で在庫に追加') + '</button>' +
    '<div class="seg" id="seg">' +
    '<button class="' + (segIndex === 0 ? 'on' : '') + '" onclick="APP.seg(0)">冷蔵</button>' +
    '<button class="' + (segIndex === 1 ? 'on' : '') + '" onclick="APP.seg(1)">冷凍</button>' +
    '<button class="' + (segIndex === 2 ? 'on' : '') + '" onclick="APP.seg(2)">常備品</button></div>' +
    '<div id="segbody" style="margin-top:8px">' + segBody() + '</div>' +
    (segIndex === 2 ? '' :
      '<button class="btn ghost" style="margin-top:14px" onclick="APP.openAddStock()">' + ic('plus') + '食材を追加</button>') +
    (segIndex === 2 ? '<button class="btn ghost" style="margin-top:14px" onclick="APP.openAddPantry()">' + ic('plus') + '常備品を登録</button>' : '') +
    '</div>';
}
function segBody() {
  const h = store.hh();
  if (segIndex === 2) {
    return '<div class="sub" style="margin:8px 2px 8px;line-height:1.5">献立AIは常備品を「常にある前提」で使います。切れそうな物だけ買い物へ。</div>' +
      '<div class="card" style="padding:2px 14px">' + h.pantry.map(p =>
        '<div class="listrow"><span style="flex:1;font-size:14.5px">' + esc(p.name) + '</span>' +
        (p.ok
          ? '<button class="mini" onclick="APP.togglePantry(\'' + p.id + '\')"><span class="chip c-green">' + ic('check') + 'あり</span></button>'
          : '<button class="mini" onclick="APP.togglePantry(\'' + p.id + '\')"><span class="chip c-danger">残りわずか</span></button>') +
        '<button class="mini muted" onclick="APP.removePantry(\'' + p.id + '\')" aria-label="削除">' + ic('trash') + '</button></div>'
      ).join('') + '</div>';
  }
  const list = h.fridge.filter(f => (segIndex === 0 ? f.section !== 'freezer' : f.section === 'freezer'));
  if (!list.length) return '<div class="card" style="padding:22px;text-align:center;color:var(--muted);font-size:13px">まだありません。<br>「食材を追加」から登録できます。</div>';
  return '<div class="card" style="padding:2px 14px">' + list.map(f => {
    const e = expiryInfo(f.expiry);
    const flash = f._updated ? ' flash' : '';
    return '<div class="listrow' + flash + '" onclick="APP.openEditStock(\'' + f.id + '\')">' +
      '<div style="flex:1"><div style="font-size:14.5px">' + esc(f.name) + '</div>' +
      '<span class="chip ' + e.cls + '" style="font-size:10.5px;padding:3px 8px">' + e.text + '</span></div>' +
      '<div class="num" style="font-size:13.5px;color:' + (f.qty === 'なし' ? 'var(--danger)' : 'var(--muted)') + '">' +
      esc(f.qty) + (f._updated ? ' <span style="color:var(--green);font-size:10px">更新</span>' : '') + '</div>' +
      '<span style="color:var(--faint)">' + ic('right') + '</span></div>';
  }).join('') + '</div>';
}

// ---------- 献立 ----------
function menuScreen() {
  const h = store.hh();
  const chips = ['<span class="chip c-green">在庫優先</span>'];
  if (h.policy.timeSaver) chips.push('<span class="chip c-green">時短</span>');
  if (h.policy.nutrition) chips.push('<span class="chip c-line">栄養バランス</span>');
  if (h.mode === 'growing') chips.push('<span class="chip c-amber">食べ盛り</span>');
  if (store.toddlerPresent()) chips.push('<span class="chip c-rose">取り分け</span>');
  const list = curRecipes.length ? curRecipes : (h.savedRecipes.length ? h.savedRecipes : SAMPLE_RECIPES);
  curRecipes = list;
  const cards = list.map((r, i) =>
    '<div class="card tap" style="padding:12px;display:flex;gap:12px;margin-bottom:11px" onclick="APP.openRecipe(' + i + ')">' +
    '<div class="thumb g' + ((i % 4) + 1) + '"></div>' +
    '<div style="flex:1;min-width:0"><div class="row"><b style="font-size:15px">' + esc(r.name) + '</b>' +
    '<span style="color:var(--faint)">' + ic('right') + '</span></div>' +
    '<div class="sub num" style="margin:3px 0 8px">' + r.minutes + '分 ・ ' + store.servingCount() + '人分 ・ ' + r.kcal + 'kcal</div>' +
    '<div style="display:flex;gap:5px;flex-wrap:wrap"><span class="chip ' + tagTone(r) + '">' + esc(r.tag) + '</span>' +
    ((r.components && r.components.length >= 3) ? '<span class="chip c-line">一汁三菜</span>' : '') +
    (r.toddler_note ? '<span class="chip c-rose">取り分け</span>' : '') + '</div></div></div>'
  ).join('');
  return '<div class="fade">' +
    '<div style="padding:10px 2px 4px"><h2 class="kv">献立の提案</h2>' +
    '<div class="sub">冷蔵庫＋常備品＋家族' + h.members.length + '人の好みから</div></div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 10px">' + chips.join('') + '</div>' +
    (gen.error ? '<div class="card danger-card" style="align-items:flex-start" onclick="APP.openApiKey()">' + ic('alert') +
      '<span style="font-size:12.5px">' + esc(gen.error) + '</span></div>' : '') +
    '<button class="btn primary" style="margin:2px 0 10px"' + (gen.loading ? ' disabled' : '') + ' onclick="APP.generate()">' +
    (gen.loading ? spinner() + ' 考えています…' : ic('spark') + ' AIに献立を提案してもらう') + '</button>' +
    '<button class="btn ghost" style="margin:0 0 18px"' + (gen.loading ? ' disabled' : '') + ' onclick="APP.openUseIng()">' +
    ic('fridge') + ' 使いたい食材を指定して提案' + '</button>' +
    '<div class="sub" style="margin:0 2px 10px">' + (h.savedRecipes.length ? '前回の提案' : '見本の献立') + '</div>' +
    cards + '</div>';
}
function ingredientPickSheet() {
  const h = store.hh();
  const items = h.fridge.slice();
  const chips = items.length
    ? items.map(f => '<button class="pick-chip' + (useIng.indexOf(f.name) >= 0 ? ' on' : '') + '" onclick="APP.toggleUseIng(\'' + esc(f.name).replace(/'/g, '') + '\',this)">' + esc(f.name) + '</button>').join('')
    : '<div class="sub">冷蔵庫が空です。下の入力欄に使いたい食材を書けます。</div>';
  return '<div style="padding:0 2px"><b style="font-size:18px">使いたい食材で提案</b>' +
    '<div class="sub" style="margin:4px 0 14px">使いたい在庫をタップで選ぶ（複数OK）。作りたい料理があれば下に書けます。選んだ食材を主役に、一汁三菜で提案します。</div></div>' +
    '<label class="fl">冷蔵庫から選ぶ</label>' +
    '<div class="pick-wrap">' + chips + '</div>' +
    '<label class="fl" style="margin-top:14px">作りたい料理・使いたい食材（自由入力・任意）</label>' +
    '<input id="use-req" class="inp" placeholder="例：豚こまで生姜焼き／麻婆豆腐 が食べたい" />' +
    '<button class="btn primary" style="margin-top:16px"' + (gen.loading ? ' disabled' : '') + ' onclick="APP.generateWithIngredients()">' + ic('spark') + 'この内容で提案してもらう</button>' +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.closeSheet()">とじる</button>';
}
function tagTone(r) {
  if (/減塩|野菜|栄養|使い切/.test(r.tag)) return 'c-green';
  if (/期限|使い切り/.test(r.tag)) return 'c-amber';
  return 'c-green';
}
function spinner() { return '<span class="spin">' + ic('refresh') + '</span>'; }

// ---------- 買い物 ----------
function shopScreen() {
  const h = store.hh();
  const groups = {};
  h.shopping.forEach(s => { (groups[s.group] = groups[s.group] || []).push(s); });
  let html = '';
  Object.keys(groups).forEach((g, gi) => {
    html += '<div class="sub" style="margin:' + (gi ? '16px' : '4px') + ' 2px 6px">' + esc(g) + '</div><div class="card" style="padding:2px 14px">' +
      groups[g].map(s =>
        '<div class="listrow">' +
        '<div class="cbox' + (s.done ? ' done' : '') + '" onclick="APP.toggleShop(\'' + s.id + '\')">' + ic('check') + '</div>' +
        '<div style="flex:1;font-size:14.5px' + (s.done ? ';text-decoration:line-through;color:var(--faint)' : '') + '">' + esc(s.name) + '</div>' +
        '<span class="avatar ' + (TONE_AV[s.tone] || 'a-green') + '" style="width:24px;height:24px;font-size:10.5px">' + esc(s.who.slice(0, 1)) + '</span>' +
        '<button class="mini muted" onclick="APP.removeShop(\'' + s.id + '\')" aria-label="削除">' + ic('x') + '</button></div>'
      ).join('') + '</div>';
  });
  if (!h.shopping.length) html = '<div class="card" style="padding:24px;text-align:center;color:var(--muted);font-size:13px">リストは空です。<br>下のボタンから追加できます。</div>';
  const undone = h.shopping.filter(s => !s.done).length;
  const done = h.shopping.length - undone;
  return '<div class="fade">' +
    '<div class="row" style="padding:10px 2px 4px"><h2 class="kv">買い物リスト</h2>' +
    '<span class="chip c-line">' + ic('refresh') + '同期は次段階</span></div>' +
    '<div class="sub" style="margin-bottom:14px">献立で足りない物・切れそうな常備品が自動で並びます。</div>' + html +
    '<div class="card soft" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center">' +
    '<span class="sub">未購入 ' + undone + '点</span>' +
    (done ? '<button class="mini-btn" onclick="APP.clearDone()">購入済みを消す（' + done + '）</button>' : '<span class="sub">—</span>') + '</div>' +
    '<button class="btn ghost" style="margin-top:12px" onclick="APP.openAddShop()">' + ic('plus') + '品目を追加</button></div>';
}

// ---------- レシピ詳細（オーバーレイ） ----------
function recipeView(r) {
  const h = store.hh();
  const used = h.fridge.filter(f => (r.uses_stock || []).some(u => f.name.indexOf(u) === 0 || u.indexOf(f.name) === 0));
  const n = r.nutrition;
  let note = '';
  if (h.mode === 'senior' && r.senior_note) {
    note += noteCard('heart', 'var(--green)', 'var(--green-deep)', 'シニア向けの工夫', r.senior_note, 'var(--green-soft)');
  }
  if (store.toddlerPresent() && r.toddler_note) {
    note += noteCard('baby', 'var(--rose)', 'var(--rose-ink)', '2歳の取り分け', r.toddler_note, 'var(--rose-soft)');
  }
  if (h.mode === 'growing' && r.name) {
    note += noteCard('flame', 'var(--amber)', 'var(--amber-ink)', '食べ盛りに', 'お肉とごはんを1.3倍で。副菜をもう一品つけると◎。', 'var(--amber-soft)');
  }
  return '<div class="ohead"><button class="backbtn" onclick="APP.back()">' + ic('left') + '</button>' +
    '<b style="font-size:15px">レシピ</b></div><div class="obody">' +
    '<div class="hero g1" style="height:120px"><div class="glo"></div></div>' +
    '<h2 class="kv" style="margin-top:14px">' + esc(r.name) + '</h2>' +
    '<div class="sub" style="margin:6px 2px 4px">' + esc(r.reason || '') + '</div>' +
    '<div style="display:flex;gap:14px;margin:8px 0 16px" class="sub num">' +
    '<span>' + ic('clock') + ' 約' + r.minutes + '分</span><span>' + ic('users') + ' ' + store.servingCount() + '人分</span></div>' +
    ((r.components && r.components.length)
      ? '<div class="sub" style="margin:4px 2px 8px">献立の内容（一汁三菜）</div>' +
        '<div class="card" style="padding:2px 14px;margin-bottom:16px">' +
        r.components.map(c => '<div class="listrow"><span class="chip c-green" style="min-width:46px;justify-content:center">' + esc(c.role) + '</span>' +
          '<span style="flex:1;font-size:14px">' + esc(c.name) + '</span></div>').join('') + '</div>'
      : '') +
    '<div class="sub" style="margin-bottom:8px">栄養（1人分・1食の必要量に対する割合）</div>' +
    '<div id="nutri-block">' + nutriBlock(r) + '</div>' +
    '<div class="sub" style="margin:10px 2px 16px;font-size:11px">※1食あたりの目安に対する割合。年代・性別で必要量が異なります。塩分は控えめが目安。</div>' +
    note +
    (used.length
      ? '<div class="sub" style="margin:18px 2px 8px">この料理で使う在庫</div><div class="card" style="padding:2px 14px">' +
      used.map(f => '<div class="listrow"><span style="flex:1;font-size:13.5px">' + esc(f.name) + '</span>' +
        '<span class="num sub" style="font-size:13px">' + esc(f.qty) + '</span></div>').join('') + '</div>'
      : '') +
    '<div class="sub" style="margin:18px 2px 8px">材料（' + store.servingCount() + '人分）</div>' +
    '<div class="card" style="padding:12px 16px;line-height:1.9;font-size:13.5px;color:#3d3c37">' +
    (r.ingredients || []).map(g => esc(g.name) + ' … ' + esc(g.amount)).join('<br>') + '</div>' +
    '<div class="sub" style="margin:18px 2px 8px">作り方</div>' +
    (r.steps || []).map((s, i) => step(i + 1, s)).join('') +
    '<button class="btn primary" style="margin-top:8px" onclick="APP.openMake()">' + ic('flame') + '作った（在庫を調整）</button>' +
    '</div>';
}
function noteCard(icon, icColor, textColor, title, body, bg) {
  return '<div class="card" style="background:' + bg + ';border:none;display:flex;gap:11px;margin-bottom:10px">' +
    '<span style="color:' + icColor + '">' + ic(icon) + '</span><div>' +
    '<b style="font-size:13px;color:' + textColor + '">' + title + '</b>' +
    '<div style="font-size:12.5px;color:' + textColor + ';margin-top:3px;line-height:1.6">' + esc(body) + '</div></div></div>';
}
function step(n, t) {
  return '<div style="display:flex;gap:12px;margin-bottom:12px"><span class="avatar a-green" style="width:26px;height:26px;flex:0 0 auto">' + n + '</span>' +
    '<div style="font-size:13.5px;line-height:1.6;padding-top:3px">' + esc(t) + '</div></div>';
}

// ---------- 設定・家族（オーバーレイ） ----------
function settingsView() {
  const h = store.hh();
  const modes = [['standard', '標準', 'ふつうの分量・表示'], ['growing', '食べ盛り', '育ち盛りに合わせて分量多め'], ['senior', 'シニア（あっさり表示）', '文字を大きく、薄味・やわらかめで提案']];
  const hasKey = !!store.effectiveApiKey();
  const sharedKey = store.usingSharedKey();
  return '<div class="ohead"><button class="backbtn" onclick="APP.back()">' + ic('left') + '</button><b style="font-size:15px">' + esc(h.name) + ' の設定</b></div>' +
    '<div class="obody">' +
    '<div class="sub" style="margin:0 2px 8px">世帯の名前</div>' +
    '<div class="card tap" style="display:flex;align-items:center;gap:12px;margin-bottom:20px" onclick="APP.openRename()">' +
    '<span class="avatar a-green" style="width:38px;height:38px;font-size:14px;flex:0 0 auto">' + esc(h.name.slice(0, 1)) + '</span>' +
    '<div style="flex:1;min-width:0"><b style="font-size:15px">' + esc(h.name) + '</b>' +
    '<div class="sub">' + esc(h.tag || '') + '</div></div>' +
    '<span class="chip c-line">' + ic('edit') + '編集</span></div>' +
    '<div class="sub" style="margin:0 2px 10px">世帯モード</div>' +
    modes.map(m => {
      const on = h.mode === m[0];
      return '<div class="opt' + (on ? ' on' : '') + '" onclick="APP.setMode(\'' + m[0] + '\')"><span class="rad"></span>' +
        '<div><b style="font-size:14.5px">' + m[1] + '</b><div class="sub" style="margin-top:1px">' + m[2] + '</div></div></div>';
    }).join('') +
    '<div class="sub" style="margin:0 2px 8px">来客・お泊まり</div>' +
    '<div class="card" style="padding:2px 14px">' +
    ((h.guestRoster || []).map(g =>
      '<div class="listrow">' +
      '<span class="avatar a-amber" style="width:36px;height:36px;font-size:12px;flex:0 0 auto' + (g.active ? '' : ';opacity:.35') + '">' + esc((g.name || '客').slice(0, 1)) + '</span>' +
      '<div style="flex:1;min-width:0" onclick="APP.openGuest(\'' + g.id + '\')"><div style="font-size:14.5px">' + esc(g.name) +
      ' <span style="color:var(--green);font-weight:700;font-size:12px">' + ageLabel(g.birth, g.toddler) + '</span>' + (g.toddler ? ' <span class="chip c-rose" style="padding:2px 7px">取り分け</span>' : '') + '</div>' +
      '<div class="sub">' + (g.active ? '今日は来る（加算中）' : 'いまは来ていない') + ((g.dislikes && g.dislikes.length) ? ' ・ ' + esc(g.dislikes.join('/')) + '苦手' : '') + '</div></div>' +
      '<span class="switch' + (g.active ? ' on' : '') + '" onclick="APP.toggleGuest(\'' + g.id + '\')"><span class="knob"></span></span></div>'
    ).join('')) +
    ((h.guestRoster || []).length ? '' : '<div class="sub" style="padding:12px 2px">よく来る人（お孫さんなど）を登録すると、来る日にワンタップで人数・年齢・取り分けに反映できます。</div>') +
    '</div>' +
    '<button class="btn ghost" style="margin:12px 0 8px" onclick="APP.openGuest(null)">' + ic('plus') + '来客を登録</button>' +
    '<div class="card soft" style="margin:6px 0 20px;padding:12px 16px"><div class="row">' +
    '<div><b style="font-size:13.5px">名前なしの追加人数</b><div class="sub" style="margin-top:2px">その場だけの増員（分量のみ加算）</div></div>' +
    '<div class="stepper"><button onclick="APP.guest(-1)" aria-label="減らす">' + ic('minus') + '</button>' +
    '<b class="num" style="font-size:17px;width:40px;text-align:center">+' + (h.guests || 0) + '</b>' +
    '<button onclick="APP.guest(1)" aria-label="増やす">' + ic('plus') + '</button></div></div></div>' +
    '<div class="sub" style="margin:0 2px 8px">家族（' + h.members.length + '人）</div><div class="card" style="padding:2px 14px">' +
    h.members.map(m =>
      '<div class="listrow" onclick="APP.openMember(\'' + m.id + '\')">' +
      '<span class="avatar ' + (TONE_AV[m.tone] || 'a-green') + '" style="width:38px;height:38px;font-size:13px;flex:0 0 auto">' + esc(m.initial) + '</span>' +
      '<div style="flex:1;min-width:0"><div style="font-size:14.5px">' + esc(m.name) +
      ' <span style="color:var(--green);font-weight:700;font-size:12.5px">' + ageLabel(m.birth, m.toddler) + '</span></div>' +
      '<div class="sub num" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + birthLabel(m.birth) +
      (m.role ? ' ・ ' + esc(m.role) : '') + ((m.dislikes && m.dislikes.length) ? ' ・ ' + esc(m.dislikes.join('/')) + '苦手' : '') + '</div></div>' +
      '<span style="color:var(--faint)">' + ic('right') + '</span></div>'
    ).join('') + '</div>' +
    '<button class="btn ghost" style="margin:14px 0 20px" onclick="APP.openMember(null)">' + ic('plus') + '家族を追加</button>' +
    '<div class="sub" style="margin:0 2px 8px">献立の方針</div><div class="card" style="padding:2px 16px">' +
    toggleRow('timeSaver', '平日は時短優先', h.policy.timeSaver) +
    toggleRow('nutrition', '栄養バランスを重視', h.policy.nutrition) +
    toggleRow('toddlerSplit', '幼児の取り分けを常に用意', h.policy.toddlerSplit) + '</div>' +
    '<div class="sub" style="margin:18px 2px 8px">AI献立の設定</div>' +
    '<div class="card tap" style="display:flex;align-items:center;gap:12px" onclick="APP.openApiKey()">' +
    '<span style="color:var(--green)">' + ic('key') + '</span>' +
    '<div style="flex:1"><b style="font-size:14.5px">APIキー</b>' +
    '<div class="sub">' + (hasKey ? (sharedKey ? '家族の共有キーで利用中' : '設定済み（AI提案が使えます）') : '未設定（見本献立で動作中）') + '</div></div>' +
    '<span class="chip ' + (hasKey ? 'c-green' : 'c-line') + '">' + (hasKey ? (sharedKey ? '共有' : '有効') : '設定') + '</span></div>' +
    '<div class="sub" style="margin:18px 2px 8px">見た目</div>' +
    '<div class="card tap" style="display:flex;align-items:center;gap:12px" onclick="APP.openBg()">' +
    (store.bgPhoto()
      ? '<span class="bg-thumb" style="background-image:url(&quot;' + store.bgPhoto() + '&quot;)"></span>'
      : '<span style="color:var(--green)">' + ic('users') + '</span>') +
    '<div style="flex:1"><b style="font-size:14.5px">背景の写真</b>' +
    '<div class="sub">' + (store.bgPhoto() ? '設定済み（家族の写真を薄く表示中）' : '家族の写真などを背景に薄く置けます') + '</div></div>' +
    '<span style="color:var(--faint)">' + ic('right') + '</span></div>' +
    '<div class="card tap" style="display:flex;align-items:center;gap:12px;margin-top:8px" onclick="APP.openHeaderPhoto()">' +
    (store.headerPhoto()
      ? '<span class="hdr-photo" style="width:38px;height:38px;background-image:url(&quot;' + store.headerPhoto() + '&quot;)"></span>'
      : '<span style="color:var(--green)">' + ic('users') + '</span>') +
    '<div style="flex:1"><b style="font-size:14.5px">右上の家族写真</b>' +
    '<div class="sub">' + (store.headerPhoto() ? '設定済み（右上に丸く表示中）' : '画面右上に家族写真を丸く（少し透過）' ) + '</div></div>' +
    '<span style="color:var(--faint)">' + ic('right') + '</span></div>' +
    '<div class="sub" style="margin:18px 2px 8px">データ</div>' +
    '<div class="card tap" style="display:flex;align-items:center;gap:12px" onclick="APP.openData()">' +
    '<span style="color:var(--green)">' + ic('database') + '</span>' +
    '<div style="flex:1"><b style="font-size:14.5px">バックアップ・復元</b>' +
    '<div class="sub">保存する／別の端末やURLへ移す</div></div>' +
    '<span style="color:var(--faint)">' + ic('right') + '</span></div>' +
    '<div class="sub" style="margin:18px 2px 8px">家族と共有</div>' +
    '<div class="card tap" style="display:flex;align-items:center;gap:12px" onclick="APP.openSync()">' +
    '<span style="color:var(--green)">' + ic('sync') + '</span>' +
    '<div style="flex:1"><b style="font-size:14.5px">家族でリアルタイム連動</b>' +
    '<div class="sub">' + (sync.isOn() ? '共有中（コード ' + esc(sync.currentCode()) + '）' : '夫婦・実家のスマホと在庫や献立を常に同じに') + '</div></div>' +
    '<span class="chip ' + (sync.isOn() ? 'c-green' : 'c-line') + '">' + (sync.isOn() ? '共有中' : '設定') + '</span></div>' +
    '<div style="text-align:center;color:var(--faint);font-size:11px;margin:18px 0 4px" class="num">AI Kitchen　v' + APP_VERSION + '</div>' +
    '</div>';
}
function toggleRow(key, label, on) {
  return '<div class="listrow" onclick="APP.togglePolicy(\'' + key + '\')"><span style="flex:1;font-size:14.5px">' + label + '</span>' +
    '<span class="switch' + (on ? ' on' : '') + '"><span class="knob"></span></span></div>';
}

// ---------- 動的DOM: オーバーレイ / シート / トースト ----------
let ovEl, sheetEl, toastEl;
function openOverlay(html, instant) {
  ovEl.innerHTML = '<div class="overlay' + (instant ? ' in' : '') + '">' + html + '</div>';
  if (!instant) {
    const el = ovEl.firstChild;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  }
}
function closeOverlay() {
  const el = ovEl.firstChild; if (!el) return;
  el.classList.remove('in');
  setTimeout(() => { ovEl.innerHTML = ''; }, reduce ? 0 : 380);
}
function openSheet(html) {
  sheetIsSync = false;
  sheetEl.innerHTML = '<div class="scrim" onclick="APP.closeSheet()"></div><div class="sheet"><div class="grab"></div>' + html + '</div>';
  const sc = sheetEl.querySelector('.scrim'), sh = sheetEl.querySelector('.sheet');
  requestAnimationFrame(() => requestAnimationFrame(() => { sc.classList.add('in'); sh.classList.add('in'); }));
}
function closeSheet() {
  const sc = sheetEl.querySelector('.scrim'), sh = sheetEl.querySelector('.sheet');
  if (!sh) return;
  sc.classList.remove('in'); sh.classList.remove('in');
  setTimeout(() => { sheetEl.innerHTML = ''; }, reduce ? 0 : 400);
}
function toast(msg) {
  toastEl.innerHTML = ic('check') + '<span>' + esc(msg) + '</span>';
  toastEl.classList.add('show');
  clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// ---------- シートの中身 ----------
function householdSheet() {
  const st = store.getState();
  return '<div style="display:flex;align-items:center;gap:10px;padding:0 2px 16px">' +
    '<span class="wordmark-logo">' + ic('cutlery') + '</span>' +
    '<div style="flex:1"><b style="font-size:18px;letter-spacing:.01em">AI Kitchen</b>' +
    '<div class="sub" style="margin-top:-1px">AI（愛）で、家族のごはんを</div></div>' +
    '<span class="ver">v' + APP_VERSION + '</span></div>' +
    '<div style="padding:0 2px 12px"><b style="font-size:16px">世帯を切り替え</b>' +
    '<div class="sub" style="margin-top:4px">世帯ごとに家族・在庫・献立・買い物を別々に管理できます。</div></div>' +
    st.households.map(ho => {
      const on = ho.id === st.currentHouseholdId;
      return '<div class="opt' + (on ? ' on' : '') + '" onclick="APP.switchHH(\'' + ho.id + '\')">' +
        '<span class="avatar a-green" style="width:40px;height:40px;font-size:15px;flex:0 0 auto">' + esc(ho.name.slice(0, 1)) + '</span>' +
        '<div style="flex:1"><b style="font-size:15px">' + esc(ho.name) + '</b>' +
        '<div class="sub">' + esc(ho.tag) + '・家族' + ho.members.length + '人' +
        (ho.mode === 'senior' ? '・あっさり表示' : ho.mode === 'growing' ? '・食べ盛り' : '') + '</div></div>' +
        (on ? '<span style="color:var(--green)">' + ic('check2') + '</span>' : '') + '</div>';
    }).join('') +
    '<button class="btn ghost" style="margin:6px 0 12px" onclick="APP.openSettings()">' + ic('settings') + 'この世帯の設定・家族</button>' +
    '<button class="btn ghost" onclick="APP.toast(\'世帯の追加は今後対応します\')">' + ic('plus') + '世帯を追加してプレゼント</button>';
}

function makeSheet() {
  return '<div style="padding:0 2px"><b style="font-size:18px">在庫の更新</b>' +
    '<div class="sub" style="margin:4px 0 14px">実際に使った分に合わせて選べます。レシピ通りでなくてOK。</div></div>' +
    '<div id="makebody">' + makeBody() + '</div>';
}
function makeBody() {
  const opts = [['all', '使い切った'], ['half', '約半分'], ['little', '少しだけ'], ['none', '変えない']];
  const h = store.hh();
  const used = h.fridge.filter(f => makeCtx.names.some(u => f.name.indexOf(u) === 0 || u.indexOf(f.name) === 0));
  if (!used.length) {
    return '<div class="card soft" style="padding:14px;font-size:13px;color:var(--muted)">この料理で使う在庫が見つかりませんでした。</div>' +
      '<button class="btn ghost" onclick="APP.closeSheet()">とじる</button>';
  }
  const rows = used.map(f => {
    const ch = makeCtx.choices[f.id] || 'all';
    const res = ch === 'all' ? 'なし' : ch === 'half' ? '約半分' : ch === 'little' ? '少し減る' : f.qty;
    return '<div class="card" style="padding:13px 14px;margin-bottom:10px"><div class="row">' +
      '<b style="font-size:14.5px">' + esc(f.name) + '</b>' +
      '<span class="num sub" style="font-size:12.5px">残り：<b style="color:' + (res === 'なし' ? 'var(--danger)' : 'var(--ink)') + '">' + res + '</b></span></div>' +
      '<div class="cseg">' + opts.map(o =>
        '<button class="' + (ch === o[0] ? 'on' : '') + '" onclick="APP.setConsume(\'' + f.id + '\',\'' + o[0] + '\')">' + o[1] + '</button>'
      ).join('') + '</div></div>';
  }).join('');
  return rows +
    '<div class="card soft" style="padding:11px 13px;margin-bottom:14px;font-size:12px;color:var(--muted);line-height:1.5">' +
    '「使い切った」にした物だけ、買い物リストに自動で追加されます。</div>' +
    '<button class="btn primary" onclick="APP.confirmMake()">' + ic('check') + 'この内容で在庫を更新</button>' +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.closeSheet()">やめる</button>';
}

function addStockSheet() {
  const initExp = estimateExpiry('veg', false, 'fridge');
  return '<div style="padding:0 2px"><b style="font-size:18px">食材を追加</b>' +
    '<div class="sub" style="margin:4px 0 14px">冷蔵・冷凍・常備品に追加できます。</div></div>' +
    '<label class="fl">名前</label><input id="as-name" class="inp" placeholder="例：キャベツ／オリーブオイル" oninput="APP.stockGuess(this)" />' +
    '<label class="fl">量（任意）</label><input id="as-qty" class="inp" placeholder="例：1個" />' +
    '<label class="fl">場所</label><div class="seg" id="as-sec">' +
    '<button class="on" data-v="fridge" onclick="APP.pickSec(this)">冷蔵</button>' +
    '<button data-v="freezer" onclick="APP.pickSec(this)">冷凍</button>' +
    '<button data-v="pantry" onclick="APP.pickSec(this)">常備品</button></div>' +
    '<div id="as-perishable">' +
    '<label class="fl">種類</label><select id="as-cat" class="inp" onchange="APP.stockRecalc()">' +
    CATEGORIES.map(c => '<option value="' + c.v + '"' + (c.v === 'veg' ? ' selected' : '') + '>' + c.label + '</option>').join('') +
    '</select>' +
    '<label class="fl">購入区分</label><div class="seg" id="as-deal"><button class="on" data-v="0" onclick="APP.pickDeal(this)">通常</button><button data-v="1" onclick="APP.pickDeal(this)">おつとめ品</button></div>' +
    '<label class="fl">賞味期限（自動見積り・手で直せます）</label><input id="as-exp" class="inp" type="date" value="' + initExp + '" />' +
    '<div class="sub" style="margin:6px 2px 0;font-size:11.5px;line-height:1.5">キャベツなど期限表示のない食材は、種類と「おつとめ品かどうか」から目安を自動計算します。</div>' +
    '</div>' +
    '<div id="as-pantry-note" class="sub" style="display:none;margin:10px 2px 0;font-size:11.5px;line-height:1.5">常備品は「いつも家にあるもの」（調味料・油・米など）。期限管理はせず、切れそうな時だけ通知します。</div>' +
    '<button class="btn primary" style="margin-top:16px" onclick="APP.saveAddStock()">' + ic('plus') + '追加する</button>' +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.closeSheet()">やめる</button>';
}

function bgSheet() {
  const photo = store.bgPhoto();
  const strength = store.bgStrength();
  return '<div style="padding:0 2px"><b style="font-size:18px">背景の写真</b>' +
    '<div class="sub" style="margin:4px 0 14px">家族の写真などを、白いベール越しに背景へ薄く表示します。世帯ごとに設定できます。</div></div>' +
    (photo ? '<div class="bg-preview" style="background-image:url(&quot;' + photo + '&quot;)"></div>' : '') +
    '<input type="file" id="bg-file" accept="image/*" style="display:none" onchange="APP.pickBgFile(this)" />' +
    '<button class="btn ghost" style="margin-top:' + (photo ? '12px' : '4px') + '" onclick="document.getElementById(\'bg-file\').click()">' + ic('users') + (photo ? '写真を変える' : '写真を選ぶ') + '</button>' +
    (photo
      ? '<label class="fl">見え方の強さ</label>' +
        '<input type="range" min="0" max="100" step="5" value="' + strength + '" class="rng" oninput="APP.bgStrength(this.value)" />' +
        '<div class="sub" style="margin-top:4px;font-size:11.5px">左：白基調で控えめ ／ 右：写真をはっきり</div>' +
        '<button class="btn ghost" style="margin-top:14px" onclick="APP.clearBg()">' + ic('trash') + '背景をなしにする</button>'
      : '') +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.closeSheet()">とじる</button>';
}
function headerPhotoSheet() {
  const photo = store.headerPhoto();
  const strength = store.headerStrength();
  return '<div style="padding:0 2px"><b style="font-size:18px">右上の家族写真</b>' +
    '<div class="sub" style="margin:4px 0 14px">画面右上に、家族の写真を丸く表示します。少し透過して、白基調のデザインになじませます。世帯ごと・端末ごとの設定です。</div></div>' +
    (photo
      ? '<div style="display:flex;justify-content:center;margin-bottom:12px"><span class="hdr-photo" style="width:72px;height:72px;background-image:url(&quot;' + photo + '&quot;);opacity:' + (strength / 100).toFixed(2) + '"></span></div>'
      : '') +
    '<input type="file" id="hdr-file" accept="image/*" style="display:none" onchange="APP.pickHeaderFile(this)" />' +
    '<button class="btn ghost" style="margin-top:' + (photo ? '4px' : '4px') + '" onclick="document.getElementById(\'hdr-file\').click()">' + ic('users') + (photo ? '写真を変える' : '写真を選ぶ') + '</button>' +
    (photo
      ? '<label class="fl">透け具合（不透明度）</label>' +
        '<input type="range" min="30" max="100" step="5" value="' + strength + '" class="rng" oninput="APP.headerStrength(this.value)" />' +
        '<div class="sub" style="margin-top:4px;font-size:11.5px">左：うっすら透過 ／ 右：はっきり</div>' +
        '<button class="btn ghost" style="margin-top:14px" onclick="APP.clearHeaderPhoto()">' + ic('trash') + '写真をなしにする</button>'
      : '') +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.closeSheet()">とじる</button>';
}
function editStockSheet(f) {
  return '<div style="padding:0 2px"><b style="font-size:18px">' + esc(f.name) + '</b>' +
    '<div class="sub" style="margin:4px 0 14px">内容を編集できます。</div></div>' +
    '<label class="fl">名前</label><input id="es-name" class="inp" value="' + esc(f.name) + '" />' +
    '<div style="display:flex;gap:10px"><div style="flex:1"><label class="fl">量</label><input id="es-qty" class="inp" value="' + esc(f.qty) + '" /></div>' +
    '<div style="flex:1"><label class="fl">賞味期限</label><input id="es-exp" class="inp" type="date" value="' + (f.expiry || '') + '" /></div></div>' +
    '<button class="btn primary" style="margin-top:16px" onclick="APP.saveEditStock(\'' + f.id + '\')">' + ic('check') + '保存</button>' +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.deleteStock(\'' + f.id + '\')">' + ic('trash') + '削除する</button>';
}
function addPantrySheet() {
  return '<div style="padding:0 2px"><b style="font-size:18px">常備品を登録</b>' +
    '<div class="sub" style="margin:4px 0 14px">いつも家にあるもの（調味料・米など）。</div></div>' +
    '<input id="ap-name" class="inp" placeholder="例：オリーブオイル" />' +
    '<button class="btn primary" style="margin-top:14px" onclick="APP.saveAddPantry()">' + ic('plus') + '登録する</button>' +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.closeSheet()">やめる</button>';
}
function addShopSheet() {
  return '<div style="padding:0 2px"><b style="font-size:18px">品目を追加</b>' +
    '<div class="sub" style="margin:4px 0 14px">買うものを入力してください。</div></div>' +
    '<label class="fl">品名</label><input id="sh-name" class="inp" placeholder="例：たまご 1パック" />' +
    '<label class="fl">お店</label><div class="seg" id="sh-grp"><button class="on" data-v="スーパー" onclick="APP.pickGrp(this)">スーパー</button><button data-v="ドラッグストア" onclick="APP.pickGrp(this)">ドラッグストア</button></div>' +
    '<button class="btn primary" style="margin-top:16px" onclick="APP.saveAddShop()">' + ic('plus') + '追加する</button>' +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.closeSheet()">やめる</button>';
}
function apiKeySheet() {
  const has = !!store.apiKey();
  const md = store.model();
  return '<div style="padding:0 2px"><b style="font-size:18px">AI献立の設定</b>' +
    '<div class="sub" style="margin:4px 0 14px">Google Gemini のAPIキーを入れると、在庫と家族に合わせてAIが献立を生成します。</div></div>' +
    '<label class="fl">モデル（コスト）</label>' +
    '<div class="seg" id="key-model">' +
    '<button class="' + (md === 'flash-lite' ? 'on' : '') + '" data-v="flash-lite" onclick="APP.pickModel(this)">最安（Flash-Lite）</button>' +
    '<button class="' + (md === 'flash' ? 'on' : '') + '" data-v="flash" onclick="APP.pickModel(this)">高品質（Flash）</button></div>' +
    '<div class="sub" style="margin:6px 2px 4px;font-size:11.5px;line-height:1.5">Flash-Lite は最安クラスで<b>無料枠</b>内でも十分使えます。もう少し質を上げたいときは Flash。どちらもごく低コストです。</div>' +
    '<label class="fl">APIキー</label>' +
    (has
      ? '<div class="card soft" style="padding:12px 14px;display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
          '<span style="color:var(--green)">' + ic('check2') + '</span>' +
          '<div style="flex:1"><b style="font-size:14px">設定済み・有効</b>' +
          '<div class="sub num">末尾 ••••' + esc(store.apiKey().slice(-4)) + '（入れ直し不要です）</div></div></div>' +
        '<input id="key-inp" class="inp" type="password" placeholder="変更する場合だけ入力" value="" />'
      : '<input id="key-inp" class="inp" type="password" placeholder="AIza..." value="" />') +
    (has
      ? '<div class="card" style="margin-top:12px;padding:2px 14px"><div class="listrow" onclick="APP.toggleShareKey()">' +
        '<div style="flex:1"><b style="font-size:14px">このキーを家族全員で使う</b>' +
        '<div class="sub" style="margin-top:2px">' + (sync.isOn() ? '共有中の他の端末が、キー未設定でもAIを使えます' : '先に「設定→家族と共有」をオンにすると全端末へ反映') + '</div></div>' +
        '<span class="switch' + (store.keyIsShared() ? ' on' : '') + '"><span class="knob"></span></span></div></div>'
      : '') +
    '<div class="card soft" style="margin-top:12px;padding:12px 14px;font-size:12px;color:var(--muted);line-height:1.6">' +
    'キーは <b>aistudio.google.com</b>（Google AI Studio）で無料発行できます。<br>キーは<b>この端末の中だけ</b>に保存されます（家族共有をオンにした場合のみ、家族データに載って共有）。将来アプリを販売する場合は、キーをサーバー側に置く方式に切り替えます。</div>' +
    '<button class="btn primary" style="margin-top:14px" onclick="APP.saveApiKey()">' + ic('check') + '保存する</button>' +
    (has ? '<button class="btn ghost" style="margin-top:10px" onclick="APP.clearApiKey()">キーを削除</button>' : '') +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.closeSheet()">とじる</button>';
}
function memberSheet(m) {
  const isNew = !m;
  m = m || { name: '', birth: '', role: '', dislikes: [], toddler: false, tone: 'green' };
  return '<div style="padding:0 2px"><b style="font-size:18px">' + (isNew ? '家族を追加' : esc(m.name)) + '</b>' +
    '<div class="sub" style="margin:4px 0 14px">生年月日を入れれば年齢は自動計算されます。</div></div>' +
    '<label class="fl">名前</label><input id="m-name" class="inp" value="' + esc(m.name) + '" placeholder="例：三男" />' +
    '<label class="fl">生年月日</label><input id="m-birth" class="inp" type="date" value="' + (m.birth || '') + '" />' +
    '<label class="fl">ひとこと（任意）</label><input id="m-role" class="inp" value="' + esc(m.role || '') + '" placeholder="例：食べ盛り・多め" />' +
    '<label class="fl">苦手な食材（カンマ区切り・任意）</label><input id="m-dis" class="inp" value="' + esc((m.dislikes || []).join(',')) + '" placeholder="例：ピーマン,なす" />' +
    '<button class="btn primary" style="margin-top:16px" onclick="APP.saveMember(' + (isNew ? 'null' : '\'' + m.id + '\'') + ')">' + ic('check') + (isNew ? '追加する' : '保存') + '</button>' +
    (isNew ? '' : '<button class="btn ghost" style="margin-top:10px" onclick="APP.deleteMember(\'' + m.id + '\')">' + ic('trash') + 'この家族を削除</button>');
}

function guestSheet(g) {
  const isNew = !g;
  g = g || { name: '', birth: '', role: '', dislikes: [], toddler: false, active: true };
  return '<div style="padding:0 2px"><b style="font-size:18px">' + (isNew ? '来客を登録' : esc(g.name)) + '</b>' +
    '<div class="sub" style="margin:4px 0 14px">生年月だけでもOK（年齢は自動計算）。一度登録すれば、来る日にスイッチをオンにするだけです。</div></div>' +
    '<label class="fl">名前・呼び名</label><input id="g-name" class="inp" value="' + esc(g.name) + '" placeholder="例：孫（そうた）" />' +
    '<label class="fl">生年月日（分かる範囲で）</label><input id="g-birth" class="inp" type="date" value="' + (g.birth || '') + '" />' +
    '<label class="fl">苦手な食材（カンマ区切り・任意）</label><input id="g-dis" class="inp" value="' + esc((g.dislikes || []).join(',')) + '" placeholder="例：えび,かに" />' +
    '<div class="card" style="margin-top:12px;padding:2px 14px"><div class="listrow" onclick="APP.toggleGuestToddler(this)">' +
    '<div style="flex:1"><b style="font-size:14px">取り分け（幼児）が必要</b><div class="sub" style="margin-top:2px">薄味・やわらかめの取り分けを用意</div></div>' +
    '<span id="g-tod" class="switch' + (g.toddler ? ' on' : '') + '" data-on="' + (g.toddler ? '1' : '0') + '"><span class="knob"></span></span></div></div>' +
    '<button class="btn primary" style="margin-top:16px" onclick="APP.saveGuest(' + (isNew ? 'null' : '\'' + g.id + '\'') + ')">' + ic('check') + (isNew ? '登録する' : '保存') + '</button>' +
    (isNew ? '' : '<button class="btn ghost" style="margin-top:10px" onclick="APP.removeGuest(\'' + g.id + '\')">' + ic('trash') + 'この来客を削除</button>');
}

function receiptSheet() {
  return '<div style="padding:0 2px"><b style="font-size:18px">レシートから追加</b>' +
    '<div class="sub" style="margin:4px 0 14px">読み取った食材です。追加する物にチェックしてください。生鮮は冷蔵、調味料などは常備品に入ります。</div></div>' +
    '<div id="rcpt-body">' + rcptBody() + '</div>';
}
function rcptBody() {
  const rows = rcptCtx.items.map((it, i) => {
    const place = it.perishable ? '冷蔵（期限は自動見積り）' : '常備品';
    return '<div class="listrow">' +
      '<div class="cbox' + (it.checked ? ' done' : '') + '" onclick="APP.rcptToggle(' + i + ')">' + ic('check') + '</div>' +
      '<div style="flex:1;min-width:0"><div style="font-size:14.5px' + (it.checked ? '' : ';color:var(--faint)') + '">' +
      esc(it.name) + (it.qty ? ' <span class="sub">' + esc(it.qty) + '</span>' : '') + '</div>' +
      '<div class="sub">' + place + '</div></div></div>';
  }).join('');
  const n = rcptCtx.items.filter(x => x.checked).length;
  return '<div class="card" style="padding:2px 14px">' + (rows || '<div class="listrow"><span class="sub">品目がありません</span></div>') + '</div>' +
    '<button class="btn primary" style="margin-top:14px"' + (n ? '' : ' disabled') + ' onclick="APP.confirmReceipt()">' +
    ic('plus') + '選んだ ' + n + ' 品を在庫に追加</button>' +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.closeSheet()">やめる</button>';
}

function renameSheet() {
  const h = store.hh();
  return '<div style="padding:0 2px"><b style="font-size:18px">世帯の名前</b>' +
    '<div class="sub" style="margin:4px 0 14px">画面の上部に表示される名前です。好きに変えられます。</div></div>' +
    '<label class="fl">名前</label><input id="hh-name" class="inp" value="' + esc(h.name) + '" placeholder="例：林家／わが家" />' +
    '<label class="fl">ひとこと（自宅・実家など・任意）</label><input id="hh-tag" class="inp" value="' + esc(h.tag || '') + '" placeholder="例：自宅" />' +
    '<button class="btn primary" style="margin-top:16px" onclick="APP.saveHousehold()">' + ic('check') + '保存</button>' +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.closeSheet()">やめる</button>';
}

function dataSheet() {
  return '<div style="padding:0 2px"><b style="font-size:18px">バックアップ・復元</b>' +
    '<div class="sub" style="margin:4px 0 14px">データはこの端末（このURL）だけに保存されます。書き出せば、別の端末やURLへ移せます。</div></div>' +
    '<button class="btn ghost" onclick="APP.exportData()">' + ic('download') + 'バックアップを保存（ファイル）</button>' +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.copyData()">' + ic('copy') + 'テキストでコピー</button>' +
    '<label class="fl" style="margin-top:18px">バックアップから復元</label>' +
    '<input type="file" id="imp-file" accept=".json,application/json" style="display:none" onchange="APP.importFile(this)" />' +
    '<button class="btn ghost" onclick="document.getElementById(\'imp-file\').click()">' + ic('upload') + 'ファイルを選んで読み込む</button>' +
    '<label class="fl">またはテキストを貼り付けて復元</label>' +
    '<textarea id="imp-text" class="inp" style="height:88px;resize:none" placeholder="バックアップのテキストを貼り付け"></textarea>' +
    '<button class="btn primary" style="margin-top:10px" onclick="APP.importText()">' + ic('check') + '貼り付けから復元</button>' +
    '<div class="card soft" style="margin-top:12px;padding:12px 14px;font-size:12px;color:var(--muted);line-height:1.6">復元すると、いまのデータは読み込んだ内容で置き換わります。</div>' +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.closeSheet()">とじる</button>';
}

function syncSheet() {
  const st = sync.getStatus();
  if (st === 'on') {
    const code = sync.currentCode() || '';
    return '<div style="padding:0 2px"><b style="font-size:18px">家族と共有中</b>' +
      '<div class="sub" style="margin:4px 0 14px">この家族コードを、連動したいスマホの「コードで参加」に入れてください。以後、在庫・献立・買い物・家族がリアルタイムで同じになります。</div></div>' +
      '<div class="card" style="text-align:center;padding:18px 16px">' +
      '<div class="sub" style="margin-bottom:6px">家族コード</div>' +
      '<div class="num" style="font-size:30px;font-weight:800;letter-spacing:.22em;color:var(--green-deep)">' + esc(code) + '</div></div>' +
      '<button class="btn primary" style="margin-top:12px" onclick="APP.copyCode()">' + ic('copy') + 'コードをコピー</button>' +
      '<div class="card soft" style="margin-top:12px;padding:12px 14px;font-size:12px;color:var(--muted);line-height:1.6">' +
      'APIキー・背景写真・表示中の世帯は端末ごとの設定として共有されません（それ以外＝在庫や献立などは全員で同じになります）。</div>' +
      '<button class="btn ghost" style="margin-top:14px;color:var(--rose,#c2506a)" onclick="APP.stopSync()">' + ic('x') + '共有を解除する（この端末）</button>' +
      '<button class="btn ghost" style="margin-top:10px" onclick="APP.closeSheet()">とじる</button>';
  }
  const busy = st === 'connecting';
  return '<div style="padding:0 2px"><b style="font-size:18px">家族でリアルタイム連動</b>' +
    '<div class="sub" style="margin:4px 0 14px">夫婦や実家のスマホと、在庫・献立・買い物・家族を常に同じに保ちます。片方で足りない物を買い物に足せば、もう片方にもすぐ反映されます。</div></div>' +
    '<button class="btn primary" ' + (busy ? 'disabled' : '') + ' onclick="APP.createShare()">' + ic('sync') + (busy ? '接続中…' : '新しく共有を始める（コードを発行）') + '</button>' +
    '<div style="text-align:center;color:var(--faint);font-size:12px;margin:14px 0 6px">— または —</div>' +
    '<label class="fl">家族から共有されたコードで参加</label>' +
    '<input id="sync-code" class="inp num" style="text-transform:uppercase;letter-spacing:.14em;font-size:18px;text-align:center" maxlength="12" placeholder="例）ABCD28" />' +
    '<button class="btn ghost" style="margin-top:10px" ' + (busy ? 'disabled' : '') + ' onclick="APP.joinShare()">' + ic('link') + 'このコードで参加</button>' +
    '<div class="card soft" style="margin-top:12px;padding:12px 14px;font-size:12px;color:var(--muted);line-height:1.6">' +
    '「参加」すると、この端末のデータは共有先の内容に置き換わります（APIキーと背景写真は各端末のまま）。まず親機で「共有を始める」→出たコードを子機で参加、が簡単です。</div>' +
    '<button class="btn ghost" style="margin-top:10px" onclick="APP.closeSheet()">とじる</button>';
}

// ---------- ルーター ----------
const TABS = ['home', 'stock', 'menu', 'shop'];
const SCREENS = { home: homeScreen, stock: stockScreen, menu: menuScreen, shop: shopScreen };

function applyBg() {
  const wrap = document.querySelector('.screen-wrap');
  const el = q('bgphoto');
  const photo = store.bgPhoto();
  if (photo) {
    el.style.backgroundImage = 'url("' + photo + '")';
    const scrim = 1 - (store.bgStrength() / 100) * 0.85; // 見え方が強いほどベールを薄く
    wrap.style.setProperty('--scrim', 'rgba(255,255,255,' + scrim.toFixed(2) + ')');
    wrap.classList.add('has-bg');
  } else {
    el.style.backgroundImage = '';
    wrap.classList.remove('has-bg');
  }
}

function render() {
  const app = q('app');
  app.classList.toggle('senior', store.hh().mode === 'senior');
  applyBg();
  refreshBrand();
  q('view').innerHTML = SCREENS[curTab]();
  const idx = TABS.indexOf(curTab);
  q('pill').style.transform = 'translateX(' + (idx * 100) + '%)';
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('on', i === idx));
  q('view').scrollTop = 0;
  if (curTab === 'home' && store.hh().mode !== 'senior') animRings();
}
function animRings() {
  setTimeout(() => document.querySelectorAll('#rings .val').forEach(c => { c.style.strokeDashoffset = c.getAttribute('data-off'); }), 80);
}
function refreshBrand() {
  const h = store.hh();
  q('hhname').innerHTML = esc(h.name) + ' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  q('hhsub').textContent = h.tag + '・家族' + h.members.length + '人' +
    (h.mode === 'senior' ? '・あっさり表示' : h.mode === 'growing' ? '・食べ盛り' : '');
  const slot = document.querySelector('.topbar .sync, .topbar .hdr-photo-wrap');
  if (slot) {
    const photo = store.headerPhoto();
    const on = sync.isOn();
    if (photo) {
      slot.className = 'hdr-photo-wrap';
      slot.innerHTML = '<span class="hdr-photo" style="background-image:url(&quot;' + photo + '&quot;);opacity:' + (store.headerStrength() / 100).toFixed(2) + '"></span>' +
        '<span class="hdr-dot' + (on ? ' on' : '') + '"></span>';
    } else {
      slot.className = 'sync';
      slot.innerHTML = '<span class="dot"></span>' + (on ? '共有中' : 'この端末');
    }
    slot.style.cursor = 'pointer';
    slot.onclick = () => APP.openHeaderPhoto();
  }
}

// 同期：リモート反映・状態変化のときに開いている画面を最新に描き直す。
function refreshSyncUI() {
  if (ovEl && ovEl.firstChild && overlayIsSettings) openOverlay(settingsView(), true);
  if (sheetEl && sheetEl.querySelector('.sheet') && sheetIsSync) { openSheet(syncSheet()); sheetIsSync = true; }
}
function onSyncRemote() { render(); refreshSyncUI(); }
function onSyncStatus() { refreshSyncUI(); }

// ---------- ハンドラ ----------
const APP = {
  go(tab) { curTab = tab; render(); },
  seg(i) { segIndex = i; q('segbody').innerHTML = segBody(); document.querySelectorAll('#seg button').forEach((b, bi) => b.classList.toggle('on', bi === i)); },

  openHousehold() { openSheet(householdSheet()); },
  switchHH(id) { store.switchHousehold(id); curRecipes = []; gen.error = ''; curTab = 'home'; closeSheet(); render(); },
  openSettings() { closeSheet(); overlayIsSettings = true; openOverlay(settingsView()); },
  back() { overlayIsSettings = false; closeOverlay(); },
  closeSheet() { closeSheet(); },
  toast(m) { toast(m); },

  openRecipe(i) {
    overlayIsSettings = false;
    curRecipe = (i === -1) ? todaysDinner() : (curRecipes[i] || SAMPLE_RECIPES[i] || SAMPLE_RECIPES[0]);
    openOverlay(recipeView(curRecipe));
  },
  nutriTab(demo) { nutriDemo = demo; const el = q('nutri-block'); if (el && curRecipe) el.innerHTML = nutriBlock(curRecipe); },

  generate() { return APP.runGenerate(null); },
  async runGenerate(opts) {
    gen.loading = true; gen.error = '';
    render();                                   // 今いる画面のままローディング表示
    try {
      const recipes = await generateRecipes(buildContext(store.hh()), 4, opts || {});
      if (recipes && recipes.length) { store.saveRecipes(recipes); curRecipes = recipes; }
      gen.loading = false; render();
      const named = opts && ((opts.mustUse && opts.mustUse.length) || opts.request);
      toast(named ? '指定に合わせて献立を作りました' : 'いまの在庫に合わせて献立を更新しました');
    } catch (e) {
      gen.loading = false;
      if (String(e.message) === 'NO_KEY') {
        gen.error = 'APIキーが未設定です。設定から入れると、AIが在庫と家族に合わせて献立を作ります。';
        toast('APIキーが未設定です');
      } else {
        gen.error = 'AIの呼び出しに失敗しました：' + e.message;
        toast('提案に失敗しました：' + e.message);
      }
      render();
    }
  },
  openUseIng() { useIng = []; curTab = 'menu'; openSheet(ingredientPickSheet()); },
  toggleUseIng(name, el) {
    const i = useIng.indexOf(name);
    if (i >= 0) useIng.splice(i, 1); else useIng.push(name);
    if (el) el.classList.toggle('on');
  },
  generateWithIngredients() {
    const req = ((q('use-req') || {}).value || '').trim();
    const names = useIng.slice();
    if (!names.length && !req) { toast('食材を選ぶか、作りたい料理を入力してください'); return; }
    closeSheet(); curTab = 'menu';
    APP.runGenerate({ mustUse: names, request: req });
  },

  // 在庫の「作った」更新
  openMake() {
    const names = (curRecipe.uses_stock || []);
    makeCtx = { names, choices: {} };
    const h = store.hh();
    h.fridge.filter(f => names.some(u => f.name.indexOf(u) === 0 || u.indexOf(f.name) === 0))
      .forEach(f => { makeCtx.choices[f.id] = 'all'; });
    openSheet(makeSheet());
  },
  setConsume(id, ch) { makeCtx.choices[id] = ch; q('makebody').innerHTML = makeBody(); },
  confirmMake() {
    const h = store.hh(); let bought = 0;
    Object.keys(makeCtx.choices).forEach(id => {
      const ch = makeCtx.choices[id]; if (ch === 'none') return;
      const f = h.fridge.find(x => x.id === id); if (!f) return;
      f.qty = ch === 'all' ? 'なし' : ch === 'half' ? '約半分' : '少し';
      f._updated = true;
      if (ch === 'all') { bought++; store.pushShoppingAuto(f.name, 'スーパー'); }
    });
    store.save();
    closeSheet(); closeOverlay();
    curTab = 'stock'; segIndex = 0; render();
    setTimeout(() => { h.fridge.forEach(f => delete f._updated); }, 1400);
    toast(bought > 0 ? '在庫を更新（使い切り' + bought + '品を買い物へ）' : '在庫を更新しました');
  },

  // 在庫編集
  openAddStock() { openSheet(addStockSheet()); },
  pickSec(btn) {
    document.querySelectorAll('#as-sec button').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    const pantry = btn.dataset.v === 'pantry';
    const per = q('as-perishable'); if (per) per.style.display = pantry ? 'none' : '';
    const note = q('as-pantry-note'); if (note) note.style.display = pantry ? '' : 'none';
    if (!pantry) APP.stockRecalc();
  },
  pickDeal(btn) { document.querySelectorAll('#as-deal button').forEach(b => b.classList.remove('on')); btn.classList.add('on'); APP.stockRecalc(); },
  stockGuess(inp) { const c = guessCategory(inp.value); const sel = q('as-cat'); if (sel) sel.value = c; APP.stockRecalc(); },
  stockRecalc() {
    const cat = (q('as-cat') || {}).value || 'other';
    const dealBtn = sheetEl.querySelector('#as-deal .on');
    const deal = dealBtn && dealBtn.dataset.v === '1';
    const secBtn = sheetEl.querySelector('#as-sec .on');
    const sec = secBtn ? secBtn.dataset.v : 'fridge';
    const exp = q('as-exp'); if (exp) exp.value = estimateExpiry(cat, deal, sec);
  },
  saveAddStock() {
    const name = q('as-name').value.trim(); if (!name) { toast('名前を入れてください'); return; }
    const secBtn = sheetEl.querySelector('#as-sec .on');
    const sec = secBtn ? secBtn.dataset.v : 'fridge';
    if (sec === 'pantry') { store.addPantry(name); closeSheet(); segIndex = 2; render(); toast('常備品に登録しました'); return; }
    store.addStock(name, q('as-qty').value, q('as-exp').value || null, sec);
    closeSheet(); render(); toast('追加しました');
  },
  openEditStock(id) { const f = store.hh().fridge.find(x => x.id === id); if (f) openSheet(editStockSheet(f)); },
  saveEditStock(id) {
    store.updateStock(id, { name: q('es-name').value.trim(), qty: q('es-qty').value.trim(), expiry: q('es-exp').value || null });
    closeSheet(); render(); toast('保存しました');
  },
  deleteStock(id) { store.removeStock(id); closeSheet(); render(); toast('削除しました'); },

  // レシート撮影で在庫補充
  openReceipt() { if (rcptLoading) return; const el = q('rcpt-file'); if (el) el.click(); },
  receiptFile(inp) {
    const f = inp.files && inp.files[0];
    inp.value = '';
    if (!f) return;
    rcptLoading = true; render();
    downscaleImage(f, 1600, 0.7)
      .then(url => extractReceiptItems(url))
      .then(items => {
        rcptLoading = false; render();
        if (!items || !items.length) { toast('食材が読み取れませんでした。明るく撮り直してみてください'); return; }
        rcptCtx = { items: items.map(it => Object.assign({ checked: true }, it)) };
        openSheet(receiptSheet());
      })
      .catch(e => {
        rcptLoading = false; render();
        if (String(e.message) === 'NO_KEY') toast('APIキーが未設定です（設定から入れてください）');
        else toast('読み取りに失敗：' + e.message);
      });
  },
  rcptToggle(i) { rcptCtx.items[i].checked = !rcptCtx.items[i].checked; q('rcpt-body').innerHTML = rcptBody(); },
  confirmReceipt() {
    const chosen = rcptCtx.items.filter(x => x.checked);
    if (!chosen.length) { toast('追加する物を選んでください'); return; }
    chosen.forEach(it => {
      if (it.perishable) {
        const cat = it.category || guessCategory(it.name);
        store.addStock(it.name, it.qty || '', estimateExpiry(cat, false, 'fridge'), 'fridge');
      } else {
        store.addPantry(it.name);
      }
    });
    closeSheet(); curTab = 'stock'; segIndex = 0; render();
    toast(chosen.length + '品を在庫に追加しました');
  },

  // 常備品
  openAddPantry() { openSheet(addPantrySheet()); },
  saveAddPantry() { const n = q('ap-name').value.trim(); if (!n) { toast('名前を入れてください'); return; } store.addPantry(n); closeSheet(); render(); toast('登録しました'); },
  togglePantry(id) { store.togglePantry(id); q('segbody').innerHTML = segBody(); },
  removePantry(id) { store.removePantry(id); q('segbody').innerHTML = segBody(); },

  // 買い物
  openAddShop() { openSheet(addShopSheet()); },
  pickGrp(btn) { document.querySelectorAll('#sh-grp button').forEach(b => b.classList.remove('on')); btn.classList.add('on'); },
  saveAddShop() {
    const n = q('sh-name').value.trim(); if (!n) { toast('品名を入れてください'); return; }
    const g = sheetEl.querySelector('#sh-grp .on').dataset.v;
    store.addShopping(n, g); closeSheet(); render(); toast('追加しました');
  },
  toggleShop(id) { store.toggleShopping(id); q('view').innerHTML = shopScreen(); },
  removeShop(id) { const h = store.hh(); h.shopping = h.shopping.filter(x => x.id !== id); store.save(); q('view').innerHTML = shopScreen(); },
  clearDone() { store.clearDoneShopping(); q('view').innerHTML = shopScreen(); },

  // 設定
  setMode(m) { store.setMode(m); openOverlay(settingsView(), true); render(); },
  guest(d) { store.setGuests(d); openOverlay(settingsView(), true); render(); },
  togglePolicy(k) { store.togglePolicy(k); openOverlay(settingsView(), true); },
  openRename() { openSheet(renameSheet()); },
  saveHousehold() {
    const name = q('hh-name').value.trim(); if (!name) { toast('名前を入れてください'); return; }
    store.updateHousehold({ name: name, tag: q('hh-tag').value.trim() });
    closeSheet();
    if (ovEl.firstChild) openOverlay(settingsView(), true);
    render();
    toast('世帯名を変更しました');
  },

  // バックアップ・復元
  openData() { openSheet(dataSheet()); },
  exportData() {
    try {
      const blob = new Blob([store.exportData()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'ai-kitchen-backup.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('バックアップを保存しました');
    } catch (e) { toast('保存に失敗しました'); }
  },
  copyData() {
    const txt = store.exportData();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(() => toast('コピーしました（別端末で貼り付け）')).catch(() => toast('コピーできませんでした'));
    } else { toast('この環境ではコピー不可。ファイル保存をお使いください'); }
  },
  importFile(inp) {
    const f = inp.files && inp.files[0]; inp.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => APP._doImport(String(rd.result));
    rd.onerror = () => toast('ファイルを読めませんでした');
    rd.readAsText(f);
  },
  importText() {
    const t = (q('imp-text') || {}).value || '';
    if (!t.trim()) { toast('テキストを貼り付けてください'); return; }
    APP._doImport(t);
  },
  _doImport(text) {
    if (store.importData(text)) {
      closeSheet(); if (ovEl.firstChild) closeOverlay();
      segIndex = 0; curTab = 'home'; curRecipes = []; gen.error = ''; render();
      toast('データを復元しました');
    } else {
      toast('復元に失敗（データの形式が正しくありません）');
    }
  },

  // 家族と共有（リアルタイム同期）
  openSync() { if (sheetEl.querySelector('.sheet')) closeSheet(); openSheet(syncSheet()); sheetIsSync = true; },
  async createShare() {
    try {
      const code = await sync.createShare();
      openSheet(syncSheet()); sheetIsSync = true;
      if (ovEl.firstChild && overlayIsSettings) openOverlay(settingsView(), true);
      toast('共有を開始しました（コード ' + code + '）');
    } catch (e) { toast('共有を開始できませんでした（通信をご確認ください）'); }
  },
  async joinShare() {
    const v = (q('sync-code') || {}).value || '';
    if (!v.trim()) { toast('コードを入れてください'); return; }
    try {
      await sync.joinShare(v);
      openSheet(syncSheet()); sheetIsSync = true;
      segIndex = 0; curTab = 'home'; curRecipes = []; gen.error = ''; render();
      if (ovEl.firstChild && overlayIsSettings) openOverlay(settingsView(), true);
      toast('参加しました。データを同期しました');
    } catch (e) { toast('参加できませんでした（コードか通信をご確認ください）'); }
  },
  stopSync() {
    sync.stopShare();
    closeSheet();
    if (ovEl.firstChild && overlayIsSettings) openOverlay(settingsView(), true);
    toast('共有を解除しました');
  },
  copyCode() {
    const c = sync.currentCode() || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(c).then(() => toast('コードをコピーしました')).catch(() => toast('コピーできませんでした'));
    } else { toast('この環境ではコピーできません'); }
  },

  // 家族編集
  openMember(id) { const m = id ? store.hh().members.find(x => x.id === id) : null; openSheet(memberSheet(m)); },
  saveMember(id) {
    const name = q('m-name').value.trim(); if (!name) { toast('名前を入れてください'); return; }
    const dis = q('m-dis').value.split(',').map(s => s.trim()).filter(Boolean);
    const birth = q('m-birth').value || '';
    const patch = { name, birth, role: q('m-role').value.trim(), dislikes: dis };
    if (id) store.updateMember(id, patch);
    else store.addMember(Object.assign(patch, { tone: 'green' }));
    closeSheet(); openOverlay(settingsView(), true); render();
    toast(id ? '保存しました' : '追加しました');
  },
  deleteMember(id) { store.removeMember(id); closeSheet(); openOverlay(settingsView(), true); render(); toast('削除しました'); },

  // 来客名簿
  openGuest(id) { const g = id ? (store.hh().guestRoster || []).find(x => x.id === id) : null; openSheet(guestSheet(g)); },
  toggleGuestToddler(row) {
    const s = row.querySelector('#g-tod'); const on = s.getAttribute('data-on') === '1';
    s.setAttribute('data-on', on ? '0' : '1'); s.classList.toggle('on', !on);
  },
  saveGuest(id) {
    const name = q('g-name').value.trim() || '来客';
    const dis = q('g-dis').value.split(',').map(s => s.trim()).filter(Boolean);
    const patch = { name, birth: q('g-birth').value || '', dislikes: dis, toddler: q('g-tod').getAttribute('data-on') === '1' };
    if (id) store.updateGuest(id, patch);
    else store.addGuest(Object.assign(patch, { active: true }));
    closeSheet(); if (ovEl.firstChild) openOverlay(settingsView(), true); render();
    toast(id ? '保存しました' : '来客を登録しました');
  },
  removeGuest(id) { store.removeGuest(id); closeSheet(); if (ovEl.firstChild) openOverlay(settingsView(), true); render(); toast('削除しました'); },
  toggleGuest(id) {
    store.toggleGuest(id);
    if (ovEl.firstChild && overlayIsSettings) openOverlay(settingsView(), true);
    render();
    toast(store.hh().guestRoster.find(g => g.id === id).active ? '来客を加算しました' : '来客を除外しました');
  },

  // APIキー
  openApiKey() { if (sheetEl.querySelector('.sheet')) closeSheet(); openSheet(apiKeySheet()); },
  saveApiKey() {
    const v = q('key-inp').value.trim();
    if (!v) {
      if (store.apiKey()) { closeSheet(); toast('キーは設定済みです'); }
      else toast('キーを入れてください');
      return;
    }
    store.setApiKey(v); closeSheet();
    if (ovEl.firstChild) openOverlay(settingsView(), true);
    render(); toast('キーを保存しました');
  },
  clearApiKey() { store.setApiKey(''); closeSheet(); if (ovEl.firstChild) openOverlay(settingsView(), true); render(); toast('キーを削除しました'); },
  toggleShareKey() {
    const willShare = !store.keyIsShared();
    if (willShare && !store.apiKey()) { toast('先にこの端末のキーを保存してください'); return; }
    store.setShareKey(willShare);
    openSheet(apiKeySheet());
    if (ovEl.firstChild && overlayIsSettings) openOverlay(settingsView(), true);
    render();
    toast(willShare ? '家族全員でこのキーを使う設定にしました' : '家族共有をオフにしました');
  },
  pickModel(btn) { store.setModel(btn.dataset.v); document.querySelectorAll('#key-model button').forEach(b => b.classList.remove('on')); btn.classList.add('on'); },

  // 背景写真
  openBg() { if (sheetEl.querySelector('.sheet')) closeSheet(); openSheet(bgSheet()); },
  pickBgFile(inp) {
    const f = inp.files && inp.files[0]; if (!f) return;
    toast('写真を読み込み中…');
    downscaleImage(f, 1200, 0.72).then(url => {
      store.setBgPhoto(url); applyBg();
      if (ovEl.firstChild) openOverlay(settingsView(), true);
      openSheet(bgSheet());
      toast('背景を設定しました');
    }).catch(() => toast('画像を読み込めませんでした'));
  },
  bgStrength(v) { store.setBgStrength(parseInt(v, 10)); applyBg(); },
  clearBg() { store.setBgPhoto(''); applyBg(); if (ovEl.firstChild) openOverlay(settingsView(), true); openSheet(bgSheet()); toast('背景をなしにしました'); },

  // 右上の家族写真
  openHeaderPhoto() { if (sheetEl.querySelector('.sheet')) closeSheet(); openSheet(headerPhotoSheet()); },
  pickHeaderFile(inp) {
    const f = inp.files && inp.files[0]; if (!f) return;
    toast('写真を読み込み中…');
    downscaleImage(f, 320, 0.82).then(url => {
      store.setHeaderPhoto(url); refreshBrand();
      if (ovEl.firstChild && overlayIsSettings) openOverlay(settingsView(), true);
      openSheet(headerPhotoSheet());
      toast('右上に家族写真を設定しました');
    }).catch(() => toast('画像を読み込めませんでした'));
  },
  headerStrength(v) { store.setHeaderStrength(parseInt(v, 10)); refreshBrand(); },
  clearHeaderPhoto() { store.setHeaderPhoto(''); refreshBrand(); if (ovEl.firstChild && overlayIsSettings) openOverlay(settingsView(), true); openSheet(headerPhotoSheet()); toast('右上の写真をなしにしました'); }
};

// 端末内保存に収まるよう、選んだ写真を縮小してデータURLにする。
function downscaleImage(file, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        const scale = Math.min(1, maxEdge / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function init() {
  store.load();
  ovEl = q('overlay'); sheetEl = q('sheetroot'); toastEl = q('toast');
  document.querySelector('.brand .logo').innerHTML = ic('cutlery');
  q('clock').textContent = clockLabel();
  setInterval(() => { q('clock').textContent = clockLabel(); }, 30000);

  // タブバー生成
  const tb = q('tabbar');
  const meta = [['home', 'home', 'ホーム'], ['fridge', 'stock', '在庫'], ['book', 'menu', '献立'], ['cart', 'shop', '買い物']];
  meta.forEach(m => {
    const d = document.createElement('div'); d.className = 'tab';
    d.innerHTML = ic(m[0]) + '<span>' + m[2] + '</span>';
    d.onclick = () => APP.go(m[1]);
    tb.appendChild(d);
  });
  const brand = document.querySelector('.brand');
  brand.style.cursor = 'pointer';
  brand.onclick = () => APP.openHousehold();

  window.APP = APP;
  sync.initSync({ onRemoteChange: onSyncRemote, onStatusChange: onSyncStatus });
  render();
}
