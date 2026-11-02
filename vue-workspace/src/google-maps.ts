let pending:Promise<any>|null=null;
let attempt=0,authHook=false,authFailed=false;
export function loadGoogleMaps(apiKey:string):Promise<any>{
 const win=window as any;
 if(authFailed)return Promise.reject(new Error('Google 地圖授權未通過，請管理員確認設定後重新整理工作台。'));
 if(!apiKey)return Promise.reject(new Error('整合地圖尚未設定，請聯絡管理員。'));
 if(!authHook){authHook=true;const prior=win.gm_authFailure;win.gm_authFailure=()=>{authFailed=true;window.dispatchEvent(new Event('workspace-maps-auth-error'));if(typeof prior==='function')prior();};}
 if(pending)return pending;
 pending=new Promise((resolve,reject)=>{
  const script=document.createElement('script'),callback='__fkWorkspaceMapsLoaded'+(++attempt);
  let finished=false;
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('workspace-maps-auth-error',authError);win[callback]=()=>{};};
  const fail=(message:string)=>{if(finished)return;finished=true;cleanup();script.remove();pending=null;reject(new Error(message));};
  const authError=()=>fail('Google 地圖授權未通過，請聯絡管理員確認網站設定。');
  const ready=async()=>{try{const [maps,marker]=await Promise.all([win.google.maps.importLibrary('maps'),win.google.maps.importLibrary('marker')]);if(finished)return;finished=true;cleanup();resolve({...maps,...marker,event:win.google.maps.event,LatLngBounds:win.google.maps.LatLngBounds});}catch{fail('Google 地圖載入失敗，請重試。');}};
  const timer=window.setTimeout(()=>fail('Google 地圖載入逾時，請確認網路後重試。'),15000);
  window.addEventListener('workspace-maps-auth-error',authError);
  if(win.google?.maps?.importLibrary){void ready();return;}
  win[callback]=ready;
  script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key:apiKey,callback,loading:'async',v:'weekly',libraries:'marker',language:'zh-TW',region:'TW'});
  script.async=true;script.onerror=()=>fail('Google 地圖連線失敗，請確認網路後重試。');document.head.appendChild(script);
 });
 return pending;
}
export function mapPosition(store:any):{lat:number;lng:number}|null{
 const lat=store?.gps_latitude,lng=store?.gps_longitude;
 if(lat==null||lng==null||String(lat).trim()===''||String(lng).trim()==='')return null;
 const position={lat:Number(lat),lng:Number(lng)};
 return Number.isFinite(position.lat)&&Number.isFinite(position.lng)&&Math.abs(position.lat)<=90&&Math.abs(position.lng)<=180?position:null;
}
