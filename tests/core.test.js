// All cloud responses here are SYNTHETIC FIXTURES, never account captures.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const C = require('../src/core');
const K = require('../src/crypto');
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const PREF = { utcOffsetMinutes: 60, batteryPositive: 'unknown', gridPositive: 'unknown' };
const SELECT = { plantId: 'fixture-plant', sn: 'fixture-inverter' };
const stamp = new Date(NOW - 120000).toISOString();
function fixture() {
  return {
    flow: { time: stamp, soc: '73', battV: '52.8', battPower: -600, toBat: true, batTo: false,
      pvPower: 2400, gridOrMeterPower: -200, gridTo: false, toGrid: true, loadOrEpsPower: 1600, loadVoltage: 228 },
    detail: { time: stamp, etoday: '9.25', status: 1 },
    battery: { time: stamp, soc: 73, voltage: 52.8 },
    pv: { time: stamp, pvIV: [{ vpv: '310' }, { vpv: null }] },
    grid: { time: stamp, vip: [{ volt: '230' }, { volt: 0 }] }
  };
}
function store(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return { get: k => entries.get(k), set: (k,v) => entries.set(k,v), remove: k => entries.delete(k), entries };
}
function ok(data) { return { status: 200, json: { code: 0, data } }; }
function client(transport, initial = {}) {
  const s = store(initial);
  return new C.Client({ transport, store: s, now: () => NOW, crypto: { md5: K.md5, encrypt: async () => 'FIXTURE-CIPHERTEXT' } });
}
const token = { access: 'FIXTURE-ACCESS', refresh: 'FIXTURE-REFRESH', expiresAt: NOW + 3600000 };

