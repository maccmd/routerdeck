/* SPDX-License-Identifier: Apache-2.0 */
(function () {
 'use strict';
 var theme = 'dark';
 try { if (localStorage.getItem('routerdeck.theme') === 'light') theme = 'light'; } catch (_) {}
 document.documentElement.dataset.theme = theme;
 document.documentElement.dataset.darkmode = String(theme === 'dark');
})();
