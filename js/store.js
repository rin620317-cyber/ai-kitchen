// アプリの状態管理と端末内保存(localStorage)。
// v1は端末内のみ。将来ここをFirestore等に差し替えれば「常に連動」に拡張できる。
import { dateFromNow, uid } from './util.js';

const KEY = 'futari.kitchen.state.v2';

function seed() {
  return {
    version: 1,
    apiKey: '',
    model: 'flash-lite',
    currentHouseholdId: 'hh-hayashi',
    households: [
      {
        id: 'hh-hayashi', name: '林家', tag: '自宅', mode: 'growing', guests: 0,
        policy: { timeSaver: true, nutrition: true, toddlerSplit: true },
        members: [
          { id: uid(), name: '夫', initial: '夫', tone: 'green', birth: '1985-03-12', role: 'しっかり量', toddler: false, dislikes: [] },
          { id: uid(), name: '妻', initial: '妻', tone: 'rose', birth: '1988-07-20', role: '野菜多め希望', toddler: false, dislikes: [] },
          { id: uid(), name: '長男', initial: '長', tone: 'amber', birth: '2014-05-08', role: '食べ盛り・多め', toddler: false, dislikes: [] },
          { id: uid(), name: '長女', initial: '長', tone: 'amber', birth: '2016-09-15', role: '', toddler: false, dislikes: ['ピーマン'] },
          { id: uid(), name: '次男', initial: '次', tone: 'rose', birth: '2024-01-22', role: '取り分け・薄味', toddler: true, dislikes: [] }
        ],
        fridge: [
          { id: uid(), name: '鶏もも肉', qty: '2枚', expiry: dateFromNow(2), section: 'fridge' },
          { id: uid(), name: '豚こま肉', qty: '300g', expiry: dateFromNow(1), section: 'fridge' },
          { id: uid(), name: '卵', qty: '6個', expiry: dateFromNow(9), section: 'fridge' },
          { id: uid(), name: '牛乳', qty: '残りわずか', expiry: dateFromNow(3), section: 'fridge' },
          { id: uid(), name: 'ほうれん草', qty: '1束', expiry: dateFromNow(2), section: 'fridge' },
          { id: uid(), name: 'キャベツ', qty: '1/2個', expiry: dateFromNow(5), section: 'fridge' },
          { id: uid(), name: '冷凍うどん', qty: '3玉', expiry: dateFromNow(42), section: 'freezer' },
          { id: uid(), name: '鮭（冷凍）', qty: '4切れ', expiry: dateFromNow(30), section: 'freezer' }
        ],
        pantry: [
          { id: uid(), name: '米', ok: true }, { id: uid(), name: '醤油', ok: true },
          { id: uid(), name: '味噌', ok: true }, { id: uid(), name: 'みりん・酒', ok: true },
          { id: uid(), name: '砂糖', ok: true }, { id: uid(), name: 'サラダ油', ok: false },
          { id: uid(), name: '玉ねぎ', ok: true }, { id: uid(), name: 'じゃがいも', ok: true }
        ],
        shopping: [
          { id: uid(), name: '牛乳 2本', who: '妻', tone: 'rose', done: false, group: 'スーパー' },
          { id: uid(), name: 'サラダ油', who: '常備品', tone: 'green', done: false, group: 'スーパー' },
          { id: uid(), name: 'おむつ Lサイズ', who: '妻', tone: 'rose', done: false, group: 'ドラッグストア' }
        ],
        savedRecipes: []
      },
      {
        id: 'hh-jikka', name: '実家', tag: '祖父母', mode: 'senior', guests: 0,
        policy: { timeSaver: false, nutrition: true, toddlerSplit: true },
        members: [
          { id: uid(), name: '祖父', initial: '祖', tone: 'green', birth: '1952-04-10', role: '薄味・やわらかめ', toddler: false, dislikes: [] },
          { id: uid(), name: '祖母', initial: '祖', tone: 'rose', birth: '1955-08-03', role: '少なめでOK', toddler: false, dislikes: [] }
        ],
        fridge: [
          { id: uid(), name: '鶏もも肉', qty: '1枚', expiry: dateFromNow(2), section: 'fridge' },
          { id: uid(), name: '豆腐', qty: '1丁', expiry: dateFromNow(2), section: 'fridge' },
          { id: uid(), name: '大根', qty: '1/2本', expiry: dateFromNow(6), section: 'fridge' }
        ],
        pantry: [
          { id: uid(), name: '米', ok: true }, { id: uid(), name: '醤油', ok: true },
          { id: uid(), name: '味噌', ok: true }, { id: uid(), name: 'だしパック', ok: false }
        ],
        shopping: [
          { id: uid(), name: '豆腐 2丁', who: '祖母', tone: 'rose', done: false, group: 'スーパー' }
        ],
        savedRecipes: []
      }
    ]
  };
}

