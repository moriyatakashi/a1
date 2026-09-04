window.AA_API_BASE = "https://ab-board-api.azurewebsites.net/api";
window.AA_GOOGLE_CLIENT_ID = "550466095352-50h92anfullp137l4gq4gdi7ogjk0auc.apps.googleusercontent.com";
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
