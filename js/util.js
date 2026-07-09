// 日付・年齢・整形などの小さなヘルパー群。

export function pad(n) { return (n < 10 ? '0' : '') + n; }

export function today() { return new Date(); }

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export function todayLabel() {
  const d = today();
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()] + '曜日';
}

export function clockLabel() {
  const d = today();
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// 生年月日(YYYY-MM-DD)から年齢を自動計算。乳幼児は「◯歳◯か月」。
export function ageLabel(birth, toddler) {
  if (!birth) return '';
  const b = new Date(birth);
  const now = today();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  if (toddler || a < 3) {
    let mo = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
    if (now.getDate() < b.getDate()) mo--;
    return a + '歳' + (mo - a * 12) + 'か月';
  }
  return a + '歳';
}

export function birthLabel(birth) {
  if (!birth) return '';
  const b = new Date(birth);
  return b.getFullYear() + '.' + pad(b.getMonth() + 1) + '.' + pad(b.getDate());
}

// 賞味期限(YYYY-MM-DD)の見せ方。近いほど強い色。
export function expiryInfo(dateStr) {
  if (!dateStr) return { text: '期限なし', cls: 'c-line' };
  const d = new Date(dateStr);
  const now = today();
  const days = Math.floor((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days < 0) return { text: '期限切れ', cls: 'c-danger', days };
  if (days === 0) return { text: '今日まで', cls: 'c-danger', days };
  if (days === 1) return { text: '明日まで', cls: 'c-danger', days };
  const label = (d.getMonth() + 1) + '/' + d.getDate() + 'まで';
  return { text: label, cls: days <= 2 ? 'c-amber' : 'c-line', days };
}

export function daysUntil(dateStr) {
  if (!dateStr) return 9999;
  const d = new Date(dateStr);
  const now = today();
  return Math.floor((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}

// 相対日付(今日から+n日)のYYYY-MM-DD。サンプルデータ用。
export function dateFromNow(days) {
  const d = new Date(today().getTime() + days * 86400000);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

let _seq = 0;
export function uid() {
  _seq += 1;
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id' + Date.now().toString(36) + '_' + _seq.toString(36);
}

// 名前から食材カテゴリを推測（賞味期限の自動算出に使う）。
export function guessCategory(name) {
  const n = String(name || '');
  if (/鶏|豚|牛|肉|ひき|ミンチ|ハム|ソーセージ|ベーコン|ウインナー/.test(n)) return 'meat';
  if (/鮭|さけ|魚|さば|鯖|あじ|鰺|いわし|鰯|まぐろ|鮪|ぶり|鰤|えび|海老|いか|烏賊|たこ|蛸|刺身|切り身|たら|鱈|ほたて|貝/.test(n)) return 'fish';
  if (/牛乳|ヨーグルト|チーズ|バター|生クリーム|乳/.test(n)) return 'dairy';
  if (/りんご|林檎|バナナ|みかん|蜜柑|いちご|苺|ぶどう|葡萄|果物|フルーツ|メロン|桃|梨|柿|キウイ/.test(n)) return 'fruit';
  if (/キャベツ|きゃべつ|ほうれん|大根|人参|にんじん|玉ねぎ|たまねぎ|じゃが|トマト|きゅうり|胡瓜|なす|茄子|ピーマン|レタス|白菜|ねぎ|ネギ|もやし|ブロッコリ|きのこ|しめじ|えのき|しいたけ|ごぼう|かぼちゃ|ほうれん草|小松菜|水菜|野菜|豆苗/.test(n)) return 'veg';
  if (/惣菜|弁当|サラダ|コロッケ|唐揚げ|天ぷら/.test(n)) return 'deli';
  return 'other';
}

export const CATEGORIES = [
  { v: 'veg', label: '野菜' }, { v: 'fruit', label: '果物' },
  { v: 'meat', label: '肉' }, { v: 'fish', label: '魚' },
  { v: 'dairy', label: '乳製品' }, { v: 'deli', label: '惣菜' }, { v: 'other', label: 'その他' }
];

// カテゴリ×購入区分（通常/おつとめ品）×保存場所から、賞味期限の目安日数を算出。
// おつとめ品（見切り・値引き品）は期限が近いので短めに見積もる。
const SHELF = {
  veg: [6, 2], fruit: [6, 2], meat: [3, 1], fish: [2, 1], dairy: [7, 3], deli: [2, 1], other: [7, 3]
};
export function estimateExpiry(category, deal, section) {
  if (section === 'freezer') return dateFromNow(deal ? 30 : 45);
  const pair = SHELF[category] || SHELF.other;
  return dateFromNow(deal ? pair[1] : pair[0]);
}

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
