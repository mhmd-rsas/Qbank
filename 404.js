// Point the home link at the right folder even if the repository is renamed (GitHub Pages serves a project at /<repo>/).
(function () {
  var seg = location.pathname.split('/')[1] || '';
  var base = /github\.io$/.test(location.hostname) && seg ? '/' + seg + '/' : '/';
  document.getElementById('home').setAttribute('href', base);
})();
