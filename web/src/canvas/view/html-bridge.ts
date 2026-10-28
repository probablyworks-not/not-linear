import { readingScript } from './html-reading.js';
import { streamingScript } from './html-stream.js';
import { paginationScript } from './html-pagination.js';
// The iframe remains an opaque sandbox. Only selection, wheel and mark geometry cross it.
// Its viewport has a fixed size: document layout never determines the iframe's own dimensions.
const BRIDGE_SCRIPT = `<script>(function(){
function post(msg){ try{ parent.postMessage(Object.assign({__nlHtmlPart:true}, msg), '*'); }catch(e){} }
function segments(root){
  var text='', runs=[];
  function newline(){if(text && !text.endsWith('\\n'))text+='\\n';}
  function visit(node){
    if(node.nodeType===1 && node.matches('script,style,button,template,head,[data-nl-page-gap],[data-nl-inspector]'))return;
    if(node.nodeType===3){var start=text.length;text+=node.data;runs.push({node:node,start:start,end:text.length});return;}
    if(node.nodeType===1 && node.tagName==='BR'){newline();return;}
    node.childNodes.forEach(visit);
    if(node.nodeType===1 && /^(P|LI|H[1-6]|BLOCKQUOTE|PRE|TR)$/.test(node.tagName))newline();
  }
  visit(root);return {text:text,runs:runs};
}
function cleanText(fragment){return segments(fragment).text;}
function reportSelection(){
  var sel = window.getSelection();
  var range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  var text = range ? cleanText(range.cloneContents()).trim() : '';
  if (!text) { post({type:'selection', text:''}); return; }
  var before = range.cloneRange();
  before.selectNodeContents(document.body); before.setEnd(range.startContainer, range.startOffset);
  var prefix = cleanText(before.cloneContents()), occurrence = 0, at = 0;
  while ((at = prefix.indexOf(text, at)) >= 0) { occurrence++; at += text.length; }
  var r = range.getBoundingClientRect();
  post({type:'selection', text:text, occurrence:occurrence, rect:{left:r.left, top:r.top, width:r.width, height:r.height}});
}
document.addEventListener('selectionchange', reportSelection);
// Element inspection stays inside the opaque sandbox; the host receives only the selected text.
var inspected = null, previousOutline = '', crumb = null;
function clearInspection(){
  if(inspected)inspected.style.outline=previousOutline;
  inspected=null;
  if(crumb){crumb.remove();crumb=null;}
}
function showCrumbs(el){
  if(crumb)crumb.remove();
  crumb=document.createElement('div'); crumb.dataset.nlInspector='';
  crumb.setAttribute('role','navigation'); crumb.setAttribute('aria-label','Selected element hierarchy');
  crumb.style.cssText='position:fixed;top:8px;left:8px;z-index:2147483647;display:flex;gap:4px;padding:5px;background:var(--nl-paper);color:var(--nl-ink);border:1px solid currentColor;border-radius:6px;font:12px sans-serif';
  candidates(el).reverse().forEach(function(item){
    var button=document.createElement('button'); button.type='button'; button.textContent=item.getAttribute('aria-label') || item.tagName.toLowerCase();
    button.style.cssText='cursor:pointer;font:inherit;color:inherit;background:none;border:0;padding:2px';
    button.addEventListener('click',function(e){e.stopPropagation();chooseElement(item);}); crumb.appendChild(button);
  });
  document.body.appendChild(crumb);
}
function candidates(target){
  var result=[], el=target;
  while(el && el !== document.body){
    if(el.nodeType===1 && /^(ARTICLE|SECTION|DIV|P|LI|H[1-6]|TR|TD|TH|BLOCKQUOTE|PRE|FIGURE)$/.test(el.tagName) && cleanText(el).trim() || el.nodeType===1 && /^(IMG|SVG|CANVAS)$/.test(el.tagName.toUpperCase()))result.push(el);
    el=el.parentElement;
  }
  return result;
}
function chooseElement(el){
  if(!el)return;
  if(inspected)inspected.style.outline=previousOutline;
  inspected=el; previousOutline=el.style.outline; el.style.outline='2px solid var(--nl-selection)';
  var text=cleanText(el).trim(), tag=el.tagName.toLowerCase(), nonText=!text && /^(img|svg|canvas)$/.test(tag), before=document.createRange();
  if(nonText) text=(el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('title') || tag).trim();
  before.selectNodeContents(document.body); before.setEndBefore(el);
  var prefix=cleanText(before.cloneContents()), occurrence=0, at=0;
  while((at=prefix.indexOf(text,at))>=0){occurrence++;at+=text.length;}
  var r=el.getBoundingClientRect();
  showCrumbs(el);
  post({type:'selection',text:text,occurrence:occurrence,element:nonText ? {tag:tag,index:Array.from(document.querySelectorAll(tag)).indexOf(el)} : undefined,rect:{left:r.left,top:r.top,width:r.width,height:r.height}});
}
document.addEventListener('click',function(e){
  if(e.detail>1 || e.target.closest('a,button,input,textarea,select,[contenteditable]') || window.getSelection().toString().trim())return;
  var list=candidates(e.target); if(!list.length)return;
  var parent=/^(IMG|SVG|CANVAS)$/.test(e.target.tagName.toUpperCase()) ? e.target : list.find(function(el){return /^(ARTICLE|SECTION)$/.test(el.tagName);});
  setTimeout(function(){chooseElement(parent || list[Math.min(1,list.length-1)]);},0);
});
document.addEventListener('dblclick',function(e){
  if(e.target.closest('a,button,input,textarea,select,[contenteditable],[data-nl-inspector]'))return;
  var list=candidates(e.target), index=list.indexOf(inspected);
  if(index>0){window.getSelection().removeAllRanges();setTimeout(function(){chooseElement(list[index-1]);},0);}
});

window.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();if(inspected){var chain=candidates(inspected), parent=chain[1];if(parent)chooseElement(parent);else {clearInspection();post({type:'selection',text:''});}}else post({type:'escape'});}});
function reportMarks(){
  var seen = {}, marks = [];
  document.querySelectorAll('mark[data-snapshot-id]').forEach(function(mark){
    var id = mark.dataset.snapshotId;
    if (seen[id]) return; seen[id] = true;
    var r = mark.getBoundingClientRect();
    marks.push({id:id, rect:{left:r.left,top:r.top,width:r.width,height:r.height}});
  });
  post({type:'anchors', marks:marks});
}
function paint(marks){
  var keep = {};
  marks.forEach(function(m){keep[m.id]=true;});
  document.querySelectorAll('mark[data-snapshot-id]').forEach(function(mark){
    if (keep[mark.dataset.snapshotId]) return;
    var p=mark.parentNode; while(mark.firstChild) p.insertBefore(mark.firstChild,mark); mark.remove(); p.normalize();
  });
  marks.forEach(function(h){
    if (!h.quote || Array.from(document.querySelectorAll('mark[data-snapshot-id]')).some(function(m){return m.dataset.snapshotId===h.id;})) return;
    var semantic=segments(document.body), full=semantic.text;
    var at=-1;
    for(var i=0;i<=h.occurrence;i++){at=full.indexOf(h.quote,at<0?0:at+h.quote.length);if(at<0)break;}
    if(at<0)return;
    semantic.runs.forEach(function(run){
      var n=run.node, lo=Math.max(0,at-run.start), hi=Math.min(run.end-run.start,at+h.quote.length-run.start);
      if(hi>lo){
        var r=document.createRange();r.setStart(n,lo);r.setEnd(n,hi);
        var mark=document.createElement('mark');mark.dataset.snapshotId=h.id;mark.style.backgroundColor=h.color;mark.style.color='var(--nl-ink)';r.surroundContents(mark);
      }
    });
  });
  reportMarks();
}
window.addEventListener('message',function(e){
  if(e.source!==parent || !e.data || !e.data.__nlHtmlCommand)return;
  if(e.data.__nlHtmlCommand==='clear'){window.getSelection().removeAllRanges();clearInspection();return;}
  if(e.data.__nlHtmlCommand==='marks' && Array.isArray(e.data.marks))paint(e.data.marks);
});
var markFrame=0;
function scheduleMarks(){if(!markFrame)markFrame=requestAnimationFrame(function(){markFrame=0;reportMarks();});}
window.addEventListener('scroll',scheduleMarks,true);
window.addEventListener('resize',scheduleMarks);
window.addEventListener('nl-pagination-layout',scheduleMarks);
if(document.fonts){document.fonts.addEventListener('loadingdone',scheduleMarks);document.fonts.ready.then(scheduleMarks);}
window.addEventListener('wheel',function(e){
  var scroll=e.target.nodeType===1?e.target:e.target.parentElement;
  if(!e.ctrlKey){
    while(scroll){
      var style=getComputedStyle(scroll);
      if(scroll===document.scrollingElement || /auto|scroll/.test(style.overflow+style.overflowY+style.overflowX)){
        var canY=e.deltaY<0?scroll.scrollTop>0:e.deltaY>0&&scroll.scrollTop+scroll.clientHeight<scroll.scrollHeight-1;
        var horizontal=/auto|scroll/.test(style.overflowX) || scroll===document.scrollingElement;
        var hasX=horizontal && scroll.scrollWidth>scroll.clientWidth+1;
        // Keep horizontal gestures in their HTML scroller even at its boundary.
        if(hasX && e.deltaX && Math.abs(e.deltaX)>=Math.abs(e.deltaY)){
          var unit=e.deltaMode===1?16:e.deltaMode===2?scroll.clientWidth:1;
          e.preventDefault();scroll.scrollLeft+=e.deltaX*unit;return;
        }
        var canX=horizontal && (e.deltaX<0?scroll.scrollLeft>0:e.deltaX>0&&scroll.scrollLeft+scroll.clientWidth<scroll.scrollWidth-1);
        if(canY||canX)return;
      }
      scroll=scroll.parentElement;
    }
  }
  e.preventDefault();
  post({type:'wheel',deltaX:e.deltaX,deltaY:e.deltaY,deltaMode:e.deltaMode,ctrlKey:e.ctrlKey,metaKey:e.metaKey,clientX:e.clientX,clientY:e.clientY});
},{passive:false});
})();</` + `script>`;

export function withSelectionBridge(html: string, fullPage = false, paginated = false, streaming = false): string {
  const readerStyle = fullPage ? '<style>body{box-sizing:border-box;max-width:880px;margin-inline:auto!important;padding:24px}img,svg,canvas{max-width:100%}</style>' : '';
  const bridge = readerStyle + readingScript + BRIDGE_SCRIPT + (paginated ? paginationScript : '') + (streaming ? streamingScript : '');
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${bridge}</body>`) : html + bridge;
}
