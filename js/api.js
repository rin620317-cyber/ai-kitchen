// 献立AI。Google Gemini API に在庫・常備品・家族構成を渡し、
// 栄養・取り分け・時短を考慮した献立をJSONで受け取る。
// キー未設定・オフライン時はサンプル献立で全画面が動く。
import { effectiveApiKey, model, servingCount, toddlerPresent, dislikes } from './store.js';
import { daysUntil } from './util.js';

// 最安クラス（無料枠あり）の Flash-Lite を既定に。高品質側は Flash。
const MODELS = { flash: 'gemini-2.5-flash', 'flash-lite': 'gemini-2.5-flash-lite' };

function ageYears(birth) {
  if (!birth) return null;
  const b = new Date(birth), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  const m = n.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--;
  return a;
}

// 家族・在庫を、モデルに渡すコンパクトな文脈に整形。
export function buildContext(h) {
  return {
    人数: servingCount(h),
    モード: h.mode === 'growing' ? '食べ盛り（分量を1.3倍で多めに）'
      : h.mode === 'senior' ? 'シニア（薄味・やわらかめ・少量目安）' : '標準',
    お泊まり追加: h.guests || 0,
    家族: h.members.map(m => ({
      名前: m.name, 年齢: ageYears(m.birth), 役割: m.role || '', 苦手: m.dislikes || [], 幼児: !!m.toddler
    })),
    苦手食材: dislikes(h),
    取り分け対応: toddlerPresent(h),
    方針: {
      平日は時短優先: !!h.policy.timeSaver,
      栄養バランス重視: !!h.policy.nutrition,
      幼児の取り分けを常に用意: !!h.policy.toddlerSplit
    },
    冷蔵庫の中身: h.fridge.map(f => ({
      名前: f.name, 量: f.qty, 期限まで日数: f.expiry ? daysUntil(f.expiry) : null, 場所: f.section === 'freezer' ? '冷凍' : '冷蔵'
    })),
    常備品: h.pantry.filter(p => p.ok).map(p => p.name)
  };
}

// Gemini の responseSchema（OpenAPI サブセット・型は大文字）。
const RECIPE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    recipes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          minutes: { type: 'INTEGER' },
          kcal: { type: 'INTEGER' },
          tag: { type: 'STRING' },
          reason: { type: 'STRING' },
          ingredients: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { name: { type: 'STRING' }, amount: { type: 'STRING' } },
              required: ['name', 'amount']
            }
          },
          steps: { type: 'ARRAY', items: { type: 'STRING' } },
          nutrition: {
            type: 'OBJECT',
            properties: {
              protein_g: { type: 'NUMBER' }, fat_g: { type: 'NUMBER' },
              carb_g: { type: 'NUMBER' }, salt_g: { type: 'NUMBER' }, veg_g: { type: 'NUMBER' }
            },
            required: ['protein_g', 'fat_g', 'carb_g', 'salt_g', 'veg_g']
          },
          toddler_note: { type: 'STRING' },
          senior_note: { type: 'STRING' },
          components: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { role: { type: 'STRING' }, name: { type: 'STRING' } },
              required: ['role', 'name']
            }
          },
          uses_stock: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['name', 'minutes', 'kcal', 'tag', 'reason', 'components', 'ingredients', 'steps', 'nutrition', 'toddler_note', 'senior_note', 'uses_stock']
      }
    }
  },
  required: ['recipes']
};

const SYSTEM = [
  'あなたは日本の家庭の献立を提案する管理栄養士アシスタントです。',
  '与えられた「冷蔵庫の中身」と「常備品」で作れる夕食を、一汁三菜で提案します。',
  'ルール:',
  '・各提案は「一汁三菜」を基本とし、主食（ごはん等）＋汁物＋主菜＋副菜2品で構成する。',
  '・componentsに各料理を {role, name} の形で列挙する（roleは 主食 / 汁物 / 主菜 / 副菜 のいずれか）。',
  '・ingredients と steps は献立全体（すべての料理分）をまとめて記載する。手順は料理ごとに分かるよう簡潔に。',
  '・平日で時短優先でも、即席の汁物や和える程度の簡単な副菜で一汁三菜を目指す。',
  '・nutrition と kcal は献立全体（1人分の合計）の目安。',
  '・冷蔵庫の食材、特に期限が近いものを優先して使い切る。',
  '・常備品（調味料・米など）は常にある前提で自由に使ってよい。買い物には出さない。',
  '・苦手食材は使わないか、代替・別添えにする。',
  '・モードが食べ盛りなら分量を多めに、シニアなら薄味・やわらかめ・食べやすい大きさにする。',
  '・「取り分け対応」がtrueなら、味付け前に幼児分を取り分ける手順とtoddler_noteを必ず入れる。',
  '・栄養バランス重視なら主菜だけに偏らず、副菜や汁物を献立に織り込む。',
  '・平日は時短優先ならなるべく20分前後で作れるものを含める。',
  '・栄養値(nutrition)は1人分のおおよその目安でよい。kcalも1人分。',
  '・toddler_note/senior_noteは該当しなければ空文字。',
  '・uses_stockには冷蔵庫から実際に使う食材名だけを入れる（常備品は含めない）。',
  '・すべて日本語で、家庭で作りやすい定番寄りの提案にする。'
].join('\n');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 一時的な混雑・レート制限・サーバー側エラーか（＝リトライする価値があるか）。
function isTransient(status, msg) {
  if (status === 429 || status >= 500) return true;
  return /high demand|overloaded|temporarily|unavailable|try again|rate limit/i.test(msg || '');
}

