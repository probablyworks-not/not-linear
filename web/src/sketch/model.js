/* global crypto */
// Application-owned, DOM-free graph and operation contract. X6 is an adapter only.
export const NODE_TYPES = ['start', 'step', 'decision', 'end'];
export const clone = value => JSON.parse(JSON.stringify(value));
export const uid = () => crypto.randomUUID();
export function emptyGraph(){ return { version:1, nodes:[], edges:[], layout:{} }; }
const fail = message => { throw new Error(message); };
const idOK = id => typeof id === 'string' && !['__proto__','constructor','prototype'].includes(id) && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const labelOK = label => typeof label === 'string' && label.length <= 2000;
export function validateGraph(graph){
  if (!graph || graph.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !graph.layout || typeof graph.layout !== 'object' || Array.isArray(graph.layout)) fail('Unsupported Sketch graph.');
  if (graph.nodes.length > 500 || graph.edges.length > 1500) fail('Sketch supports up to 500 steps and 1,500 connections.');
  const ids = new Set();
  for (const node of graph.nodes){
    if (!idOK(node.id) || ids.has(node.id) || !NODE_TYPES.includes(node.type) || !labelOK(node.label)) fail('Invalid or duplicate step.');
    ids.add(node.id);
    const p = graph.layout[node.id];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e6 || Math.abs(p.y) > 1e6) fail('Invalid step position.');
  }
  const nodes = new Set(ids);
  for (const edge of graph.edges){
    if (!idOK(edge.id) || ids.has(edge.id) || !nodes.has(edge.source) || !nodes.has(edge.target) || !labelOK(edge.label)) fail('Invalid connection or missing step.');
    ids.add(edge.id);
  }
  return graph;
}
export function applyOperations(graph, operations){
  if (!Array.isArray(operations) || operations.length > 2000) fail('Expected a list of Sketch operations.');
  const next = clone(validateGraph(graph));
  for (const op of operations){
    if (!op || typeof op !== 'object') fail('Invalid operation.');
    const node = next.nodes.find(n => n.id === op.id);
    const edge = next.edges.find(e => e.id === op.id);
    switch (op.op){
      case 'addNode':
        if (next.nodes.length >= 500) fail('Sketch supports up to 500 steps.');
        if (!idOK(op.id) || op.id === '__proto__' || op.id === 'constructor' || node || edge) fail('Step ID already exists or is invalid.');
        next.nodes.push({id:op.id, type:op.type, label:op.label});
        {
          let x = op.x, y = op.y;
          if (x === undefined && y === undefined){
            let slot = 0;
            do { x = 80 + slot % 4 * 320; y = 80 + Math.floor(slot / 4) * 200; slot++; }
            while (Object.values(next.layout).some(p => Math.abs(p.x - x) < 290 && Math.abs(p.y - y) < 170));
          }
          next.layout[op.id] = {x, y};
        }
        break;
      case 'updateNode':
        if (!node) fail('Step no longer exists.');
        if (op.label !== undefined) node.label = op.label;
        if (op.type !== undefined) node.type = op.type;
        break;
      case 'moveNode':
        if (!node) fail('Step no longer exists.');
        next.layout[op.id] = {x:op.x, y:op.y};
        break;
      case 'removeNode':
        if (!node) fail('Step no longer exists.');
        next.nodes = next.nodes.filter(n => n.id !== op.id);
        next.edges = next.edges.filter(e => e.source !== op.id && e.target !== op.id);
        delete next.layout[op.id];
        break;
      case 'addEdge':
        if (next.edges.length >= 1500) fail('Sketch supports up to 1,500 connections.');
        if (node || edge) fail('Connection ID already exists.');
        next.edges.push({id:op.id, source:op.source, target:op.target, label:op.label ?? ''});
        break;
      case 'updateEdge':
        if (!edge) fail('Connection no longer exists.');
        if (op.label !== undefined) edge.label = op.label;
        if (op.source !== undefined) edge.source = op.source;
        if (op.target !== undefined) edge.target = op.target;
        break;
      case 'removeEdge':
        if (!edge) fail('Connection no longer exists.');
        next.edges = next.edges.filter(e => e.id !== op.id);
        break;
      default: fail('Unknown Sketch operation.');
    }
  }
  return validateGraph(next);
}
// Longest-path layers after removing DFS back edges. Retries do not pull later steps backward.
export function arrangeOperations(graph){
  validateGraph(graph);
  const outgoing = new Map(graph.nodes.map(n => [n.id, graph.edges.filter(e => e.source === n.id)]));
  const state = new Map(), back = new Set(), order = [];
  function visit(id){
    if (state.has(id)) return;
    state.set(id, 1);
    for (const edge of outgoing.get(id)){
      if (state.get(edge.target) === 1) back.add(edge.id);
      else visit(edge.target);
    }
    state.set(id, 2); order.push(id);
  }
  const incoming = new Set(graph.edges.map(e => e.target));
  for (const node of graph.nodes.filter(n => !incoming.has(n.id))) visit(node.id);
  for (const node of graph.nodes) visit(node.id);
  const rank = new Map(graph.nodes.map(n => [n.id, 0]));
  for (const id of order.reverse()) for (const edge of outgoing.get(id)){
    if (!back.has(edge.id)) rank.set(edge.target, Math.max(rank.get(edge.target), rank.get(id) + 1));
  }
  const layers = new Map();
  for (const node of graph.nodes){ const r = rank.get(node.id); if (!layers.has(r)) layers.set(r, []); layers.get(r).push(node.id); }
  const widest = Math.max(1, ...[...layers.values()].map(ids => ids.length));
  return [...layers.entries()].sort((a,b) => a[0]-b[0]).flatMap(([r, ids]) => ids.map((id,i) => ({op:'moveNode',id,x:80 + (i + (widest-ids.length)/2)*400,y:80+r*200})));
}
export function parseEditResponse(text){
  const plain = text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
  return JSON.parse(plain);
}
export function applyEdit(document, response){
  if (!response || response.revision !== document.revision) fail('Sketch changed while AI was working. Submit again to use the latest version.');
  if (response.operations?.some(op => op.op === 'moveNode')) fail('AI cannot move existing steps. Use Arrange to change the layout.');
  return applyOperations(document.graph, response.operations);
}
