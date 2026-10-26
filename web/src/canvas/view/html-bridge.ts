// Injected into every generated HTML document before it becomes an iframe's `srcDoc`
// (`PartView.tsx`) — app-controlled, not model-written. Reports two things to the parent window
// via `postMessage`, tagged `__nlHtmlPart` so PartView's listener never mistakes an unrelated
// message (e.g. from a Chart.js CDN script, or another extension) for one of these:
//   - `height` (also carries `width`): the document's real content size, so the iframe —  and the
//     canvas card around it — can size to fit instead of being clipped to or stuck at a fixed
//     size. Width is measured with a brief, synchronous layout toggle (`html`/`body` forced to
//     shrink-to-fit, read, then restored before the browser ever paints the in-between state, so
//     there's no visible flicker) since the iframe's own viewport would otherwise always report
//     back whatever width it was just given, not the content's natural one.
//   - `selection`: the user's text selection inside the iframe, which `window.getSelection()` on
//     the parent document can never see (a sandboxed iframe is a separate document).
//   - `wheel`: a wheel/trackpad gesture over the iframe. A native wheel event never bubbles out of
//     an iframe to the parent document — it's a separate browsing context — so without this the
//     canvas simply stops panning/zooming the instant the pointer crosses onto the generated page
//     (bug: "can't scroll near the node"). The generated document is sized to its content and
//     never meant to scroll itself (see `HtmlFrame` in `PartView.tsx`), so every wheel event here
//     is forwarded, never consumed locally.
// `allow-scripts` without `allow-same-origin` (PartView.tsx) still permits `postMessage` out —
// that channel is cross-origin by design — while the iframe's own origin stays opaque and
// isolated from the app.
const BRIDGE_SCRIPT = `<script>(function(){
function post(msg){ try{ parent.postMessage(Object.assign({__nlHtmlPart:true}, msg), '*'); }catch(e){} }
function naturalWidth(){
  var html = document.documentElement, body = document.body;
  var prevHtmlWidth = html.style.width, prevBodyDisplay = body.style.display;
  html.style.width = 'max-content';
  body.style.display = 'inline-block';
  var w = Math.ceil(html.scrollWidth);
  html.style.width = prevHtmlWidth;
  body.style.display = prevBodyDisplay;
  return w;
}
function reportHeight(){ post({type:'height', height: Math.ceil(document.documentElement.scrollHeight), width: naturalWidth()}); }
if (window.ResizeObserver) new ResizeObserver(reportHeight).observe(document.documentElement);
window.addEventListener('load', reportHeight);
reportHeight();
function reportSelection(){
  var sel = window.getSelection();
  var text = sel ? sel.toString().trim() : '';
  if (!text) { post({type:'selection', text:''}); return; }
  var r = sel.getRangeAt(0).getBoundingClientRect();
  post({type:'selection', text: text, rect: {left:r.left, top:r.top, width:r.width, height:r.height}});
}
document.addEventListener('selectionchange', reportSelection);
window.addEventListener('wheel', function(e){
  post({type:'wheel', deltaX:e.deltaX, deltaY:e.deltaY, deltaMode:e.deltaMode, ctrlKey:e.ctrlKey, metaKey:e.metaKey, clientX:e.clientX, clientY:e.clientY});
}, {passive:true});
})();</` + `script>`;

export function withSelectionBridge(html: string): string {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${BRIDGE_SCRIPT}</body>`) : html + BRIDGE_SCRIPT;
}
