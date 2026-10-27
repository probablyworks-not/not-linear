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
    if(node.nodeType===1 && node.matches('script,style,button,template,head,[data-nl-page-gap]'))return;
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
window.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();post({type:'escape'});}});
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
        var mark=document.createElement('mark');mark.dataset.snapshotId=h.id;mark.style.backgroundColor=h.color;mark.style.color='inherit';r.surroundContents(mark);
      }
    });
  });
  reportMarks();
}
window.addEventListener('message',function(e){
  if(e.source!==parent || !e.data || !e.data.__nlHtmlCommand)return;
  if(e.data.__nlHtmlCommand==='clear'){window.getSelection().removeAllRanges();return;}
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
        var canX=e.deltaX<0?scroll.scrollLeft>0:e.deltaX>0&&scroll.scrollLeft+scroll.clientWidth<scroll.scrollWidth-1;
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
  const bridge = readerStyle + BRIDGE_SCRIPT + (paginated ? paginationScript : '') + (streaming ? streamingScript : '');
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${bridge}</body>`) : html + bridge;
}
