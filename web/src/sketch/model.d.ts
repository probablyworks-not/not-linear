export interface SketchGraph { version:1; nodes:Array<{id:string;type:'start'|'step'|'decision'|'end';label:string}>; edges:Array<{id:string;source:string;target:string;label:string}>; layout:Record<string,{x:number;y:number}> }
export type Operation = {op:string;id:string;type?:string;label?:string;source?:string;target?:string;x?:number;y?:number};
export const NODE_TYPES:string[];
export function clone<T>(value:T):T;
export function uid():string;
export function emptyGraph():SketchGraph;
export function validateGraph(value:unknown):SketchGraph;
export function applyOperations(graph:SketchGraph, operations:Operation[]):SketchGraph;
export function arrangeOperations(graph:SketchGraph):Operation[];
export function applyEdit(document:{revision:number;graph:SketchGraph}, response:unknown):SketchGraph;

export function parseEditResponse(text:string):unknown;
