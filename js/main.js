// 起動。UI初期化とService Worker登録（オフライン対応）。
import { init } from './ui.js';

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 非対応環境は無視 */ });
  });
}