async function callGemini(modelId, body) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelId + ':generateContent';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': effectiveApiKey() },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg = 'API_ERROR_' + res.status;
    try { const j = await res.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) {}
    const err = new Error(msg); err.transient = isTransient(res.status, msg); throw err;
  }
  const data = await res.json();
  const cand = (data.candidates && data.candidates[0]) || null;
  if (!cand || !cand.content || !cand.content.parts) {
    const err = new Error('AIの応答が空でした。もう一度お試しください。'); err.transient = true; throw err;
  }
  const text = cand.content.parts.map(p => p.text || '').join('');
  return JSON.parse(text);
}

// 混雑リトライ＋flashフォールバックの共通ループ。extractで欲しい配列を取り出す。
async function runWithRetry(body, extract) {
  const chosen = model();
  const chain = chosen === 'flash-lite'
    ? ['flash-lite', 'flash-lite', 'flash-lite', 'flash']
    : ['flash', 'flash', 'flash'];
  const waits = [700, 1600, 2600, 1500];
  let lastErr = null;
  for (let i = 0; i < chain.length; i++) {
    try { return extract(await callGemini(MODELS[chain[i]], body)); }
    catch (e) {
      lastErr = e;
      if (!e.transient) throw e;
      if (i < chain.length - 1) await sleep(waits[i] || 1500);
    }
  }
  throw lastErr || new Error('API_ERROR');
}

export async function generateRecipes(context, count) {
  const key = effectiveApiKey();
  if (!key) throw new Error('NO_KEY');
  const body = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{
      role: 'user',
      parts: [{
        text: '次の家庭に、夕食の献立を' + (count || 4) + '案、JSONで提案してください。\n' +
          JSON.stringify(context, null, 2)
      }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: RECIPE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };
  // 最安(flash-lite)を数回リトライ→なお混雑なら高品質(flash)へ自動フォールバック。
  return runWithRetry(body, (o) => o.recipes || []);
}

// レシート画像から購入した食材を抽出する。
const RECEIPT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          qty: { type: 'STRING' },
          category: { type: 'STRING' },
          perishable: { type: 'BOOLEAN' }
        },
        required: ['name', 'qty', 'category', 'perishable']
      }
    }
  },
  required: ['items']
};

const RECEIPT_SYSTEM = [
  'あなたはレシート画像から、購入した食品・食材だけを抽出するアシスタントです。',
  '・食品/食材のみを対象。日用品・生活用品・レジ袋・ポイント・値引き行などは除外する。',
  '・nameは分かりやすい一般的な食材名に正規化する（商品名や略称は言い換える）。',
  '・qtyは数量や内容量が読み取れれば入れる（不明なら空文字）。',
  '・categoryは veg / fruit / meat / fish / dairy / deli / pantry / other のいずれか。',
  '・perishableは、冷蔵・冷凍が必要な生鮮品なら true、常温保存できるもの（調味料・油・乾物・缶詰・米・菓子など）なら false。',
  '・読み取れない、または食品が無ければ items を空配列にする。'
].join('\n');

