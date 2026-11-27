import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
const {replay,maxTicks,rulesVersion}=await import('./engine.mjs');
const {handleRequest}=await import('./worker.mjs');
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8').match(/<script id="game-script">([\s\S]*?)<\/script>/)[1];
const ctx=new Proxy({globalAlpha:1},{get:(a,k)=>k in a?a[k]:k==='createRadialGradient'||k==='createLinearGradient'?()=>({addColorStop(){}}):()=>{}});
class Element {
  constructor(){this.width=70;this.height=70;}
  addEventListener(){}
  append(){}
  removeAttribute(){}
  setAttribute(){}
  getContext(){return ctx;}
  focus(){}
  close(){this.open=false;}
  showModal(){this.open=true;}
}
const el=new Map();
const doc={getElementById:id=>{if(!el.has(id))el.set(id,new Element());return el.get(id);},createElement:()=>new Element(),querySelector:()=>new Element(),addEventListener(){}};
const frontend=new Function('document','window','localStorage','matchMedia','Image','requestAnimationFrame','setTimeout','clearTimeout','fetch',source+`
  return {
    start(seed){ dailySession={seed, actions:[], name:"联调"}; reset(); },
    aimAt(x){ aim=x; drop(); },
    state(){return {score, state, cooldown, roundTick, actions:dailySession.actions, shownLevel, nextLevel, balls, tickets}; },
    advance, revive, finish, removePiece, setRemovalMode
  };
`)(doc,{}, {getItem:()=>null,setItem(){}},()=>({matches:true}),class extends Element{constructor(){super();this.complete=true;this.naturalWidth=240;}},()=>{},()=>{},()=>{},async()=>({ok:true,json:async()=>({})}));
const db=new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
const env={HMAC_SECRET:'0123456789-test-secret-with-32-characters',ALLOW_ORIGINS:'https://game.test',DB:{prepare(sql){const query=db.prepare(sql);return{bind(...args){return {first:async()=>query.get(...args),all:async()=>({results:query.all(...args)}),run:async()=>query.run(...args)};}};}}};
const now=Date.UTC(2026,10,27,8);
async function call(path,body,at=now,origin='https://game.test'){
const response=await handleRequest(new Request('https://board.test'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','Origin':origin},body:body?JSON.stringify(body):undefined}),env,at);
return [response.status,await response.json()];
}
const [,seeded]=await call('/start',{rulesVersion});
const [,again]=await call('/start',{rulesVersion,player:seeded.player});
assert.equal(seeded.seed,again.seed);
assert.equal(seeded.player,again.player);
assert.equal(seeded.day,'2026-11-27');
assert.notEqual(seeded.run,again.run);

function play(seed, pattern) {
  frontend.start(seed);
  for(let i=0;i<maxTicks;i++){
    const snapshot=frontend.state();
    if(snapshot.state==='ended')return snapshot;
    if(snapshot.state==='revive'){
      if(pattern===1){frontend.revive();continue;}
      frontend.finish();continue;
    }
    if(pattern===1&&snapshot.tickets>0&&snapshot.balls.length>0&&i%30===0){
      frontend.setRemovalMode(true);
      frontend.removePiece(snapshot.balls[0]);
    }
    if(snapshot.cooldown===0 && i % 90 === 0) frontend.aimAt(pattern===1?25+((i*191)%385):220);
    frontend.advance();
  }
  return frontend.state();
}
const first=play(seeded.seed,0);
const second=play(again.seed,1);
assert(first.score>0&&second.score>0);
for(const [mode,round] of [first,second].entries()){
const t=performance.now();
const calculated=replay(seeded.seed,round.actions,round.roundTick);
const time=(performance.now()-t).toFixed(1);
assert.equal(calculated?.score,round.score);
console.log('round',mode+1,'ticks',round.roundTick,'actions',round.actions.length,'points',round.score,'local replay ms',time);
}
assert(second.actions.some(a=>a[1]==='t'));
assert(second.actions.some(a=>a[1]==='r'));
const send=(round,run,name,score=round.score)=>call('/submit',{run,name,score,tick:round.roundTick,actions:round.actions},now+500000);
assert.equal((await send(first,seeded.run,'香菜测试',first.score+1))[0],422);
assert.equal((await send(first,seeded.run+'x','香菜测试'))[0],409);
assert.equal((await send(first,seeded.run,'香菜测试'))[0],200);
assert.equal((await send(first,seeded.run,'香菜测试'))[0],200);
assert.equal((await send(second,again.run,'香菜测试'))[0],200);
let result=await call('/board');
assert.equal(result[1].entries.length,1);
assert.equal(result[1].entries[0].score,Math.max(first.score,second.score));
assert.equal((await call('/board',null,now+8*3600000))[1].day,'2026-11-28');
assert.equal((await call('/board',null,now+8*3600000))[1].entries.length,0);
assert.equal((await call('/board',null,now,'https://wrong.test'))[0],403);
console.log('PASS: deterministic frontend/server replay, tickets and revives, tamper rejection, idempotency, daily highest score, Beijing date rollover, and origin policy.');
