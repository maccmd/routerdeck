/* SPDX-License-Identifier: Apache-2.0 */
(function () {
 'use strict';
 var theme = 'dark';
 try { if (localStorage.getItem('routerdeck.theme') === 'light') theme = 'light'; } catch (_) {}
 document.documentElement.dataset.theme = theme;
 document.documentElement.dataset.darkmode = String(theme === 'dark');
 if (window.parent !== window && new URLSearchParams(location.search).get('rdwindow') === '1')
  document.documentElement.classList.add('rd-window-frame');
 // Restore layout before the first paint to avoid a sidebar jump on navigation.
 try {
  var width = JSON.parse(localStorage.getItem('routerdeck.navigation.width'));
  if (typeof width === 'number' && Number.isFinite(width) && width >= 180 && width <= 420)
   document.documentElement.style.setProperty('--rd-nav-width', width + 'px');
 } catch (_) {}
})();