export async function extractReceiptItems(imageDataUrl) {
  const key = effectiveApiKey();
  if (!key) throw new Error('NO_KEY');
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(imageDataUrl || '');
  if (!m) throw new Error('画像を読み込めませんでした');
  const body = {
    system_instruction: { parts: [{ text: RECEIPT_SYSTEM }] },
    contents: [{
      role: 'user',
      parts: [
        { text: 'このレシート画像から、購入した食材をJSONで抽出してください。' },
        { inline_data: { mime_type: m[1], data: m[2] } }
      ]
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: RECEIPT_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };
  return runWithRetry(body, (o) => o.items || []);
}

// キー無し・オフライン用の見本献立（スキーマと同形）。
export const SAMPLE_RECIPES = [
  {
    name: '鶏もも肉の照り焼き', minutes: 30, kcal: 620, tag: '在庫で作れる',
    reason: '冷蔵庫の鶏もも肉とほうれん草・キャベツで作れます。',
    components: [
      { role: '主食', name: 'ごはん' }, { role: '汁物', name: 'キャベツの味噌汁' },
      { role: '主菜', name: '鶏もも肉の照り焼き' }, { role: '副菜', name: 'ほうれん草の胡麻和え' }
    ],
    ingredients: [
      { name: '鶏もも肉', amount: '3枚' }, { name: '醤油・みりん・酒', amount: '各大さじ3' },
      { name: '砂糖', amount: '大さじ1' }, { name: 'ほうれん草', amount: '1束' }, { name: 'キャベツ', amount: '1/4個' }
    ],
    steps: [
      '鶏肉を一口大に切り、フライパンで皮目から焼く。',
      '焼き色がついたら子ども分を取り分け、残りに調味料を加える。',
      '煮からめて完成。ほうれん草の胡麻和えと味噌汁を添える。'
    ],
    nutrition: { protein_g: 32, fat_g: 28, carb_g: 18, salt_g: 2.1, veg_g: 90 },
    toddler_note: '味付け前に取り分け、湯通しして薄味に。鶏は5mm角に切って食べやすく。',
    senior_note: '', uses_stock: ['鶏もも肉', 'ほうれん草', 'キャベツ']
  },
  {
    name: '豚こまと玉ねぎの生姜焼き', minutes: 20, kcal: 540, tag: '期限が近い豚こまを使い切り',
    reason: '明日までの豚こま肉を優先。玉ねぎは常備品から。',
    components: [
      { role: '主食', name: 'ごはん' }, { role: '汁物', name: '豆腐とわかめの味噌汁' },
      { role: '主菜', name: '豚こまと玉ねぎの生姜焼き' }, { role: '副菜', name: 'キャベツの浅漬け' }
    ],
    ingredients: [
      { name: '豚こま肉', amount: '300g' }, { name: '玉ねぎ', amount: '1個' },
      { name: '生姜・醤油・みりん', amount: '適量' }
    ],
    steps: ['豚こまと薄切り玉ねぎを炒める。', '火が通ったら子ども分を取り分ける。', 'すりおろし生姜と調味料をからめる。'],
    nutrition: { protein_g: 26, fat_g: 24, carb_g: 16, salt_g: 1.9, veg_g: 70 },
    toddler_note: '取り分け分は生姜控えめ、細かく刻んで。', senior_note: '', uses_stock: ['豚こま肉']
  },
  {
    name: '鮭と野菜のホイル焼き', minutes: 25, kcal: 410, tag: '野菜たっぷり・減塩',
    reason: '冷凍の鮭とキャベツで。蒸し焼きでやわらかく減塩。',
    components: [
      { role: '主食', name: 'ごはん' }, { role: '汁物', name: '玉ねぎの和風スープ' },
      { role: '主菜', name: '鮭と野菜のホイル焼き' }, { role: '副菜', name: 'ほうれん草のおひたし' }
    ],
    ingredients: [
      { name: '鮭', amount: '4切れ' }, { name: 'キャベツ', amount: '1/4個' },
      { name: '玉ねぎ', amount: '1/2個' }, { name: 'バター・塩', amount: '少々' }
    ],
    steps: ['野菜と鮭をホイルに包む。', 'フライパンかトースターで蒸し焼き。', '子ども・シニア分は塩控えめで別包みに。'],
    nutrition: { protein_g: 28, fat_g: 16, carb_g: 12, salt_g: 1.2, veg_g: 110 },
    toddler_note: '骨を丁寧に取り、身をほぐして。', senior_note: 'やわらかく食べやすい。塩は控えめでだしを効かせて。', uses_stock: ['鮭（冷凍）', 'キャベツ']
  },
  {
    name: '親子丼', minutes: 25, kcal: 680, tag: '食べ盛りも満足',
    reason: '鶏もも肉と卵で。ごはんが進む定番。',
    components: [
      { role: '主食', name: '親子丼' }, { role: '汁物', name: 'なめこの味噌汁' },
      { role: '副菜', name: '小松菜のおひたし' }, { role: '副菜', name: '冷奴' }
    ],
    ingredients: [
      { name: '鶏もも肉', amount: '2枚' }, { name: '卵', amount: '5個' },
      { name: '玉ねぎ', amount: '1個' }, { name: '醤油・みりん・だし', amount: '適量' }
    ],
    steps: ['鶏と玉ねぎを煮る。', '溶き卵を回し入れて半熟に。', 'ごはんにのせて完成。'],
    nutrition: { protein_g: 30, fat_g: 20, carb_g: 78, salt_g: 2.3, veg_g: 40 },
    toddler_note: '卵はしっかり火を通し、小さめの器に取り分けて。', senior_note: '', uses_stock: ['鶏もも肉', '卵']
  }
];
