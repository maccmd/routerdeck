import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const password=(await readFile('.cache/vm/password','utf8')).trim();
const ssh=command=>execFileSync('sh',['scripts/vm-ssh.sh',command],{encoding:'utf8'}).trim();

test('native LuCI windows preserve sessions and guard edited forms',async({page},info)=>{
 const errors=[]; let closing=false; let phase='post-login';
 await page.goto('/cgi-bin/luci/admin/status/routesj');
 await page.getByLabel('Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Log in',exact:true}).click();
 await expect(page.locator('#rd-navigation')).not.toContainText('Workspace');
 await expect(page.locator('.ifacebadge a').first()).toBeVisible();
 page.on('pageerror',error=> {
  // Removing an iframe cancels its native polling XHR. WebKit can report that
  // expected teardown rejection before destroying the document.
  if (closing && /^(Error: )?XHR request aborted by browser$/.test(error.message)) return;
  errors.push({phase,message:error.message});
 });
 const open=async href=> {
  phase='open '+href;
  if (await page.getByRole('button',{name:'Toggle navigation'}).isVisible()) {
   await page.getByRole('button',{name:'Toggle navigation'}).click();
  }
  await page.locator('.rd-nav-item').filter({has:page.locator('a[href="'+href+'"]')}).locator('.rd-nav-window').click();
 };
 await open('/cgi-bin/luci/admin/network/network');
 const network=page.locator('.rd-window').filter({has:page.locator('iframe[title="Interfaces"]')});
 await expect(network.frameLocator('iframe').getByRole('button',{name:/Add new interface/})).toBeVisible({timeout:20000});
 await open('/cgi-bin/luci/admin/system/system');
 const system=page.locator('.rd-window').filter({has:page.locator('iframe[title="System"]')});
 const form=system.frameLocator('iframe');
 await expect(form.getByLabel('Hostname',{exact:true})).toBeVisible({timeout:20000});
 if (!info.project.name.endsWith('390')) {
  await expect(network).toHaveAttribute('data-layout','left');
  await expect(system).toHaveAttribute('data-layout','right');
  const a=await network.boundingBox(),b=await system.boundingBox(),sidebar=await page.locator('.rd-sidebar').boundingBox();
  expect(a.x).toBeGreaterThanOrEqual(sidebar.x+sidebar.width);
  expect(a.x+a.width).toBeLessThan(b.x);
 }
 await page.screenshot({ animations:'disabled',path:`output/playwright/screenshots/workspace-luci-${process.env.ROUTERDECK_VM_PORT||8088}-${info.project.name}.png`,fullPage:true});
 phase='edit and close guard'; await form.getByLabel('Hostname',{exact:true}).fill('unsaved-window');
 if (!info.project.name.endsWith('390')) {
  await page.getByRole('separator',{name:'Resize side-by-side windows'}).press('ArrowLeft');
  await expect(form.getByLabel('Hostname',{exact:true})).toHaveValue('unsaved-window');
 }
 page.once('dialog',dialog=>dialog.dismiss());
 await system.getByRole('button',{name:/^Close /}).click(); await expect(system).toBeVisible();
 // A different native form must not combine staged changes with this edit.
 phase='switch and save guard'; await page.locator('.rd-taskbar').getByRole('button',{name:'Interfaces',exact:true}).click();
 let blockedMessage=''; page.once('dialog',async dialog=> { blockedMessage=dialog.message(); await dialog.accept(); });
 // A failed UI guard must not send a save during this regression test.
 await network.frameLocator('iframe').locator('.cbi-page-actions .cbi-button-save').evaluate(button => button.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); }, {capture:true}));
 await network.frameLocator('iframe').locator('.cbi-page-actions .cbi-button-save').click();
 expect(blockedMessage).toContain('Another window has unsaved changes');
 expect(ssh("uci get system.@system[0].hostname")).not.toBe('unsaved-window');
 phase='close all'; closing=true; page.once('dialog',dialog=>dialog.accept()); await page.getByRole('button',{name:'Close all windows',exact:true}).click();
 await expect(page.locator('.rd-window')).toHaveCount(0);
 // Exercise the theme's event handling without applying any router changes.
 closing=false;
 await open('/cgi-bin/luci/admin/network/network');
 await open('/cgi-bin/luci/admin/system/system');
 await expect(form.getByLabel('Hostname',{exact:true})).toBeVisible();
 await form.locator('body').evaluate(() => document.dispatchEvent(new CustomEvent('uci-applied')));
 await expect(network.locator('.rd-window-status')).toContainText('Reload before saving');
 await expect(page.locator('#rd-background-stale')).toBeVisible();
 closing=true;
 await page.getByRole('button',{name:'Close all windows',exact:true}).click();
 expect(errors).toEqual([]);
});
