import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
process.env.PORT='4329';
process.env.CUTROOM_DATA_DIR=path.resolve('data','local-test-'+randomUUID());
delete process.env.OPENAI_API_KEY;
await import('../server.mjs');
try {
 const base='http://127.0.0.1:4329';
 const config=await (await fetch(base+'/api/config')).json();
 assert.equal(config.localReady,true);
 const headers={'Content-Type':'application/json','X-Cutroom-Token':config.token};
 const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers,body:JSON.stringify(data)});const b=await r.json();assert.ok(r.ok,JSON.stringify(b));return b;};
 const p=await post('/api/projects',{name:'Local transcription test.mp4'});
 const uploaded=await fetch(base+`/api/projects/${p.id}/video`,{method:'PUT',headers,body:await readFile(process.argv[2])});
 assert.equal(uploaded.status,200);
 await post(`/api/projects/${p.id}/process`,{mode:'local',length:30,crop:50});
 const deadline=Date.now()+600000;
 let result,stage='';
 while(Date.now()<deadline){
  result=await (await fetch(base+`/api/projects/${p.id}`)).json();
  if(result.stage!==stage){stage=result.stage;console.log(stage);}
  if(['ready','failed'].includes(result.status))break;
  await new Promise(r=>setTimeout(r,1000));
 }
 assert.equal(result.status,'ready',result.error);
 assert.ok(result.clips.length>0);
 for(const c of result.clips){
  assert.equal((await fetch(base+c.url)).status,200);
  assert.match(await (await fetch(base+c.captions)).text(),/-->/);
 }
 console.log('PASS: offline transcription, excerpt selection, captioned clips and downloads.');
 process.exit(0);
}catch(error){console.error(error);process.exit(1);}