let state = null;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { state = JSON.parse(raw); }
  } catch (e) { /* 壊れていたら作り直す */ }
  if (!state || !state.households) state = seed();
  return state;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 容量超過等は無視 */ }
}

export function getState() { return state; }

// バックアップ：現在のデータをJSON文字列で書き出す。
export function exportData() { return JSON.stringify(state); }

// 復元：JSON文字列を検証して全データを置き換える。成功でtrue。
export function importData(str) {
  let parsed;
  try { parsed = JSON.parse(str); } catch (e) { return false; }
  if (!parsed || !Array.isArray(parsed.households) || !parsed.households.length) return false;
  state = parsed;
  if (!state.households.some(h => h.id === state.currentHouseholdId)) {
    state.currentHouseholdId = state.households[0].id;
  }
  save();
  return true;
}

export function hh() {
  return state.households.find(h => h.id === state.currentHouseholdId) || state.households[0];
}

export function switchHousehold(id) {
  state.currentHouseholdId = id;
  save();
}

export function updateHousehold(patch) { Object.assign(hh(), patch); save(); }

export function setApiKey(k) { state.apiKey = (k || '').trim(); save(); }
export function apiKey() { return state.apiKey; }

export function model() { const m = state.model; return (m === 'flash' || m === 'flash-lite') ? m : 'flash-lite'; }
export function setModel(m) { state.model = m; save(); }

// 世帯ごとの背景写真（データURL）と、白オーバーレイの強さ(0-100=写真の見え方)。
export function bgPhoto() { return hh().bgPhoto || ''; }
export function bgStrength() { const h = hh(); return (h.bgStrength == null ? 35 : h.bgStrength); }
export function setBgPhoto(dataUrl) { hh().bgPhoto = dataUrl || ''; save(); }
export function setBgStrength(v) { hh().bgStrength = Math.max(0, Math.min(100, v)); save(); }

export function setMode(mode) { hh().mode = mode; save(); }
export function setGuests(delta) {
  const h = hh();
  h.guests = Math.max(0, Math.min(6, (h.guests || 0) + delta));
  save();
}
export function togglePolicy(k) { const h = hh(); h.policy[k] = !h.policy[k]; save(); }

export function servingCount(h) { h = h || hh(); return h.members.length + (h.guests || 0); }

export function toddlerPresent(h) {
  h = h || hh();
  if (h.members.some(m => m.toddler)) return true;
  // 実家に孫（乳幼児含む）が泊まる想定
  return h.id === 'hh-jikka' && (h.guests || 0) > 0;
}

export function dislikes(h) {
  h = h || hh();
  const set = new Set();
  h.members.forEach(m => (m.dislikes || []).forEach(d => set.add(d)));
  return Array.from(set);
}

// 在庫・買い物の編集
export function addStock(name, qty, expiry, section) {
  hh().fridge.push({ id: uid(), name: name.trim(), qty: (qty || '').trim(), expiry: expiry || null, section: section || 'fridge' });
  save();
}
export function updateStock(id, patch) {
  const it = hh().fridge.find(x => x.id === id);
  if (it) { Object.assign(it, patch); save(); }
}
export function removeStock(id) {
  const h = hh(); h.fridge = h.fridge.filter(x => x.id !== id); save();
}

export function addPantry(name) { hh().pantry.push({ id: uid(), name: name.trim(), ok: true }); save(); }
export function togglePantry(id) { const p = hh().pantry.find(x => x.id === id); if (p) { p.ok = !p.ok; save(); } }
export function removePantry(id) { const h = hh(); h.pantry = h.pantry.filter(x => x.id !== id); save(); }

export function addShopping(name, group) {
  hh().shopping.push({ id: uid(), name: name.trim(), who: '追加', tone: 'green', done: false, group: group || 'スーパー' });
  save();
}
export function pushShoppingAuto(name, group) {
  const list = hh().shopping;
  if (list.some(x => x.name.indexOf(name) === 0 && !x.done)) return;
  list.push({ id: uid(), name: name, who: '自動', tone: 'green', done: false, group: group || 'スーパー' });
}
export function toggleShopping(id) { const s = hh().shopping.find(x => x.id === id); if (s) { s.done = !s.done; save(); } }
export function clearDoneShopping() { const h = hh(); h.shopping = h.shopping.filter(x => !x.done); save(); }

// 家族の編集
export function addMember(m) {
  hh().members.push(Object.assign({ id: uid(), initial: (m.name || '＋').slice(0, 1), tone: 'green', dislikes: [] }, m));
  save();
}
export function updateMember(id, patch) {
  const m = hh().members.find(x => x.id === id);
  if (m) { Object.assign(m, patch); save(); }
}
export function removeMember(id) {
  const h = hh(); h.members = h.members.filter(x => x.id !== id); save();
}

export function saveRecipes(list) { hh().savedRecipes = list; save(); }
