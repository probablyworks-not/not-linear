import { cloudMode,cloudRequest } from './client';
import { accountStorage } from './local-storage';
export function track(name:string,once=false):void{
 if(!cloudMode())return;
 const key='event:'+name;if(once&&accountStorage.getItem(key))return;
 if(once)accountStorage.setItem(key,'1');
 void cloudRequest('/events',{method:'POST',body:JSON.stringify({name})}).catch(()=>{});
}
