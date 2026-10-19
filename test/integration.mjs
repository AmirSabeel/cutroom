import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runVideo } from '../lib/video.mjs';
import {toSrt,parseSrt} from '../lib/captions.mjs';
const root=path.resolve('data/integration-artifacts');await mkdir(root,{recursive:true});
const base=`http://127.0.0.1:${process.env.PORT || 4317}`;
const config=await (await fetch(base+'/api/config')).json();
assert.equal(config.ffmpegReady,true);
const headers={'Content-Type':'application/json','X-Cutroom-Token':config.token};
async function request(route,method='GET',body){const r=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
assert.equal((await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
assert.equal((await fetch(base+'/api/projects',{headers:{Origin:'https://untrusted.example'}})).status,403);
assert.equal((await request('/api/projects','POST',{name:'invalid.exe'})).status,400);
const bad=await request('/api/projects','POST',{name:'invalid.mp4'});
const badUpload=await fetch(base+`/api/projects/${bad.body.id}/video`,{method:'PUT',headers:{'X-Cutroom-Token':config.token},body:Buffer.from('not a video')});
assert.equal(badUpload.status,400);assert.equal((await request(`/api/projects/${bad.body.id}`)).body.status,'failed');
await request(`/api/projects/${bad.body.id}`,'DELETE');
console.log('Security, invalid extension, invalid media and cleanup checks passed.');
await runVideo(['-y','-f','lavfi','-i','testsrc2=size=640x360:rate=10:duration=96','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=96','-c:v','libx264','-preset','ultrafast','-crf','35','-threads','2','-c:a','aac','-shortest','source.mp4'],{cwd:root});
const segments=Array.from({length:8},(_,i)=>({start:i*12,end:(i+1)*12,text:`Synthetic pipeline test. Caption ${i+1} checks the local render, not AI transcription.`}));
const srt=toSrt(segments);await writeFile(path.join(root,'source.srt'),srt);
const project=(await request('/api/projects','POST',{name:'Pipeline test — synthetic.mp4'})).body;
await writeFile(path.join(root,'project-id.txt'),project.id);
const upload=await fetch(base+`/api/projects/${project.id}/video`,{method:'PUT',headers:{'Content-Type':'video/mp4','X-Cutroom-Token':config.token},body:await readFile(path.join(root,'source.mp4'))});
assert.equal(upload.status,200,await upload.text());
const malformed=await request(`/api/projects/${project.id}/process`,'POST',{mode:'srt',srt:'bad',length:30,crop:50});assert.equal(malformed.status,400);
const started=await request(`/api/projects/${project.id}/process`,'POST',{mode:'srt',srt,length:30,crop:50});assert.equal(started.status,202,JSON.stringify(started));
assert.equal((await request(`/api/projects/${project.id}/process`,'POST',{mode:'srt',srt,length:30,crop:50})).status,409);
assert.equal((await request(`/api/projects/${project.id}`,'DELETE')).status,409);
let p;const deadline=Date.now()+240000;let lastStage='';
while(Date.now()<deadline){p=(await request(`/api/projects/${project.id}`)).body;if(p.stage!==lastStage){console.log(p.stage);lastStage=p.stage;}if(['ready','failed'].includes(p.status))break;await new Promise(r=>setTimeout(r,1000));}
assert.equal(p.status,'ready',p.error);assert.equal(p.clips.length,3);assert.equal(p.selectionMode,'Transcript excerpts');
for(const c of p.clips){
 const file=await fetch(base+c.url+'?download');assert.equal(file.status,200);assert.match(file.headers.get('content-disposition'),/attachment/);const bytes=Buffer.from(await file.arrayBuffer());assert.ok(bytes.length>1000);await writeFile(path.join(root,`clip-${c.index}.mp4`),bytes);
 const log=await runVideo(['-i',path.join(root,`clip-${c.index}.mp4`)],{acceptFailure:true});assert.match(log,/720x1280/);assert.match(log,/Video: h264/);assert.match(log,/Audio: aac/);assert.match(log,/Duration: 00:00:24/);
 const captions=await (await fetch(base+c.captions)).text();const parsed=parseSrt(captions);assert.equal(parsed[0].start,0);assert.ok(parsed.at(-1).end<=c.end-c.start);
 const range=await fetch(base+c.url,{headers:{Range:'bytes=0-99'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);
 const suffix=await fetch(base+c.url,{headers:{Range:'bytes=-16'}});assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,16);
 const invalid=await fetch(base+c.url,{headers:{Range:'bytes=9999999999-'}});assert.equal(invalid.status,416);
}
assert.equal((await fetch(base+'/media/'+project.id+'/source.mp4')).status,404);
if(!config.aiReady){const blocked=(await request('/api/projects','POST',{name:'AI check.mp4'})).body;await request(`/api/projects/${blocked.id}`,'DELETE');}
console.log('PASS: real upload → 3 captioned vertical MP4s → downloads and byte ranges.');
console.log('Test project: '+project.id);

