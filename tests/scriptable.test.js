// Scriptable API MOCKS. These exercise adapter control flow, not actual iOS UI.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');

function runtime(options = {}) {
  const keys=new Map(),files=new Map(),requests=[];
  class Stack {
    constructor(){this.items=[];}
    addText(value){const x={value:String(value)};this.items.push(x);return x;}
    addDate(date){const x={date,applyRelativeStyle(){this.relative=true;}};this.items.push(x);return x;}
    addStack(){const x=new Stack();this.items.push(x);return x;}
    addSpacer(){} setPadding(){} layoutVertically(){} layoutHorizontally(){}
    async presentLarge(){} async presentMedium(){} async presentSmall(){}
  }
  class Request {
    constructor(url){this.url=url;requests.push(this);this.response={statusCode:200,headers:{}};}
    async loadString(){return options.response || '{"code":0,"data":{}}';}
  }
  const fm={libraryDirectory:()=>'/local-library',joinPath:(a,b)=>a+'/'+b,
    fileExists:p=>files.has(p),createDirectory:p=>files.set(p,'DIR'),writeString:(p,s)=>files.set(p,s),
    readString:p=>files.get(p),copy:(a,b)=>files.set(b,files.get(a)),move:(a,b)=>{files.set(b,files.get(a));files.delete(a);},
    remove:p=>{for(const key of files.keys())if(key===p||key.startsWith(p+'/'))files.delete(key);}};
  const env={Keychain:{contains:k=>keys.has(k),get:k=>keys.get(k),set:(k,v)=>keys.set(k,v),remove:k=>keys.delete(k)},
    FileManager:{local:()=>fm},Request,ListWidget:Stack,Color:class{},Font:{systemFont:()=>({}),semiboldSystemFont:()=>({})},
    Script:{name:()=> 'Inteless Solar'},Device:{model:()=> 'MOCK iPhone',systemVersion:()=> '27.0 MOCK'},
    WebView:class {async loadHTML(s){assert.ok(!s.includes('<script src'));}async evaluateJavaScript(s){
      return vm.runInNewContext(s,options.noRandom?{}:{crypto:crypto.webcrypto});
    }} };
  vm.createContext(env);
  for(const name of ['core','crypto','scriptable'])vm.runInContext(fs.readFileSync(`${__dirname}/../src/${name}.js`,'utf8'),env);
  vm.runInContext('this.Phone=SolarPhone;this.Core=SolarCore;',env);
  return { ...env, keys, files, requests };
}
function strings(w){return w.items.flatMap(x=>x instanceof Object && x.items?strings(x):x.value?[x.value]:[]);}
test('adapter uses verified TLS, rejects redirects, fixed host, headers and JSON',async()=>{
  const r=runtime();await r.Phone.transport({method:'POST',path:'/oauth/token/new',params:{},body:{password:'SYNTHETIC-ENCRYPTED'},token:undefined});
  const req=r.requests[0];assert.equal(req.allowInsecureRequest,false);assert.equal(req.onRedirect(),null);
  assert.equal(req.url,'https://pv.inteless.com/oauth/token/new');assert.equal(req.timeoutInterval,12);
  assert.equal(req.headers['Content-Type'],'application/json');
});
test('local WebView encryption interoperates with native crypto; no CSPRNG fails closed',async()=>{
  const r=runtime();const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const key=publicKey.export({type:'spki',format:'pem'});
  const text='SYNTHETIC "</script>"';const encrypted=await r.Phone.encrypt(text,key);
  const decoded=crypto.privateDecrypt({key:privateKey,padding:crypto.constants.RSA_NO_PADDING},Buffer.from(encrypted,'base64'));
  assert.equal(decoded.subarray(decoded.indexOf(0,2)+1).toString(),text);
  await assert.rejects(()=>runtime({noRandom:true}).Phone.encrypt(text,key),e=>e.kind==='crypto');
});
test('all widget sizes include source date/time, age, freshness threshold and real unavailable labels',()=>{
  const r=runtime();const now=Date.UTC(2026,9,21,12);
  const settings={utcOffsetMinutes:60};const state=r.Phone.demo(now);state.demo=false;state.reading.batteryVoltage=null;
  for(const size of ['small','medium','large']){
    const w=r.Phone.widget(state,{name:'SYNTHETIC INSTALLATION'},settings,size,now);
    const texts=strings(w).join('\n');
    assert.ok(texts.includes('2026-10-21 12:58'));assert.ok(texts.includes('Stale after'));
    assert.ok(texts.includes('Age'));assert.equal(w.refreshAfterDate.getTime(),now+r.Core.POLL_MS);
    if(size!=='small')assert.ok(texts.includes('Unavailable'));
  }
});
test('demo always visibly marked; no-source timestamp never uses fetch time as source',()=>{
  const r=runtime();const state=r.Phone.demo(Date.now());
  assert.ok(strings(r.Phone.widget(state,null,{utcOffsetMinutes:60})).join(' ').includes('DEMO · NOT YOUR INSTALLATION'));
  state.demo=false;state.reading.sourceAt=null;
  assert.ok(strings(r.Phone.widget(state,null,{utcOffsetMinutes:60})).join(' ').includes('Source time unavailable · AGE UNKNOWN'));
});
test('cache files contain only passed normalized envelope; backup restoration and account isolation',()=>{
  const r=runtime();const a=r.Phone.cache('account-A'),b=r.Phone.cache('account-B');
  a.write('plant:sn',{version:1,reading:{sourceAt:123}});
  assert.equal(b.read('plant:sn'),null);assert.equal(a.read('plant:sn').reading.sourceAt,123);
  a.write('plant:sn',{version:1,reading:{sourceAt:456}});
  assert.equal(a.read('plant:sn').reading.sourceAt,456);
  const filename='/local-library/IntelessSolar-account-A/plant%3Asn.json';
  r.files.set(filename+'.bak',r.files.get(filename));r.files.delete(filename);
  assert.equal(a.read('plant:sn').reading.sourceAt,456);
  a.removeAll();assert.equal(a.read('plant:sn'),null);
});
test('widget parameters select only devices previously authorized in local setup',()=>{
  const r=runtime();const selected={plantId:'P',sn:'S'};
  assert.equal(r.Phone.selection({selection:selected,selections:[selected]},'P:S'),selected);
  assert.equal(r.Phone.selection({selection:selected,selections:[selected]},'unknown'),null);
});
