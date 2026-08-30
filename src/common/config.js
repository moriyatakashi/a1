// [a2] 本番baに接続(Takashi指示、2026-08-30 / すまの0b53e70「本番非接続の枠」を意図的に解除)。
// ba UIの読み書きは本番の共有台帳に直結する。サンドボックスでの操作もそのまま本番反映される点に注意。
// 再び切り離す時は AA_API_BASE を "https://a2-sandbox.invalid/api" に戻す。
window.AA_API_BASE = "https://ab-board-api.azurewebsites.net/api";
window.AA_GOOGLE_CLIENT_ID = "550466095352-50h92anfullp137l4gq4gdi7ogjk0auc.apps.googleusercontent.com";

(function(){
  try {

    const svg = `<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">\n  <style>\n    .bg{fill:#0a6c96}\n    .fg{fill:#f7f6f0}\n    @media (prefers-color-scheme: dark){\n      .bg{fill:#66ccff}\n      .fg{fill:#14170f}\n    }\n  </style>\n  <rect x="1" y="1" width="14" height="14" rx="4" class="bg"/>\n  <text x="8" y="12" text-anchor="middle" font-size="11" font-weight="900" font-family="system-ui, sans-serif" class="fg">a</text>\n</svg>`;

    const href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

    if (!document.querySelector('link[rel~="icon"]') && document.head) {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/svg+xml';
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
