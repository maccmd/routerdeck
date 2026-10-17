import { test, expect } from '@playwright/test';

test('menu windows retain edits and snapped layouts across movement and reload', async ({page}, info) => {
 const errors=[]; page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/#dashboard');
 await expect(page.locator('#rd-navigation')).not.toContainText('Workspace');
 const open=async title=> {
  if (await page.getByRole('button',{name:'Toggle navigation'}).isVisible()) await page.getByRole('button',{name:'Toggle navigation'}).click();
  await page.locator('.rd-nav-item').filter({has:page.getByRole('link',{name:title,exact:true})}).locator('.rd-nav-window').click();
 };
 await open('Interfaces'); await open('System settings');
 const system=page.locator('.rd-window').filter({has:page.locator('iframe[title="System settings"]')});
 let split;
 await expect(system.frameLocator('iframe').getByLabel('Hostname',{exact:true})).toBeVisible();
 await page.screenshot({ animations:'disabled',path:`output/playwright/screenshots/workspace-${info.project.name}.png`,fullPage:true});
 if (!info.project.name.endsWith('390')) {
  const network=page.getByRole('dialog',{name:'Interfaces',exact:true});
  const form=system.frameLocator('iframe');
  await expect(network).toHaveAttribute('data-layout','left');
  await expect(system).toHaveAttribute('data-layout','right');
  await form.getByLabel('Hostname',{exact:true}).fill('auto-arrangement-preview');
  await page.evaluate(()=>window.__arrangementDocument=document.querySelector('iframe[title="System settings"]').contentDocument);
  await open('Firewall');
  const firewall=page.getByRole('dialog',{name:'Firewall',exact:true});
  const boxes=await page.locator('.rd-window').evaluateAll(ws=>ws.map(w=>w.getBoundingClientRect().toJSON()));
  for (let i=0;i<boxes.length;i++) for (const b of boxes.slice(i+1)) {
   const a=boxes[i]; expect(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top).toBe(true);
  }
  await firewall.getByRole('button',{name:'Close Firewall',exact:true}).click();
  await expect(system).toHaveAttribute('data-layout','right');
  await network.getByRole('button',{name:'Minimize Interfaces',exact:true}).click();
  await open('Firewall');
  await expect(network).toBeHidden();
  await expect(system).toHaveAttribute('data-layout','left');
  await expect(firewall).toHaveAttribute('data-layout','right');
  await firewall.getByRole('button',{name:'Close Firewall',exact:true}).click();
  await page.locator('.rd-taskbar').getByRole('button',{name:'Interfaces',exact:true}).click();
  const divider=page.getByRole('separator',{name:'Resize side-by-side windows'});
  await divider.press('ArrowLeft'); const customized=await divider.getAttribute('aria-valuetext');
  await open('System settings');
  await expect(page.locator('.rd-window')).toHaveCount(2);
  await expect(divider).toHaveAttribute('aria-valuetext',customized);
  await expect(form.getByLabel('Hostname',{exact:true})).toHaveValue('auto-arrangement-preview');
  expect(await page.evaluate(()=>window.__arrangementDocument===document.querySelector('iframe[title="System settings"]').contentDocument)).toBe(true);
  await form.getByRole('button',{name:'Save preview',exact:true}).click();
  // Explicit floating placement still allows the existing move/resize controls.
  await system.getByRole('button',{name:'Layout System settings',exact:true}).click();
  await system.getByRole('button',{name:'Floating window',exact:true}).click();
  const title=system.locator('.rd-window-title');
  const before=await system.boundingBox(); await title.focus(); await title.press('ArrowRight');
  expect((await system.boundingBox()).x).toBeGreaterThan(before.x);
  await title.press('Shift+ArrowRight'); expect((await system.boundingBox()).width).toBeGreaterThan(before.width);
  await system.getByRole('button',{name:'Maximize System settings',exact:true}).click();
  expect((await system.boundingBox()).width).toBeGreaterThan(before.width);
  const sidebar=await page.locator('.rd-sidebar').boundingBox();
  expect((await system.boundingBox()).x).toBeGreaterThanOrEqual(sidebar.x+sidebar.width);
  await page.getByRole('separator',{name:'Resize navigation'}).focus();
  await page.getByRole('separator',{name:'Resize navigation'}).press('End');
  await expect.poll(async()=>Math.round((await system.boundingBox()).x)).toBe(420);
  await page.getByRole('searchbox',{name:'Find a page',exact:true}).fill('system');
  await page.getByRole('searchbox',{name:'Find a page',exact:true}).fill('');
  await system.getByRole('button',{name:'Restore System settings',exact:true}).click();
  await form.getByLabel('Hostname',{exact:true}).fill('arrangement-preview');
  await page.evaluate(()=>window.__arrangementDocument=document.querySelector('iframe[title="System settings"]').contentDocument);
  await page.getByRole('button',{name:'Tile windows',exact:true}).click();
  await expect(network).toHaveAttribute('data-layout','left');
  await expect(system).toHaveAttribute('data-layout','right');
  const dividerBox=await divider.boundingBox();
  await page.mouse.move(dividerBox.x+4,dividerBox.y+80); await page.mouse.down();
  await page.mouse.move(dividerBox.x+64,dividerBox.y+80,{steps:5}); await page.mouse.up();
  expect((await network.boundingBox()).width).toBeGreaterThan((await system.boundingBox()).width);
  await divider.press('ArrowLeft');
  split=await divider.getAttribute('aria-valuetext');
  const area=await page.locator('.rd-windows').boundingBox();
  const dragTitle=async(x,y)=> {
   const box=await title.boundingBox();
   await page.mouse.move(box.x+30,box.y+12); await page.mouse.down();
   await page.mouse.move(x,y,{steps:5});
  };
  await dragTitle(area.x+6,area.y+area.height/2);
  await expect(page.locator('.rd-snap-preview')).toHaveText('Left half');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuetext',split);
  await dragTitle(area.x+area.width-6,area.y+6);
  await expect(page.locator('.rd-snap-preview')).toHaveText('Top right');
  await page.mouse.up(); await expect(system).toHaveAttribute('data-layout','top-right');
  await system.getByRole('button',{name:'Maximize System settings',exact:true}).click();
  await system.getByRole('button',{name:'Restore System settings',exact:true}).click();
  await expect(system).toHaveAttribute('data-layout','top-right');
  await system.getByRole('button',{name:'Layout System settings',exact:true}).click();
  await system.getByRole('button',{name:'Right half',exact:true}).click();
  await page.getByRole('button',{name:'Tile windows',exact:true}).click();
  await divider.press('ArrowRight'); split=await divider.getAttribute('aria-valuetext');
  await expect(form.getByLabel('Hostname',{exact:true})).toHaveValue('arrangement-preview');
  expect(await page.evaluate(()=>window.__arrangementDocument===document.querySelector('iframe[title="System settings"]').contentDocument)).toBe(true);
  // Only the simulated preview is saved; the VM suite never applies changes.
  await form.getByRole('button',{name:'Save preview',exact:true}).click();
  await page.setViewportSize({width:1024,height:900});
  await expect.poll(async()=>Math.round((await system.boundingBox()).width)).toBe(604);
  expect((await system.boundingBox()).y).toBeGreaterThan((await network.boundingBox()).y);
  await page.setViewportSize(info.project.use.viewport);
  await expect(divider).toBeVisible();
 } else {
  await expect(page.getByRole('button',{name:'Tile windows',exact:true})).toBeHidden();
 }
 expect(page.url()).toContain('#dashboard');
 await system.getByRole('button',{name:'Minimize System settings',exact:true}).click(); await expect(system).toBeHidden();
 await page.locator('.rd-taskbar').getByRole('button',{name:'System settings',exact:true}).click(); await expect(system).toBeVisible();
 if (split) {
  await page.getByRole('separator',{name:'Resize side-by-side windows'}).press('ArrowRight');
  split=await page.getByRole('separator',{name:'Resize side-by-side windows'}).getAttribute('aria-valuetext');
 }
 await page.reload(); await expect(page.locator('.rd-window')).toHaveCount(2);
 if (split) await expect(page.getByRole('separator',{name:'Resize side-by-side windows'})).toHaveAttribute('aria-valuetext',split);
 await page.locator('.rd-taskbar').getByRole('button',{name:'System settings',exact:true}).click();
 await system.frameLocator('iframe').getByLabel('Hostname',{exact:true}).fill('unsaved-preview');
 page.once('dialog',dialog=>dialog.dismiss());
 await system.getByRole('button',{name:'Close System settings',exact:true}).click(); await expect(system).toBeVisible();
 page.once('dialog',dialog=>dialog.accept()); await page.getByRole('button',{name:'Close all windows',exact:true}).click();
 await expect(page.locator('.rd-window')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});
