import { test,expect,type Page } from '@playwright/test';
import { readFileSync,mkdirSync } from 'node:fs';
const defaults=JSON.parse(readFileSync('../backend/cloud/features.json','utf8'));
async function cloudFixture(page:Page,admin=false){
 const resources=new Map<string,Record<string,unknown>>();const keys=new Set<string>();
 await page.route('https://auth.notlinear.test/**',route=>route.fulfill({json:route.request().url().endsWith('/user')?{id:'web-test-user',email:'test@example.test'}:{access_token:'test-token',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'web-test-user',email:'test@example.test'}}}));
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname.slice(4),method=request.method();
  if(path==='/runtime')return route.fulfill({json:{mode:'cloud',supabaseUrl:'https://auth.notlinear.test',supabaseAnonKey:'public-test-key',subscriptions:{claude:false,chatgpt:false}}});
  if(path==='/features')return route.fulfill({json:{version:1,flags:defaults,overrides:{},admin}});
  if(path==='/credentials')return route.fulfill({json:[...keys].map(provider=>({provider}))});
  if(path.startsWith('/credentials/')){const provider=path.split('/').pop()!;keys.add(provider);return route.fulfill({json:{connected:true}});}
  if(path.startsWith('/resources/')){
   const namespace=path.split('/').pop()!;
   if(method==='GET')return route.fulfill({json:[...resources.entries()].filter(([key])=>key.startsWith(namespace+'|')).map(([,value])=>value)});
   const body=request.postDataJSON();const key=namespace+'|'+body.key;
   const row={resource_key:body.key,revision:Number(resources.get(key)?.revision??0)+1,value:body.value,deleted:body.deleted??false};resources.set(key,row);return route.fulfill({json:row});
  }
  if(path==='/providers/anthropic'){
   const events=[{type:'message_start',message:{id:'test',role:'assistant',model:'test',content:[],usage:{input_tokens:1,output_tokens:0}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
    {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'A useful cloud answer to branch from.'}},
    {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:8}},{type:'message_stop'}];
   return route.fulfill({headers:{'Content-Type':'text/event-stream'},body:events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')});
  }
  if(path==='/runtime-logs')return route.fulfill({json:{ok:true}});
  if(path==='/events')return route.fulfill({json:{ok:true}});
  return route.fulfill({status:404,json:{detail:'Not configured in this fixture'}});
 });
 return {resources,keys};
}
async function signup(page:Page){
 await page.goto('/web/');await page.getByRole('button',{name:'Create your workspace',exact:true}).click();
 await page.getByLabel('Email',{exact:true}).fill('test@example.test');await page.getByLabel('Password',{exact:true}).fill('test-password-only');
 await page.getByRole('button',{name:'Create account',exact:true}).click();
 await expect(page.getByRole('button',{name:'Account & settings',exact:true})).toBeVisible();
}
test('cloud signup opens an account-scoped workspace and stores credential references only',async({page})=>{
 const fixture=await cloudFixture(page);
 await page.addInitScript(()=>localStorage.setItem('notlinear-account:web-test-user:nl_clarify_first','0'));
 await signup(page);
 mkdirSync('../dist/web-beta-review',{recursive:true});await page.screenshot({path:'../dist/web-beta-review/workspace-onboarding.png'});
 await expect(page.getByRole('complementary',{name:'Getting started'})).toBeVisible();
 await page.getByRole('button',{name:'Connect AI',exact:true}).click();
 await page.getByRole('button',{name:'Anthropic settings',exact:true}).click();
 const card=page.locator('[data-provider="anthropic"]');await card.getByLabel('Anthropic API key').fill('test-secret-not-for-storage');await card.getByRole('button',{name:'Connect',exact:true}).click();
 await expect(card.getByText('Connected',{exact:true})).toBeVisible();
 expect(fixture.keys.has('anthropic')).toBe(true);
 const local=await page.evaluate(()=>JSON.stringify(localStorage));expect(local).not.toContain('test-secret-not-for-storage');
 await page.getByRole('button',{name:'Close settings'}).click();
 await page.getByRole('complementary',{name:'Getting started'}).getByRole('button',{name:'Continue',exact:true}).click();
 const composer=page.getByRole('textbox',{name:'Message',exact:true});await composer.fill('Help me research this idea');await composer.press('Enter');
 await expect(page.locator('.msg.ai')).toContainText('A useful cloud answer to branch from.');
 await expect.poll(()=>JSON.stringify([...fixture.resources.values()])).toContain('A useful cloud answer to branch from.');
 await expect.poll(()=>[...fixture.resources.keys()].filter(key=>key.startsWith('chat|')).length).toBeGreaterThan(0);
 await page.reload();await expect(page.getByRole('button',{name:'Account & settings',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
});
test('admin feature configuration is visible only for server-authorized accounts',async({page})=>{
 await cloudFixture(page,true);await signup(page);
 await page.getByRole('button',{name:'Feature flags',exact:true}).click();
 await expect(page.getByRole('tab',{name:/^Feature flags/})).toBeVisible();
 await expect(page.getByRole('checkbox',{name:/^Notes/})).toBeVisible();
 mkdirSync('../dist/web-beta-review',{recursive:true});await page.screenshot({path:'../dist/web-beta-review/admin-feature-flags.png'});
});
