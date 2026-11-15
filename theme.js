// Applies the saved theme before the page paints (kept in its own file so the page needs no inline script).
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('qbank.v2.settings') || '{}');
    if (s.theme === 'dark' || s.theme === 'light') document.documentElement.setAttribute('data-theme', s.theme);
  } catch (e) {}
})();
