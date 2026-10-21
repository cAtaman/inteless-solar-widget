// Scriptable API MOCKS. These exercise adapter control flow, not actual iOS UI.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');

function runtime(options = {}) {
  const keys=new Map(),files=new Map(),requests=[],timers=[],webviews=[];
  class Stack {
    constructor(){this.items=[];}
    addText(value){const x={value:String(value)};this.items.push(x);return x;}
    addDate(date){const x={date,applyRelativeStyle(){this.relative=true;}};this.items.push(x);return x;}
    addStack(){const x=new Stack();this.items.push(x);return x;}
    addImage(image){const x={image};this.items.push(x);return x;}
    addSpacer(){} setPadding(){} layoutVertically(){} layoutHorizontally(){}
    async presentLarge(){} async presentMedium(){} async presentSmall(){}
  }
  class Request {
    constructor(url){this.url=url;this._headers={};requests.push(this);this.response={statusCode:200,headers:{}};}
    // Mirror the bridge behavior that makes `request.headers.Foo = ...`
    // unreliable after assigning `headers`.
    set headers(value){this._headers={...value};}
    get headers(){return {...this._headers};}
    async loadString(){return options.loadString ? options.loadString(this) : options.response || '{"code":0,"data":{}}';}
  }
  const fm={libraryDirectory:()=>'/local-library',joinPath:(a,b)=>a+'/'+b,
    fileExists:p=>files.has(p),createDirectory:p=>files.set(p,'DIR'),writeString:(p,s)=>files.set(p,s),
    readString:p=>files.get(p),copy:(a,b)=>files.set(b,files.get(a)),move:(a,b)=>{files.set(b,files.get(a));files.delete(a);},
    remove:p=>{for(const key of files.keys())if(key===p||key.startsWith(p+'/'))files.delete(key);}};
  const env={Keychain:{contains:k=>keys.has(k),get:k=>keys.get(k),set:(k,v)=>keys.set(k,v),remove:k=>keys.delete(k)},
    FileManager:{local:()=>fm},Request,ListWidget:Stack,Color:class{},Font:{systemFont:()=>({}),semiboldSystemFont:()=>({})},
    Script:{name:()=> 'Inteless Solar'},Device:{model:()=> 'MOCK iPhone',systemVersion:()=> '27.0 MOCK'}, Size:class {constructor(width,height){this.width=width;this.height=height;}},
    Point:class {constructor(x,y){this.x=x;this.y=y;}}, Rect:class {constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}},
    Path:class {move(){} addLine(){}}, DrawContext:class {setFillColor(){} fillRect(){} setStrokeColor(){} setLineWidth(){} addPath(){} strokePath(){} setFont(){} setTextColor(){} drawTextInRect(){} getImage(){return {synthetic:true};}},
    Timer:{schedule(ms,repeats,callback){const timer={ms,repeats,invalidated:false,
      invalidate(){this.invalidated=true;},fire(){if(!this.invalidated)callback();}};timers.push(timer);return timer;}},
    WebView:class {
      constructor(){this.evaluations=0;webviews.push(this);}
      async loadHTML(s){
        assert.ok(s.includes("default-src 'none'"));assert.ok(!s.includes('<script src'));
        // Model the initial navigation that the old unconditional veto blocked.
        if(this.shouldAllowRequest && !this.shouldAllowRequest({url:'about:blank'}))return new Promise(()=>{});
        return options.loadHTML ? options.loadHTML() : undefined;
      }
      async evaluateJavaScript(s){
      this.evaluations++;assert.equal(this.shouldAllowRequest({url:'https://example.invalid/'}),false);
      if(options.evaluateJavaScript)return options.evaluateJavaScript();
      return vm.runInNewContext(s,options.noRandom?{}:{crypto:crypto.webcrypto});
    }} };
  vm.createContext(env);
  for(const name of ['core','crypto','scriptable'])vm.runInContext(fs.readFileSync(`${__dirname}/../src/${name}.js`,'utf8'),env);
  vm.runInContext('this.Phone=SolarPhone;this.Core=SolarCore;',env);
  return { ...env, keys, files, requests, timers, webviews };
}
function strings(w){return w.items.flatMap(x=>x instanceof Object && x.items?strings(x):x.value?[x.value]:[]);}
test('adapter uses verified TLS, rejects redirects, fixed host, headers and JSON',async()=>{
  const r=runtime();await r.Phone.transport({method:'POST',path:'/oauth/token/new',params:{},body:{password:'SYNTHETIC-ENCRYPTED'},token:undefined});
  const req=r.requests[0];assert.equal(req.allowInsecureRequest,false);assert.equal(req.onRedirect(),null);
  assert.equal(req.url,'https://pv.inteless.com/oauth/token/new');assert.equal(req.timeoutInterval,12);
  assert.equal(req.headers['Content-Type'],'application/json;charset=UTF-8');
  assert.equal(req.headers.Accept,'application/json');
});
test('local WebView encryption interoperates with native crypto; no CSPRNG fails closed',async()=>{
  const r=runtime();const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const key=publicKey.export({type:'spki',format:'pem'});
  const text='SYNTHETIC "</script>"';const encrypted=await r.Phone.encrypt(text,key);
  const decoded=crypto.privateDecrypt({key:privateKey,padding:crypto.constants.RSA_NO_PADDING},Buffer.from(encrypted,'base64'));
  assert.equal(decoded.subarray(decoded.indexOf(0,2)+1).toString(),text);
  await assert.rejects(()=>runtime({noRandom:true}).Phone.encrypt(text,key),e=>e.kind==='crypto');
  assert.ok(r.timers.every(t=>t.invalidated));
});
test('a stuck local WebView load times out without encrypting after a late completion',async()=>{
  let finishLoad;const r=runtime({loadHTML:()=>new Promise(resolve=>{finishLoad=resolve;})});
  const pending=r.Phone.encrypt('SYNTHETIC','unused');
  const rejected=assert.rejects(pending,e=>e.kind==='crypto' && e.stage==='Opening local encryption context');
  await new Promise(setImmediate);assert.equal(r.timers[0].ms,5000);r.timers[0].fire();await rejected;
  finishLoad();await new Promise(setImmediate);
  assert.equal(r.webviews[0].evaluations,0);assert.ok(r.timers.every(t=>t.invalidated));
});
test('a stuck WebView evaluation times out and consumes a late native rejection',async()=>{
  let failEvaluation;const r=runtime({evaluateJavaScript:()=>new Promise((_,reject)=>{failEvaluation=reject;})});
  const pending=r.Phone.encrypt('SYNTHETIC','unused');
  const rejected=assert.rejects(pending,e=>e.kind==='crypto' && e.stage==='Encrypting sign-in locally');
  await new Promise(setImmediate);const timer=r.timers.find(t=>!t.invalidated);assert.equal(timer.ms,5000);
  timer.fire();await rejected;failEvaluation(new Error('SYNTHETIC PRIVATE NATIVE ERROR'));await new Promise(setImmediate);
  assert.ok(r.timers.every(t=>t.invalidated));
});
test('a stalled native request has a watchdog and cannot resume login on late key arrival',async()=>{
  let finishRequest,encryptions=0;const r=runtime({loadString:()=>new Promise(resolve=>{finishRequest=resolve;})});
  r.Phone.store.set('credentials',{username:'SYNTHETIC',password:'SYNTHETIC'});
  const api=new r.Core.Client({transport:r.Phone.transport,store:r.Phone.store,crypto:{md5:()=>'',encrypt:async()=>{encryptions++;return 'SYNTHETIC';}}});
  const rejected=assert.rejects(api.authenticate(),e=>e.kind==='network' && e.stage==='Fetching public key');
  await new Promise(setImmediate);assert.equal(r.timers[0].ms,12000);r.timers[0].fire();await rejected;
  finishRequest(JSON.stringify({code:0,data:'SYNTHETIC'.repeat(20)}));await new Promise(setImmediate);
  assert.equal(encryptions,0);assert.equal(r.requests.length,1);assert.equal(r.Phone.store.get('token'),null);
  assert.ok(r.timers.every(t=>t.invalidated));
});
test('all widget sizes show separate friendly cloud and fetch timestamp lines with ages',()=>{
  const r=runtime();const now=Date.UTC(2026,9,21,12);
  const settings={utcOffsetMinutes:60};const state=r.Phone.demo(now);state.demo=false;state.reading.batteryVoltage=null;
  for(const size of ['small','medium','large']){
    const w=r.Phone.widget(state,{name:'SYNTHETIC INSTALLATION'},settings,size,now);
    const texts=strings(w).join('\n');
    assert.ok(texts.includes('Cloud 21 Oct, 12:58'));assert.ok(texts.includes('Fetch 21 Oct, 13:00'));
    const directLines=w.items.filter(item=>item?.items).map(line=>line.items.filter(item=>item.value).map(item=>item.value).join(''));
    assert.ok(directLines.some(line=>line.startsWith('Cloud ')));assert.ok(directLines.some(line=>line.startsWith('Fetch ')));
    assert.equal(w.refreshAfterDate.getTime(),now+r.Core.POLL_MS);
    if(size!=='small')assert.ok(texts.includes('Unavailable'));
  }
});
test('demo always visibly marked; no-source timestamp never uses fetch time as source',()=>{
  const r=runtime();const state=r.Phone.demo(Date.now());
  assert.ok(strings(r.Phone.widget(state,null,{utcOffsetMinutes:60})).join(' ').includes('DEMO · NOT YOUR INSTALLATION'));
  state.demo=false;state.reading.sourceAt=null;
  assert.ok(strings(r.Phone.widget(state,null,{utcOffsetMinutes:60})).join(' ').includes('Cloud timestamp unavailable'));
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
test('local chart history keeps only normalized samples and never invents points while cached',()=>{
  const r=runtime(), selected={plantId:'fixture-plant',sn:'fixture-inverter'}, c=r.Phone.cache('account-A');
  const first=r.Phone.demo(1000);first.demo=false;const samples=r.Phone.history(c,selected,first);
  assert.equal(samples.length,1);assert.deepEqual(Object.keys(samples[0]).sort(),['at','batteryPower','batterySoc','gridPower','loadPower','solarPower']);
  const next=r.Phone.demo(2000);next.demo=false;next.reading.solarPower=3300;r.Phone.history(c,selected,next);
  const cached={...next,cached:true};cached.reading.fetchedAt=3000;assert.equal(r.Phone.history(c,selected,cached).length,2);
  assert.deepEqual(r.Phone.chart(r.Phone.history(c,selected,next)),{synthetic:true});
});
test('widget parameters select only devices previously authorized in local setup',()=>{
  const r=runtime();const selected={plantId:'P',sn:'S'};
  assert.equal(r.Phone.selection({selection:selected,selections:[selected]},'P:S'),selected);
  assert.equal(r.Phone.selection({selection:selected,selections:[selected]},'unknown'),null);
});
