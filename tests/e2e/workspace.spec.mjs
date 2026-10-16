import { test, expect } from '@playwright/test';

test('workspace focus, geometry, minimize, restore and unsaved close guard', async ({page}, info) => {
 const errors=[]; page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/#workspace');
 const open=async title=> { await page.getByLabel('Page to open').selectOption({label:title}); await page.getByRole('button',{name:'Open window',exact:true}).click(); };
 await open('Interfaces'); await open('System settings');
 const system=page.locator('.rd-window').filter({has:page.locator('iframe[title="System settings"]')});
 await expect(system.frameLocator('iframe').getByLabel('Hostname',{exact:true})).toBeVisible();
 await page.screenshot({ animations:'disabled',path:`output/playwright/screenshots/workspace-${info.project.name}.png`,fullPage:true});
 if (!info.project.name.endsWith('390')) {
  const title=system.locator('.rd-window-title');
  const before=await system.boundingBox(); await title.focus(); await title.press('ArrowRight');
  expect((await system.boundingBox()).x).toBeGreaterThan(before.x);
  await title.press('Shift+ArrowRight'); expect((await system.boundingBox()).width).toBeGreaterThan(before.width);
  await system.getByRole('button',{name:'Maximize System settings',exact:true}).click();
  expect((await system.boundingBox()).width).toBeGreaterThan(before.width);
  await system.getByRole('button',{name:'Maximize System settings',exact:true}).click();
 }
 await system.getByRole('button',{name:'Minimize System settings',exact:true}).click(); await expect(system).toBeHidden();
 await page.locator('.rd-taskbar').getByRole('button',{name:'System settings',exact:true}).click(); await expect(system).toBeVisible();
 await page.reload(); await expect(page.locator('.rd-window')).toHaveCount(2);
 await page.locator('.rd-taskbar').getByRole('button',{name:'System settings',exact:true}).click();
 await system.frameLocator('iframe').getByLabel('Hostname',{exact:true}).fill('unsaved-preview');
 page.once('dialog',dialog=>dialog.dismiss());
 await system.getByRole('button',{name:'Close System settings',exact:true}).click(); await expect(system).toBeVisible();
 page.once('dialog',dialog=>dialog.accept()); await page.getByRole('button',{name:'Close all windows',exact:true}).click();
 await expect(page.locator('.rd-window')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});
