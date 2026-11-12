import { test,expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const defaults=JSON.parse(readFileSync('../backend/cloud/features.json','utf8'));
test('Notes flag hides sidebar and Projects entry points without removing data',async({page})=>{
 await page.route('**/api/features',route=>route.fulfill({json:{version:1,flags:{...defaults,notesV2:false,chatNotes:false},overrides:{notesV2:false},admin:false}}));
 await page.goto('/web/');
 await page.getByRole('button',{name:'Open left pane'}).click();
 const sidebar=page.getByRole('complementary',{name:'Left pane'});
 await expect(sidebar.getByText('Notes',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'New project',exact:true}).click();
 const panel=page.getByTestId('project-overview');
 await expect(panel).toBeVisible();
 await expect(panel.getByText('Notes',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Add to project',exact:true}).click();
 await expect(page.getByRole('menuitem',{name:'New note',exact:true})).toHaveCount(0);
 await expect(page.getByRole('menuitem',{name:'Add existing note',exact:true})).toHaveCount(0);
});
test('settings sections have independent flags and no administrator controls for normal users',async({page})=>{
 await page.route('**/api/features',route=>route.fulfill({json:{version:1,flags:{...defaults,skills:false,integrations:false,modes:false,logs:false},overrides:{},admin:false}}));
 await page.goto('/web/');await page.getByRole('button',{name:'Open left pane'}).click();
 await page.getByRole('button',{name:'Open settings'}).click();
 for(const name of ['Skills','Integrations','Modes','Runtime logs','Feature flags'])await expect(page.getByRole('tab',{name:new RegExp('^'+name)})).toHaveCount(0);
 await expect(page.getByRole('tab',{name:/^General/})).toBeVisible();
 await expect(page.getByRole('tab',{name:/^Models & keys/})).toBeVisible();
});
test('a refreshed flag removes Notes and re-enabling restores its entry point',async({page})=>{
 let notes=true;
 await page.route('**/api/features',route=>route.fulfill({json:{version:notes?1:2,flags:{...defaults,notesV2:notes,chatNotes:notes},overrides:{},admin:false}}));
 await page.goto('/web/');await page.getByRole('button',{name:'Open left pane'}).click();
 const sidebar=page.getByRole('complementary',{name:'Left pane'});
 await expect(sidebar.getByText('Notes',{exact:true})).toBeVisible();
 notes=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(sidebar.getByText('Notes',{exact:true})).toHaveCount(0);
 notes=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(sidebar.getByText('Notes',{exact:true})).toBeVisible();
});
