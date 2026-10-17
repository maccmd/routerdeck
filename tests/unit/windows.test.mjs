import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../../luci-theme-routerdeck/htdocs/luci-static/routerdeck/windows.js', import.meta.url), 'utf8');
const base = 'https://router.example/cgi-bin/luci/admin/status/routesj';
const context = vm.createContext({ RouterDeck: {}, URL, location: { href: base } });
vm.runInContext(source, context);
const destination = context.RouterDeck.windowDestination;
const pages = [{ href: '/cgi-bin/luci/admin/network/network', title: 'Interfaces' }];

test('windows accept only permitted local pages, not actions, external URLs or arbitrary queries', () => {
 for (const href of ['https://evil.example/cgi-bin/luci/admin/network/network', '//root:password@router.example/cgi-bin/luci/admin/network/network', '/cgi-bin/luci/admin/logout', '/cgi-bin/luci/admin/uci/apply', pages[0].href + '?token=secret', pages[0].href + '?rd=interface:wan&rd=device:eth0', pages[0].href + '?rd=command:reboot', pages[0].href + '?rd=interface:%00', pages[0].href + '#tab']) {
  assert.equal(destination(href, pages, base), null, href);
 }
 assert.equal(destination(pages[0].href, [], base), null);
});
test('window identity preserves entity targets, removes frame marker and supports legacy deep links', () => {
 const target = destination(pages[0].href + '?rd=interface%3Awan&rdwindow=1', pages, base);
 assert.equal(target.href, pages[0].href + '?rd=interface%3Awan');
 assert.equal(target.title, 'wan · Interfaces');
 assert.equal(destination(pages[0].href + '#rd:interface:wan', pages, base).href, target.href);
 assert.notEqual(destination(pages[0].href + '?rd=interface:lan', pages, base).href, target.href);
});
test('preview hash routes do not turn unknown hash links into windows', () => {
 const preview = [{ href: '/#interfaces', title: 'Interfaces' }];
 assert.equal(destination('/?rdwindow=1#interfaces', preview, 'http://localhost:5173/', true).href, '/#interfaces');
 assert.equal(destination('/#missing', preview, 'http://localhost:5173/', true), null);
});
