import { useEffect,useState } from 'react';
interface InstallPrompt extends Event {prompt():Promise<void>}
export function InstallApp(){
 const [prompt,setPrompt]=useState<InstallPrompt|null>(null),[help,setHelp]=useState(false);
 useEffect(()=>{const onPrompt=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPrompt);};window.addEventListener('beforeinstallprompt',onPrompt);return()=>window.removeEventListener('beforeinstallprompt',onPrompt);},[]);
 return <><button onClick={()=>{if(prompt)void prompt.prompt().then(()=>setPrompt(null));else setHelp(v=>!v);}}>Install app</button>
 {help&&<span role="status">Use your browser menu: Install app, Add to Dock, or Create shortcut. Internet access is required.</span>}</>;
}
