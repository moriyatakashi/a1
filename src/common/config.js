// [a2] 本番baに接続(Takashi指示、2026-08-30 / すまの0b53e70「本番非接続の枠」を意図的に解除)。
// ba UIの読み書きは本番の共有台帳に直結する。サンドボックスでの操作もそのまま本番反映される点に注意。
// 再び切り離す時は AA_API_BASE を "https://a2-sandbox.invalid/api" に戻す。
window.AA_API_BASE = "https://ab-board-api.azurewebsites.net/api";
window.AA_GOOGLE_CLIENT_ID = "550466095352-50h92anfullp137l4gq4gdi7ogjk0auc.apps.googleusercontent.com";

// favicon の動的挿入: 各ページが相対パスを気にせず a2/favicon.ico を使えるよう、
// この config.js 自身の URL(常に <base>/a2/src/common/config.js)から解決する。
(function(){
  try {
    const self = document.currentScript;
    const href = self && self.src
      ? new URL('../../favicon.ico', self.src).href
      : '/a2/favicon.ico';

    if (!document.querySelector('link[rel~="icon"]') && document.head) {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = href;
      document.head.appendChild(link);

      const apple = document.createElement('link');
      apple.rel = 'apple-touch-icon';
      apple.href = href;
      document.head.appendChild(apple);
    }
  } catch (e) {
    console.error('favicon injection failed', e);
  }
})();
