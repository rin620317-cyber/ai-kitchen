// 家族コード方式のリアルタイム同期（Firebase Firestore + 匿名認証）。
// Firebase SDK はCDNから「必要になった時だけ」遅延読み込みする。
// → オフラインやCDN読み込み失敗時でも、アプリ本体はローカルのみで普通に動く。
//
// 仕組み：families/{家族コード} という1つのドキュメントに、家族全員で共有する
// データ（JSON文字列）を置く。誰かが編集→setDoc、他の端末は onSnapshot で
// リアルタイム受信して反映（後勝ち＝最後の書き込みが正）。
// APIキー・背景写真・表示中の世帯は端末ごとに保持（store.syncPayload で除外）。
import * as store from './store.js';

// 公開してよい設定（Firebaseのウェブ設定は公開前提。安全性はFirestoreルールで担保）。
const FB = {
  apiKey: 'AIzaSyCk8tQMTdw5qw-e2yd6l887eK97kLOVr28',
  authDomain: 'ai-kitchen-28837.firebaseapp.com',
  projectId: 'ai-kitchen-28837',
  storageBucket: 'ai-kitchen-28837.firebasestorage.app',
  messagingSenderId: '468016875999',
  appId: '1:468016875999:web:e5c8c058e04959346b1c6a'
};
const V = '10.12.5';                              // Firebase SDK バージョン（CDN）
const CODE_KEY = 'futari.kitchen.sync.code';      // この端末が参加中の家族コード

let fb = null;          // { app, auth, db, fs, authApi }
let uid = null;         // 匿名認証のユーザーID
let code = null;        // 現在の家族コード
let unsub = null;       // onSnapshot 解除関数
let pushTimer = null;   // 送信のデバウンス
let lastPushed = 0;     // この端末が最後に書き込んだ updatedAt（自分のエコー無視用）
let onRemote = null;    // リモート反映時のUI再描画コールバック
let onStatus = null;    // 状態変化の通知
let status = 'off';     // off | connecting | on | error

export function initSync({ onRemoteChange, onStatusChange }) {
  onRemote = onRemoteChange; onStatus = onStatusChange;
  store.setOnSave(scheduleLocalPush);             // ローカル保存のたびに送信予約
  code = localStorage.getItem(CODE_KEY) || null;
  if (code) start().catch(() => setStatus('error'));  // 前回のコードで自動再接続
}

export function currentCode() { return code; }
export function getStatus() { return status; }
export function isOn() { return status === 'on'; }

function setStatus(s) { status = s; if (onStatus) { try { onStatus(s); } catch (e) { /* noop */ } } }

// ---- Firebase 遅延ロード / 認証 ----
async function ensureFirebase() {
  if (fb) return fb;
  const base = 'https://www.gstatic.com/firebasejs/' + V + '/';
  const [appMod, authMod, fsMod] = await Promise.all([
    import(base + 'firebase-app.js'),
    import(base + 'firebase-auth.js'),
    import(base + 'firebase-firestore.js')
  ]);
  const app = appMod.initializeApp(FB);
  fb = { app, authApi: authMod, fs: fsMod, auth: authMod.getAuth(app), db: fsMod.getFirestore(app) };
  return fb;
}
async function ensureAuth() {
  await ensureFirebase();
  if (uid) return uid;
  const cred = await fb.authApi.signInAnonymously(fb.auth);
  uid = cred.user.uid;
  return uid;
}
function ref() { return fb.fs.doc(fb.db, 'families', code); }

// ---- 送信 ----
function scheduleLocalPush() {
  if (status !== 'on' && status !== 'connecting') return;  // 共有オフなら何もしない
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushNow().catch(() => { /* 次の保存で再送 */ }); }, 600);
}
async function pushNow() {
  if (!code || !fb || !uid) return;
  const now = Date.now();
  lastPushed = now;
  await fb.fs.setDoc(ref(), { data: JSON.stringify(store.syncPayload()), updatedAt: now, writer: uid });
}

// ---- 受信（購読） ----
async function subscribe() {
  if (unsub) { unsub(); unsub = null; }
  const r = ref();
  const snap = await fb.fs.getDoc(r);
  if (!snap.exists()) { await pushNow(); }         // まだ無ければ今のローカルデータで作成
  unsub = fb.fs.onSnapshot(r, (docSnap) => {
    if (!docSnap.exists()) return;
    const d = docSnap.data(); if (!d) return;
    if (d.writer === uid && d.updatedAt && d.updatedAt <= lastPushed) return;  // 自分のエコーは無視
    let remote;
    try { remote = typeof d.data === 'string' ? JSON.parse(d.data) : d.data; } catch (e) { return; }
    if (store.applySync(remote) && onRemote) onRemote();
  }, () => setStatus('error'));
}

// ---- 公開API ----
// 新しく共有を始める（家族コードを発行）。
export async function createShare() {
  await ensureAuth();
  code = genCode();
  localStorage.setItem(CODE_KEY, code);
  setStatus('connecting');
  await subscribe();
  setStatus('on');
  return code;
}
// 既存のコードで参加する（相手のデータで自分を置き換える）。
export async function joinShare(input) {
  const c = normalizeCode(input);
  if (!c) throw new Error('bad-code');
  await ensureAuth();
  code = c;
  setStatus('connecting');
  const snap = await fb.fs.getDoc(ref());
  if (snap.exists() && snap.data() && snap.data().data) {
    try { store.applySync(JSON.parse(snap.data().data)); if (onRemote) onRemote(); } catch (e) { /* 壊れていたら無視 */ }
  }
  localStorage.setItem(CODE_KEY, code);
  await subscribe();
  setStatus('on');
  return code;
}
// 前回のコードで再接続（起動時）。
async function start() {
  setStatus('connecting');
  await ensureAuth();
  await subscribe();
  setStatus('on');
}
// 共有を解除（この端末だけ切り離す。データは各端末に残る）。
export function stopShare() {
  if (unsub) { unsub(); unsub = null; }
  clearTimeout(pushTimer);
  code = null; lastPushed = 0;
  localStorage.removeItem(CODE_KEY);
  setStatus('off');
}

// ---- コード生成・整形（紛らわしい文字 I/O/0/1 は除外）----
function genCode() {
  const AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint8Array(6); crypto.getRandomValues(a);
  return Array.from(a, x => AL[x % AL.length]).join('');
}
function normalizeCode(s) { return ((s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)) || null; }
