import { cloudMode,userId } from './client';
const prefix=():string=>cloudMode()?`notlinear-account:${userId()}:`:'';
// Every persistent UI preference and legacy key is scoped without changing desktop keys.
export const accountStorage:Pick<Storage,'getItem'|'setItem'|'removeItem'>={
 getItem:key=>window.localStorage.getItem(prefix()+key),
 setItem:(key,value)=>window.localStorage.setItem(prefix()+key,value),
 removeItem:key=>window.localStorage.removeItem(prefix()+key),
};
