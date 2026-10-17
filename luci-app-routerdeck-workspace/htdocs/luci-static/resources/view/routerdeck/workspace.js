'use strict';
'require view';

// Old bookmarks continue working; windows now belong to the theme on every page.
return view.extend({
 render: function () {
  window.location.replace(L.url('admin/status/overview'));
  return E('p', {}, _('Opening overview…'));
 },
 handleSaveApply: null, handleSave: null, handleReset: null
});
