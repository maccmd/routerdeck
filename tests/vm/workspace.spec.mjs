import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const password=(await readFile('.cache/vm/password','utf8')).trim();
const ssh=command=>execFileSync('sh',['scripts/vm-ssh.sh',command],{encoding:'utf8'}).trim();

test('native LuCI windows preserve sessions and guard edited forms',async({page},info)=>{
 const errors=[]; let closing=false; let phase='post-login';
 await page.goto('/cgi-bin/luci/admin/status/workspace');
 await page.getByLabel('Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Log in',exact:true}).click();
 await expect(page.getByLabel('Page to open')).toBeVisible();
 page.on('pageerror',error=> {
  // Removing an iframe cancels its native polling XHR. WebKit can report that
  // expected teardown rejection before destroying the document.
  if (closing && /^(Error: )?XHR request aborted by browser$/.test(error.message)) return;
  errors.push({phase,message:error.message});
 });
 const open=async href=> { phase='open '+href; await page.getByLabel('Page to open').selectOption(href); await page.getByRole('button',{name:'Open window',exact:true}).click(); };
 await open('/cgi-bin/luci/admin/network/network');
 const network=page.locator('.rd-window').filter({has:page.locator('iframe[src="/cgi-bin/luci/admin/network/network"]')});
 await expect(network.frameLocator('iframe').getByRole('button',{name:/Add new interface/})).toBeVisible({timeout:20000});
 await open('/cgi-bin/luci/admin/system/system');
 const system=page.locator('.rd-window').filter({has:page.locator('iframe[src="/cgi-bin/luci/admin/system/system"]')});
 const form=system.frameLocator('iframe');
 await expect(form.getByLabel('Hostname',{exact:true})).toBeVisible({timeout:20000});
 await page.screenshot({ animations:'disabled',path:`output/playwright/screenshots/workspace-luci-${process.env.ROUTERDECK_VM_PORT||8088}-${info.project.name}.png`,fullPage:true});
 phase='edit and close guard'; await form.getByLabel('Hostname',{exact:true}).fill('unsaved-window');
 page.once('dialog',dialog=>dialog.dismiss());
 await system.getByRole('button',{name:/^Close /}).click(); await expect(system).toBeVisible();
 // A different native form must not combine staged changes with this edit.
 phase='switch and save guard'; await page.locator('.rd-taskbar').getByRole('button',{name:'Network / Interfaces',exact:true}).click();
 let blockedMessage=''; page.once('dialog',async dialog=> { blockedMessage=dialog.message(); await dialog.accept(); });
 await network.frameLocator('iframe').locator('.cbi-page-actions .cbi-button-save').click();
 expect(blockedMessage).toContain('Another window has edited fields');
 expect(ssh("uci get system.@system[0].hostname")).not.toBe('unsaved-window');
 phase='close all'; closing=true; page.once('dialog',dialog=>dialog.accept()); await page.getByRole('button',{name:'Close all windows',exact:true}).click();
 await expect(page.locator('.rd-window')).toHaveCount(0);
 if (info.project.name === 'chromium-1440') {
  closing=false;
  const original=ssh("uci get system.@system[0].hostname");
  try {
   await open('/cgi-bin/luci/admin/network/network');
   await open('/cgi-bin/luci/admin/system/system');
   await form.getByLabel('Hostname',{exact:true}).fill('routerdeck-window-test');
   await form.locator('.cbi-page-actions .cbi-button-apply').getByText('Save & Apply',{exact:true}).click();
   await expect.poll(()=>ssh("uci get system.@system[0].hostname"),{timeout:30000}).toBe('routerdeck-window-test');
   await expect(network.locator('.rd-window-status')).toContainText('Reload before editing',{timeout:30000});
   phase='close all'; closing=true; await page.getByRole('button',{name:'Close all windows',exact:true}).click();
  } finally {
   ssh("uci set system.@system[0].hostname='"+original.replaceAll("'","'\\''")+"'; uci commit system; /etc/init.d/system reload");
  }
 }
 expect(errors).toEqual([]);
});
