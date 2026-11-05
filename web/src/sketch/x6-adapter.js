/* global window */
// All X6-specific rendering and event translation lives here.
export function createEditor(container, {commit, select, rename}){
  if (!window.X6?.Graph) throw new Error('Sketch editor could not load. Refresh to retry.');
  const graph = new window.X6.Graph({
    container, autoResize:true, async:false, grid:false,
    panning:{enabled:true, modifiers:'shift'},
    mousewheel:{enabled:true, modifiers:['ctrl', 'meta'], minScale:0.2, maxScale:2},
    connecting:{allowBlank:false, allowLoop:true, allowNode:false, allowEdge:false, snap:true,
      validateConnection:({sourceCell, targetCell}) => !!sourceCell?.isNode() && !!targetCell?.isNode(),
      createEdge:() => graph.createEdge({shape:'edge', router:{name:'manhattan',args:{padding:32,step:16}},connector:{name:'rounded',args:{radius:12}}, attrs:{line:{stroke:'var(--text-2)', strokeWidth:2, targetMarker:'classic'}}})},
  });
  let drawing = false, selected = new Set(), current;
  const choose = (cell, additive) => {
    if (!additive) selected.clear();
    if (cell){ if (additive && selected.has(cell.id)) selected.delete(cell.id); else selected.add(cell.id); }
    paintSelection(); select([...selected]);
  };
  const paintSelection = () => {
    for (const node of graph.getNodes()) node.attr('body/stroke', selected.has(node.id) ? 'var(--accent)' : 'var(--rule-2)');
    for (const edge of graph.getEdges()) edge.attr('line/stroke', selected.has(edge.id) ? 'var(--accent)' : 'var(--text-2)');
  };
  graph.on('cell:click', ({cell, e}) => choose(cell, e.shiftKey));
  graph.on('blank:click', () => choose(null, false));
  graph.on('cell:dblclick', ({cell}) => rename(cell.id));
  graph.on('node:moved', ({node}) => {
    if (!drawing){ const {x,y} = node.position(); commit([{op:'moveNode',id:node.id,x,y}]); }
  });
  graph.on('edge:connected', ({edge}) => {
    if (drawing) return;
    const exists = current.edges.some(e => e.id === edge.id);
    commit([{op:exists ? 'updateEdge' : 'addEdge', id:edge.id, source:edge.getSourceCellId(), target:edge.getTargetCellId(), label:exists ? current.edges.find(e => e.id === edge.id).label : ''}]);
  });
  function render(value){
    current = value; drawing = true;
    const ids = new Set([...value.nodes, ...value.edges].map(c => c.id));
    selected = new Set([...selected].filter(id => ids.has(id)));
    try {
      graph.fromJSON({nodes:value.nodes.map(node => ({
        id:node.id, shape:node.type === 'decision' ? 'polygon' : 'rect', ...value.layout[node.id], width:260, height:node.type === 'decision' ? 120 : 80,
        attrs:{body:{fill:'var(--surface-2)', stroke:'var(--rule-2)', strokeWidth:2,
          ...(node.type === 'decision' ? {refPoints:'0,60 130,0 260,60 130,120'} : {rx:node.type === 'start' || node.type === 'end' ? 32 : 8, ry:node.type === 'start' || node.type === 'end' ? 32 : 8})},
          label:{text:node.label, fill:'var(--text)', fontSize:13, textWrap:{width:node.type === 'decision' ? 165 : 230,height:60,ellipsis:true}}},
        ports:{groups:Object.fromEntries(['top','bottom','left','right'].map(side => [side,{position:side,attrs:{circle:{r:5,magnet:true,stroke:'var(--text-2)',fill:'var(--bg)'}}}])),items:[{id:'in',group:'top'},{id:'out',group:'bottom'},{id:'left',group:'left'},{id:'right',group:'right'}]},
      })), edges:value.edges.map(edge => {
        const back = value.layout[edge.target].y <= value.layout[edge.source].y;
        const side=value.layout[edge.source].x<=value.layout[edge.target].x?'left':'right';
        return {
          id:edge.id, shape:'edge', source:{cell:edge.source,port:back ? side : 'out'}, target:{cell:edge.target,port:back ? side : 'in'},
          router:{name:'manhattan',args:{padding:32,step:16,maxLoopCount:5000,startDirections:[back ? side : 'bottom'],endDirections:[back ? side : 'top']}},
          connector:{name:'rounded',args:{radius:12}},
          attrs:{line:{stroke:'var(--text-2)',strokeWidth:1.5,targetMarker:'classic'}},
          labels:edge.label ? [{position:{distance:.5,offset:12},attrs:{label:{text:edge.label,fill:'var(--text)',fontSize:12},body:{fill:'var(--bg)',stroke:'var(--rule)',rx:4,ry:4}}}] : [],
        };
      })});
      paintSelection(); select([...selected]);
    } finally { drawing = false; }
  }
  function frame(){
    const first=graph.getNodes()[0];if(!first)return;
    const box=graph.getContentBBox();
    const scale=Math.max(.65,Math.min(1,(container.clientWidth-80)/Math.max(260,box.width)));
    graph.zoomTo(scale);
    graph.translate(container.clientWidth/2-(first.position().x+130)*scale,40-first.position().y*scale);
  }
  return {render, frame, bounds:id => graph.findViewByCell(id)?.container.getBoundingClientRect(), selected:() => [...selected], clearSelection:() => choose(null,false), fit:() => graph.zoomToFit({padding:50,maxScale:1}), zoom:delta => graph.zoom(delta), dispose:() => graph.dispose()};
}