test('synthetic parsing: units, PV phases and explicit directions override raw signs', () => {
  const r = C.normalize(fixture(), PREF, NOW);
  assert.equal(r.batterySoc, 73); assert.equal(r.batteryVoltage, 52.8);
  assert.equal(r.batteryDirection, 'charging'); assert.equal(r.gridDirection, 'export');
  assert.equal(r.pvInputs[0].value, 310); assert.equal(r.pvInputs[1].value, null);
  assert.equal(r.todayKwh, 9.25); assert.equal(r.gridAvailability, 'voltage present');
  assert.equal(r.loadVoltage, 228);
  assert.equal(r.sourceAt, NOW - 120000); assert.equal(r.ageUnknown, false);
});
test('explicit unit conversion accepts only compatible dimensions', () => {
  assert.equal(C.quantity({ value: 1.25, unit: 'kW' }, 'W'), 1250);
  assert.equal(C.quantity({ value: 3250, unit: 'Wh' }, 'kWh'), 3.25);
  assert.equal(C.quantity({ value: 240, unit: 'W' }, 'V'), null);
  assert.equal(C.powerText(1250), '1.25 kW'); assert.equal(C.powerText(0), '0 W');
});
test('missing, empty, malformed, boolean and nonfinite readings never become zero', () => {
  for (const value of [null, undefined, '', ' ', '--', 'N/A', true, false, [], {}, NaN, Infinity, '1,000', '52 V']) assert.equal(C.number(value), null);
  const r = C.normalize({}, PREF, NOW);
  for (const field of ['batterySoc','batteryVoltage','batteryPower','solarPower','gridPower','loadPower','loadVoltage','todayKwh']) assert.equal(r[field], null);
  assert.equal(r.hasReadings, false); assert.equal(C.valueText(null, ' V'), 'Unavailable');
});
test('invalid primary field falls back to valid secondary; genuine zero remains zero', () => {
  const raw = fixture(); raw.flow.battV = '--'; raw.flow.soc = 0;
  const r = C.normalize(raw, PREF, NOW);
  assert.equal(r.batteryVoltage, 52.8); assert.equal(r.batterySoc, 0);
  raw.flow.soc = 101; raw.battery.soc = 101;
  assert.equal(C.normalize(raw, PREF, NOW).batterySoc, null);
});
test('direction never assumes a universal battery/grid sign convention', () => {
  assert.equal(C.direction(-500, undefined, undefined, 'unknown', 'out', 'in'), 'direction unverified');
  assert.equal(C.direction(500, true, true, 'out', 'out', 'in'), 'direction unverified');
  assert.equal(C.direction(0, true, false, 'unknown', 'out', 'in'), 'idle');
});
test('source timestamps support seconds, milliseconds, zones and installation offset', () => {
  assert.equal(C.timestamp(NOW / 1000), NOW); assert.equal(C.timestamp(String(NOW)), NOW);
  assert.equal(C.timestamp('2026-10-21 13:00:00', 60), NOW);
  assert.equal(C.timestamp('2026-10-21T13:00:00+01:00'), NOW);
  assert.equal(C.timestamp('2026-02-30 00:00:00'), null);
  assert.equal(C.timestamp('2026-02-30T00:00:00Z'), null);
  assert.equal(C.timestamp('2026-10-21T24:00:00+01:00'), null);
  assert.equal(C.timestamp('2026-10-21 24:00:00'), null);
  assert.equal(C.timestamp('2026-10-21'), null);
});
test('newest cloud timestamp, missing endpoint times, future clocks, offline and elapsed age are distinct', () => {
  const raw = fixture(); delete raw.battery.time;
  raw.grid.time = new Date(NOW - 60000).toISOString();
  let r = C.normalize(raw, PREF, NOW); assert.equal(r.sourceAt, NOW - 60000); assert.equal(r.timestampCoverageIncomplete, true); assert.equal(C.status(r, NOW), 'CLOUD SNAPSHOT');
  assert.equal(C.status(r, NOW + C.STALE_MS + 1), 'STALE');
  raw.battery.time = new Date(NOW + 3600000).toISOString();
  r = C.normalize(raw, PREF, NOW); assert.equal(C.status(r, NOW), 'STALE · CLOCK MISMATCH');
  raw.detail.status = 0; r = C.normalize(raw, PREF, NOW); assert.equal(C.status(r, NOW), 'INVERTER OFFLINE');
  assert.equal(r.gridAvailability, 'voltage present'); // Inverter offline != grid outage.
});
test('household vs EPS and yesterday daily production are handled honestly', () => {
  const raw = fixture(); raw.flow.existsThreeLoad = true; raw.flow.homeLoadPower = 1800;
  const r = C.normalize(raw, PREF, NOW);
  assert.equal(r.loadLabel, 'Household'); assert.equal(r.loadPower, 1800);
  delete raw.flow.homeLoadPower;
  const fallback = C.normalize(raw, PREF, NOW);
  assert.equal(fallback.loadLabel, 'Load / EPS'); assert.equal(fallback.loadPower, 1600);
  assert.equal(C.todayValue(r, NOW + 86400000, 60), null);
});
test('load endpoint is read for an explicit output-voltage candidate even when flow has power', async () => {
  const calls = [], raw = fixture(); delete raw.flow.loadVoltage;
  const api = client(async req => {
    calls.push(req.path);
    const data = req.path.endsWith('/flow') ? raw.flow : req.path.endsWith('/realtime/input') ? raw.pv :
      req.path.includes('/battery/') ? raw.battery : req.path.includes('/grid/') ? raw.grid :
      req.path.includes('/load/') ? { time: stamp, voltage: 227, pac: 1600 } : raw.detail;
    return ok(data);
  }, { token });
  const result = await api.readings(SELECT);
  assert.ok(calls.includes('/api/v1/inverter/load/fixture-inverter/realtime'));
  const reading = C.normalize(result.raw, PREF, NOW);
  assert.equal(reading.loadPower, 1600); assert.equal(reading.loadVoltage, 227);
});
test('read-only allowlist rejects settings, arbitrary hosts, real-time triggers and every other write', () => {
  for (const [method, path] of [['POST','/api/v1/common/setting/S/set'], ['GET','/api/v1/inverter/S/shutdown'],
    ['GET','/api/v1/inverter/S/realTimeUpdateByInv'], ['GET','https://evil.invalid/'], ['DELETE','/api/v1/inverter/S']]) assert.equal(C.allowed(method,path), false);
});
test('login uses live Inteless envelope/signature and retains returned expiry', async () => {
  const calls=[];
  const api=client(async req => { calls.push(req); return req.path === '/anonymous/publicKey' ? ok('K'.repeat(200)) : ok({ access_token:'FIXTURE-NEW', refresh_token:'FIXTURE-ROTATED', expires_in:'7200', token_type:'Bearer' }); }, { credentials:{username:'SYNTHETIC',password:'SYNTHETIC'} });
  const t=await api.authenticate(); assert.equal(t.expiresAt,NOW+7200000);
  assert.equal(calls[0].params.sign,K.md5(`nonce=${NOW}&source=elinterPOWER_VIEW`));
  assert.deepEqual(calls[1].body,{username:'SYNTHETIC',password:'FIXTURE-CIPHERTEXT',grant_type:'password',client_id:'csp-web',source:'elinter'});
});
test('cached valid token needs no login; expires_in missing is not fabricated', async () => {
  const api=client(async () => { throw new Error('should not call'); }, {token});
  assert.equal((await api.authenticate()).access,token.access);
  assert.equal(api.saveToken({access_token:'FIXTURE-UNKNOWN-EXPIRY'}).expiresAt,null);
  assert.throws(()=>api.saveToken({access_token:'FIXTURE',expires_in:0}), /auth/);
});
test('expired token refreshes and rotated refresh is preserved', async () => {
  const calls=[];
  const api=client(async req=>{calls.push(req);return ok({access_token:'FIXTURE-NEW',refresh_token:'FIXTURE-ROTATED',expires_in:3600});},{token:{...token,expiresAt:NOW-1}});
  await api.authenticate(); assert.equal(calls.length,1); assert.equal(calls[0].body.grant_type,'refresh_token');
  assert.equal(api.store.get('token').refresh,'FIXTURE-ROTATED');
});
test('refresh rejection falls back to credential login once', async () => {
  const calls=[];
  const api=client(async req=>{
    calls.push(req);
    if(req.body?.grant_type==='refresh_token')return {status:401,json:{code:401}};
    if(req.path==='/anonymous/publicKey')return ok('K'.repeat(200));
    return ok({access_token:'FIXTURE-NEW',expires_in:3600});
  },{token:{...token,expiresAt:0},credentials:{username:'SYNTHETIC',password:'SYNTHETIC'}});
  await api.authenticate(); assert.equal(calls.length,3);
});
test('401 on monitoring request recovers once; repeated rejection never loops', async () => {
  let gets=0,refreshes=0;
  const api=client(async req=>{
    if(req.method==='POST'){refreshes++;return ok({access_token:'FIXTURE-NEW',expires_in:3600});}
    gets++;return {status:401,json:{code:401}};
  },{token});
  await assert.rejects(()=>api.get('/api/v1/plants'), e=>e.kind==='auth');
  assert.equal(gets,2);assert.equal(refreshes,1);assert.equal(api.store.get('token'),undefined);
});
test('interactive verification/password change stops automatic attempts', async () => {
  for(const code of [113,114]){
    let count=0;const api=client(async()=>{count++;return{status:200,json:{code}};},{token:{...token,expiresAt:0}});
    await assert.rejects(()=>api.authenticate(),e=>e.kind==='interactive');assert.equal(count,1);
    await assert.rejects(()=>api.authenticate(),e=>e.kind==='interactive');assert.equal(count,1);
  }
});
test('rate limit honors Retry-After and persists across client instances', async () => {
  let calls=0;const api=client(async()=>{calls++;return{status:429,json:null,headers:{'Retry-After':'3600'}};},{token});
  await assert.rejects(()=>api.get('/api/v1/plants'),e=>e.kind==='rate'&&e.retryAt===NOW+3600000);
  await assert.rejects(()=>api.get('/api/v1/plants'),e=>e.kind==='rate'); assert.equal(calls,1);
  assert.equal(C.retryAt(new Date(NOW+7200000).toUTCString(),NOW),NOW+7200000);
});
test('network and malformed payloads have safe fixed errors', async () => {
  let api=client(async()=>{throw new Error('PRIVATE-SERVER-DETAIL');},{token});
  await assert.rejects(()=>api.get('/api/v1/plants'),e=>e.message==='network');
  api=client(async()=>({status:200,json:{data:{}}}),{token});
  await assert.rejects(()=>api.get('/api/v1/plants'),e=>e.kind==='protocol');
});
test('pagination includes all plants and rejects repeated pages', async () => {
  let api=client(async req=>ok({infos:Array.from({length:50},(_,i)=>({id:i+(req.params.page-1)*50})),total:100}),{token});
  assert.equal((await api.list('/api/v1/plants')).length,100);
  api=client(async()=>ok({infos:[{id:1}],total:2}),{token});
  await assert.rejects(()=>api.list('/api/v1/plants'),e=>e.kind==='pagination');
});
test('cache retains old source time on failure and backs off subsequent attempts', async () => {
  const entries=new Map(),failure=new Map();let reads=0;
  const cache={read:k=>entries.get(k),write:(k,v)=>entries.set(k,v),failure:k=>failure.get(k),recordFailure:(k,v)=>failure.set(k,v)};
  const good={readings:async()=>{reads++;return{raw:fixture(),failures:[]};}};
  const args={client:good,cache,selection:SELECT,preferences:PREF,now:NOW};
  const first=await C.refresh(args); assert.equal(first.error,null);
  await C.refresh({...args,now:NOW+1000});assert.equal(reads,1);
  const broken={readings:async()=>{reads++;throw new C.Fault('network');}};
  const failed=await C.refresh({...args,client:broken,now:NOW+C.POLL_MS+1});
  assert.equal(failed.reading.sourceAt,first.reading.sourceAt);assert.equal(failed.reading.fetchedAt,NOW);
  assert.equal(failed.cached,true);assert.equal(C.status(failed.reading,NOW,failed.error,failed.cached),'STALE · NETWORK');
  await C.refresh({...args,client:broken,now:NOW+C.POLL_MS+2});assert.equal(reads,2);
});
test('cache scope, corrupt data, empty responses, partial fetches and disk failure', async () => {
  const base={selection:SELECT,preferences:PREF,now:NOW};
  const good={readings:async()=>({raw:fixture(),failures:[]})};
  for(const previous of [{version:1,key:'wrong',reading:{}},{version:1,key:`${SELECT.plantId}:${SELECT.sn}`,reading:{fetchedAt:NOW}}]){
    const r=await C.refresh({...base,client:{readings:async()=>{throw new C.Fault('network');}},cache:{read:()=>previous}});
    assert.equal(r.reading,null);
  }
  const r=await C.refresh({...base,client:good,cache:{read:()=>null,write:()=>{throw new Error('disk');}}});
  assert.equal(r.error,'storage');assert.equal(r.reading.solarPower,2400);
  const partial=fixture();delete partial.battery;
  const result=await C.refresh({...base,client:{readings:async()=>({raw:partial,failures:['battery']})},cache:{read:()=>null,write:()=>{}}});
  assert.equal(result.error,'partial');
  assert.equal((await C.refresh({...base,client:{readings:async()=>({raw:{},failures:[]})},cache:{read:()=>null}})).error,'empty');
});
test('MD5 protocol helper matches independent native crypto including unicode and long input',()=>{
  for(const s of ['', 'abc', 'nonce=1792584000000&source=elinterPOWER_VIEW', '☀️é', 'a'.repeat(10000)])assert.equal(K.md5(s),crypto.createHash('md5').update(s).digest('hex'));
});
test('cloud errors retain only numeric status/code and data type for local diagnostics',async()=>{
  for(const data of [null,undefined,'SYNTHETIC SECRET',{access_token:'SYNTHETIC SECRET'},[]]){
    const api=new C.Client({store:{get:()=>null},transport:async()=>({status:200,json:{code:999,message:'SYNTHETIC SECRET',data}})});
    await assert.rejects(api.request('GET','/anonymous/publicKey'),error=>{
      assert.equal(error.kind,'protocol');assert.equal(error.http,200);assert.equal(error.code,999);
      assert.equal(error.dataType,data===null?'null':Array.isArray(data)?'array':typeof data);
      assert.ok(!JSON.stringify(error).includes('SYNTHETIC SECRET'));
      assert.equal(error.message,'protocol');return true;
    });
  }
});
test('valid cloud envelope remains usable when a Scriptable-like transport omits status metadata',async()=>{
  const api=new C.Client({store:{get:()=>null},transport:async()=>({status:0,json:{code:0,success:true,data:'SYNTHETIC-PUBLIC-KEY'}})});
  assert.equal(await api.request('GET','/anonymous/publicKey'),'SYNTHETIC-PUBLIC-KEY');
  const rejected=new C.Client({store:{get:()=>null},transport:async()=>({status:0,json:{code:0,success:true,data:null}})});
  await assert.rejects(rejected.request('GET','/anonymous/publicKey'),e=>e.kind==='protocol');
  const failedStatus=new C.Client({store:{get:()=>null},transport:async()=>({status:503,json:{code:0,success:true,data:'SYNTHETIC'}})});
  await assert.rejects(failedStatus.request('GET','/anonymous/publicKey'),e=>e.kind==='network'&&e.http===503);
});
for(const bits of [2048,4096])test(`RSA ${bits} encryption independently decodes via native crypto`,()=>{
  const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:bits});
  const key=publicKey.export({type:'spki',format:'pem'});
  for(const message of ['SYNTHETIC public encryption test', '☀️ café "</script>"']){
    const encrypted=K.rsaEncrypt(message,key,n=>Array.from(crypto.randomBytes(n)));
    const block=crypto.privateDecrypt({key:privateKey,padding:crypto.constants.RSA_NO_PADDING},Buffer.from(encrypted,'base64'));
    assert.equal(block[0],0);assert.equal(block[1],2);
    const end=block.indexOf(0,2);assert.ok(end>=10);assert.equal(block.subarray(end+1).toString(),message);
    assert.notEqual(encrypted,K.rsaEncrypt(message,key,n=>Array.from(crypto.randomBytes(n))));
  }
  assert.throws(()=>K.rsaEncrypt('test',key,n=>Array(n).fill(0)),/Secure random failed/);
  assert.throws(()=>K.rsaEncrypt('x'.repeat(bits/8),key,n=>Array.from(crypto.randomBytes(n))),/too long/);
});
test('RSA malformed public keys are rejected',()=>{
  for(const key of ['', 'not valid!', Buffer.from([48,128,1]).toString('base64')])assert.throws(()=>K.rsaEncrypt('test',key,n=>Array(n).fill(1)));
});
