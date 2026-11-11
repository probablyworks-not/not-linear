import type {SketchGraph,Operation} from './model';
export interface SketchEditor { render(graph:SketchGraph):void; frame():void; bounds(id:string):DOMRect|undefined; selected():string[]; clearSelection():void; fit():void; zoom(delta:number):void; dispose():void }
export function createEditor(container:HTMLElement, callbacks:{commit(ops:Operation[]):void;select(ids:string[]):void;rename(id:string):void}):SketchEditor;
