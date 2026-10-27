import { chromium } from '../../web/node_modules/@playwright/test/index.mjs';
import { installHtmlPagination } from '../../web/src/canvas/view/html-pagination.js';
import assert from 'node:assert/strict';
import { installHtmlStreaming } from '../../web/src/canvas/view/html-stream.js';
const browser = await chromium.launch({ headless: true });
try {
 const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const script=`<script>(${installHtmlPagination.toString()})();</script>`;
 async function run(html) {
  await page.setContent('<script>window.reports=[];addEventListener("message",e=>{if(e.data.type==="pagination")reports.push(e.data)})</script><iframe sandbox="allow-scripts" style="border:0;width:880px;height:640px"></iframe>');
  await page.locator('iframe').evaluate((el,html)=>{el.srcdoc=html},html+script);
  await page.waitForFunction(()=>window.reports.length>0);
  const report=await page.evaluate(()=>window.reports.at(-1));
  const frame=page.frames().find(f=>f.parentFrame());
  return {report,frame};
 }
 let {report,frame}=await run('<style>body{margin:8px}#report>p{font-size:24px;line-height:2;margin:0}</style><main id="report"><p>'+('Readable paragraph with <b>formatting</b> and &amp; entities. '.repeat(350))+'</p></main>');
 console.log('prose',JSON.stringify(report));
 assert.ok(!report.fallback);assert.ok(report.pages.length>1);
 assert.equal(await frame.locator('#report>p').evaluate(el=>getComputedStyle(el).fontSize),'24px');
 assert.equal(await frame.locator('#report>p').count(),1);
 assert.ok(report.pages.every(p=>p.height<=660),'Prose pages should be bounded');
 await page.locator('iframe').evaluate((el,height)=>el.style.height=`${height}px`,report.height);
 const before=await page.evaluate(()=>reports.length);
 await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>reports.length),before,'Idle and height changes must not reflow');
 ({report,frame}=await run('<style>body{margin:8px}td{height:40px}table{border-collapse:collapse}</style><table><thead><tr><th>Item</th></tr></thead><tbody>'+Array.from({length:35},(_,i)=>`<tr><td>Row ${i+1}</td></tr>`).join('')+'</tbody></table>'));
 console.log('table',JSON.stringify(report));assert.ok(!report.fallback);assert.ok(report.pages.length>1);assert.equal(await frame.locator('tr').count(),36);assert.ok(report.pages.every(p=>p.height<=660));
 ({report,frame}=await run('<style>body{margin:0}.hero{height:100vh}</style><div class="hero">Hero</div><p>Following section</p>'));
 console.log('vh',JSON.stringify(report));assert.ok(!report.fallback);
 assert.equal(await frame.locator('.hero').evaluate(el=>el.getBoundingClientRect().height),640);
 await page.locator('iframe').evaluate((el,height)=>el.style.height=`${height}px`,report.height);
 assert.equal(await frame.locator('.hero').evaluate(el=>el.getBoundingClientRect().height),640);
 ({report,frame}=await run('<p>Short answer</p>'));
 assert.ok(report.height<640);assert.equal(report.pages.length,1);
 ({report,frame}=await run('<div style="display:grid;grid-template-columns:1fr 1fr"><p>left</p><p>right</p></div><canvas width="700" height="220"></canvas><script>window.init=(window.init||0)+1;document.querySelector("canvas").onclick=()=>window.clicks=(window.clicks||0)+1</script>'));
 assert.ok(!report.fallback);assert.equal(await frame.evaluate(()=>window.init),1);await frame.locator('canvas').click();assert.equal(await frame.evaluate(()=>window.clicks),1);
 await page.setViewportSize({width:1000,height:1600});assert.equal(await frame.evaluate(()=>window.init),1);
 ({report}=await run('<div style="position:fixed;top:0">Fixed layout</div>'));
 assert.ok(report.fallback);assert.equal(report.height,640);
 // A script that sizes itself from innerHeight must settle in the bounded fallback.
 await page.setContent('<script>window.reports=[];addEventListener("message",e=>{if(e.data.type==="pagination"){reports.push(e.data);document.querySelector("iframe").style.height=e.data.height+"px"}})</script><iframe sandbox="allow-scripts" style="width:880px;height:640px"></iframe>');
 await page.locator('iframe').evaluate((el, html) => el.srcdoc = html, '<div id="responsive"></div><script>function fit(){document.querySelector("#responsive").style.height=(innerHeight+20)+"px"}fit();addEventListener("resize",fit)</script>' + script);
 await page.waitForFunction(()=>window.reports.at(-1)?.fallback, undefined, {timeout:5000}).catch(async error => { console.log('responsive reports', JSON.stringify(await page.evaluate(()=>reports))); throw error; });
 assert.equal(await page.evaluate(()=>reports.at(-1).height),640);
 const settledReports = await page.evaluate(()=>reports.length);
 await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>reports.length),settledReports);
 // Streaming updates one live document, excludes executable partial markup, and pauses
 // reconciliation while a real selected passage is being read.
 await page.setContent('<iframe sandbox="allow-scripts" style="width:880px;height:640px"></iframe>');
 await page.locator('iframe').evaluate((el, html) => { el.srcdoc = html; }, '<body></body>' + script + `<script>(${installHtmlStreaming.toString()})();</script>`);
 const streaming = page.frames().find(f => f.parentFrame());
 await streaming.waitForLoadState();
 const publish = html => page.locator('iframe').evaluate((el, html) => el.contentWindow.postMessage({__nlHtmlCommand:'stream',html}, '*'), html);
 await publish('<style>p{font-size:24px}</style><p id="first">Completed passage</p><p>unfinished');
 await streaming.waitForSelector('#first');
 assert.equal(await streaming.locator('p').count(),1);
 const first = await streaming.locator('#first').elementHandle();
 await publish('<style>p{font-size:24px}</style><p id="first">Completed passage</p><p id="second" onclick="window.bad=true">Next passage</p><script>window.bad=true</script>');
 await streaming.waitForSelector('#second');
 assert.equal(await first.evaluate(el=>el===document.querySelector('#first')),true);
 assert.equal(await streaming.evaluate(()=>window.bad),undefined);
 assert.equal(await streaming.locator('#second').getAttribute('onclick'),null);
 await streaming.locator('#first').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r)});
 await publish('<p id="first">Completed passage</p><p id="second">Next passage</p><p id="third">Third passage</p>');
 await page.waitForTimeout(80);
 assert.equal(await streaming.locator('#third').count(),0);
 await streaming.evaluate(()=>getSelection().removeAllRanges());
 await streaming.waitForSelector('#third');
 assert.deepEqual(errors,[]);
 console.log('PASS production pagination: ancestor CSS, long prose, tables, viewport units, short pages, grid/chart identity, bounded fallback.');
}finally{await browser.close()}
