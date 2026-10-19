import { localReady, transcribeLocal, downloadYoutube, stopLocalWorkers } from './lib/local-ai.mjs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { readFile, writeFile, stat, rm, open, copyFile, mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { normalizeCaptionStyle, parseSrt, validateSegments, chooseExcerpts, chooseSmartMoments, validateClips, clipCaptions, toSrt, toAss } from './lib/captions.mjs';
import { runVideo, inspectVideo, renderClip, stopVideoWorkers } from './lib/video.mjs';
import { transcribe, selectClips } from './lib/ai.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const dataRoot = path.resolve(process.env.CUTROOM_DATA_DIR || path.join(root, 'data'));
const port = Number(process.env.PORT || 4317);
const key = process.env.OPENAI_API_KEY?.trim();
const token = randomBytes(32).toString('hex');
const MAX_BYTES = 500 * 1024 * 1024;
mkdirSync(dataRoot, {recursive:true});
const projects = new Map();
const queue = [];
const rebuilding = new Set();
let working = false;
let ffmpegReady = false;
const activeStates = new Set(['queued','extracting','transcribing','selecting','rendering']);
const directory = id => path.join(dataRoot, id);

function save(project, changes = {}) {
  Object.assign(project, changes, {updatedAt:new Date().toISOString()});
  const folder = directory(project.id);
  mkdirSync(folder, {recursive:true});
  writeFileSync(path.join(folder, 'project.json.tmp'), JSON.stringify(project, null, 2));
  renameSync(path.join(folder, 'project.json.tmp'), path.join(folder, 'project.json'));
}
for (const id of readdirSync(dataRoot)) {
  if (!/^[0-9a-f-]{36}$/.test(id)) continue;
  try {
    const p = JSON.parse(readFileSync(path.join(directory(id), 'project.json'), 'utf8'));
    if (p.id !== id) continue;
    projects.set(id, p);
    if (activeStates.has(p.status) || p.status === 'uploading') save(p, {status:'failed', error:'Processing was interrupted by a server restart. Retry to continue.', progress:0});
  } catch { /* Ignore incomplete metadata, never expose arbitrary directories. */ }
}

function publicProject(p) {
  const {options, ...safe} = p;
  return {...safe, captionStyle:normalizeCaptionStyle(options?.captionStyle), canRetry:Boolean(options && p.uploaded), clips:(p.clips || []).map(c=>({...c, url:`/media/${p.id}/clip-${c.index}.mp4`, poster:`/media/${p.id}/clip-${c.index}.jpg`, captions:`/media/${p.id}/clip-${c.index}.srt`}))};
}
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function json(res, status, body) { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); }
async function body(req) {
  const chunks=[]; let size=0;
  for await(const chunk of req) { size+=chunk.length; if(size>1024*1024) fail(413,'This request is too large.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400,'Please send valid JSON.'); }
}

async function processProject(p) {
  const folder = directory(p.id), options = p.options;
  try {
    let segments;
    const transcriptFile = path.join(folder, 'transcript.json');
    if (existsSync(transcriptFile)) segments = JSON.parse(await readFile(transcriptFile,'utf8'));
    else if (options.mode === 'srt') segments = parseSrt(options.srt);
    else {
      if (options.mode !== 'local' && !key) throw new Error('AI is not connected. Restart with an OpenAI API key, or create a project with your own English SRT subtitles.');
      if (!p.hasAudio) throw new Error('This video has no audio. Use a video with English speech or supply an SRT file.');
      save(p,{status:'extracting',stage:'Preparing audio',progress:15});
      await runVideo(['-y','-protocol_whitelist','file,pipe','-f','mov','-i','source.mp4','-vn','-ac','1','-ar','16000','-c:a','libmp3lame','-b:a','48k','audio.mp3'],{cwd:folder});
      save(p,{status:'transcribing',stage:'Transcribing English speech',progress:28});
      segments = options.mode === 'local' ? await transcribeLocal(path.join(folder,'audio.mp3')) : await transcribe(path.join(folder,'audio.mp3'),key);
    }
    segments = validateSegments(segments,p.duration);
    await writeFile(transcriptFile,JSON.stringify(segments));
    save(p,{status:'selecting',stage:options.mode==='ai'?'Finding complete moments':'Selecting transcript excerpts',progress:42});
    let selected;
    const planFile=path.join(folder,'selection.json');
    if (existsSync(planFile)) selected=JSON.parse(await readFile(planFile,'utf8'));
    else selected=options.mode==='ai' ? await selectClips(segments,p.duration,options.length,key) : options.mode==='local' ? chooseSmartMoments(segments,p.duration,options.length) : chooseExcerpts(segments,p.duration,options.length);
    selected=validateClips(selected,p.duration);
    await writeFile(planFile,JSON.stringify(selected));
    save(p,{clips:[],selectionMode:options.mode==='ai'?'AI-selected':options.mode==='local'?'Offline smart moments':'Transcript excerpts'});
    for(let i=0;i<selected.length;i++) {
      const clip={...selected[i],index:i+1};
      save(p,{status:'rendering',stage:`Rendering clip ${i+1} of ${selected.length}`,progress:50+Math.round(i/selected.length*45)});
      const captions=clipCaptions(segments,clip.start,clip.end);
      await writeFile(path.join(folder,`clip-${clip.index}.srt`),toSrt(captions));
      await writeFile(path.join(folder,`clip-${clip.index}.ass`),toAss(captions,options.captionStyle));
      await renderClip(folder,clip,options.crop);
      save(p,{clips:[...p.clips,clip]});
    }
    save(p,{status:'ready',stage:'Clips ready',progress:100,error:null});
  } catch(e) {
    await writeFile(path.join(folder,'last-error.log'), e.detail || String(e.message)).catch(()=>{});
    save(p,{status:'failed',stage:'Needs attention',error:e.name==='TimeoutError'?'The AI request timed out. Retry the project.':e.message,progress:0});
  }
}
async function drain() {
  if(working) return;
  working=true;
  try { while(queue.length) { const p=projects.get(queue.shift()); if(p) await processProject(p); } }
  finally { working=false; }
}
function enqueue(p) { save(p,{status:'queued',stage:'Waiting for video worker',progress:5,error:null}); queue.push(p.id); void drain(); }

const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mp4':'video/mp4','.jpg':'image/jpeg','.srt':'application/x-subrip'};
async function serveFile(req,res,filename,download=false) {
  const info=await stat(filename).catch(()=>null);
  if(!info?.isFile()) fail(404,'File not found.');
  const headers={'Content-Type':types[path.extname(filename)] || 'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-store'};
  if(download) headers['Content-Disposition']=`attachment; filename="${path.basename(filename)}"`;
  let start=0,end=info.size-1,status=200;
  if(req.headers.range) {
    const m=req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
    if(!m || (!m[1]&&!m[2])) {res.writeHead(416,{'Content-Range':`bytes */${info.size}`});return res.end();}
    if(!m[1]) start=Math.max(0,info.size-Number(m[2]));
    else {start=Number(m[1]);if(m[2])end=Math.min(Number(m[2]),end);}
    if(start>end || start>=info.size || !Number.isSafeInteger(start)) {res.writeHead(416,{'Content-Range':`bytes */${info.size}`});return res.end();}
    status=206;headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
  }
  headers['Content-Length']=end-start+1;
  res.writeHead(status,headers);
  if(req.method==='HEAD') return res.end();
  await pipeline(createReadStream(filename,{start,end}),res);
}

const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)) fail(403,'Use the local Cutroom address.');
    if(req.headers.origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin)) fail(403,'Cross-origin access is not allowed.');
    if(!['GET','HEAD'].includes(req.method) && req.headers['x-cutroom-token']!==token) fail(403,'Refresh the page before trying again.');
    const url=new URL(req.url,`http://127.0.0.1:${port}`), route=url.pathname;
    if(req.method==='GET'&&route==='/api/health') return json(res,200,{application:'cutroom',aiReady:Boolean(key),localReady:localReady(),ffmpegReady});
    if(req.method==='GET'&&route==='/api/config') return json(res,200,{application:'cutroom',token,aiReady:Boolean(key),localReady:localReady(),ffmpegReady,maxBytes:MAX_BYTES,maxDuration:600,language:'English',localOnly:true});
    if(req.method==='POST'&&route==='/api/shutdown') {
      json(res,200,{stopping:true});
      server.close();
      stopVideoWorkers();
      stopLocalWorkers();
      setTimeout(()=>process.exit(0),250);
      return;
    }
    if(req.method==='GET'&&route==='/api/projects') return json(res,200,[...projects.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(publicProject));
    if(req.method==='POST'&&route==='/api/projects') {
      const input=await body(req);
      if(projects.size>=50) fail(400,'This local version supports 50 projects. Delete an old project to free space.');
      if(!String(input.name || '').toLowerCase().endsWith('.mp4')) fail(400,'Please choose an MP4 file.');
      const p={id:randomUUID(),name:String(input.name).replace(/[\x00-\x1f]/g,'').slice(0,180),createdAt:new Date().toISOString(),status:'draft',stage:'Waiting for upload',progress:0,uploaded:false,clips:[]};
      projects.set(p.id,p);save(p);return json(res,201,publicProject(p));
    }
    const youtubeCreate=route.match(/^\/api\/projects\/([0-9a-f-]{36})\/youtube$/);
    if(req.method==='POST'&&youtubeCreate) {
      const p=projects.get(youtubeCreate[1]);if(!p)fail(404,'Project not found.');
      if(p.uploaded)fail(409,'This project already has a video.');
      const input=await body(req);const url=String(input.url||'').trim();
      save(p,{status:'uploading',stage:'Downloading YouTube video',sourceUrl:url});
      try { await downloadYoutube(url,path.join(directory(p.id),'source.mp4')); const info=await inspectVideo(path.join(directory(p.id),'source.mp4')); save(p,{...info,name:String(input.name||'YouTube video').slice(0,180),uploaded:true,status:'uploaded',stage:'Ready to create clips',progress:0,error:null}); return json(res,200,publicProject(p)); }
      catch(e){await rm(path.join(directory(p.id),'source.mp4'),{force:true});save(p,{status:'failed',error:e.message,progress:0});throw Object.assign(e,{status:400});}
    }
    const match=route.match(/^\/api\/projects\/([0-9a-f-]{36})(?:\/(video|process|retry|retranscribe|restyle))?$/);
    if(match) {
      const p=projects.get(match[1]);if(!p)fail(404,'Project not found.');
      const action=match[2];
      if(rebuilding.has(p.id)&&req.method!=='GET')fail(409,'This project is preparing new subtitles.');
      if(req.method==='POST'&&action==='restyle') {
        if(p.status!=='ready'||!p.options)fail(409,'Wait until your clips are ready to change their style.');
        const input=await body(req);
        const captionStyle=normalizeCaptionStyle(input.captionStyle);
        if(p.status!=='ready')fail(409,'This project is already processing.');
        if(!existsSync(path.join(directory(p.id),'transcript.json'))||!existsSync(path.join(directory(p.id),'selection.json')))fail(400,'Saved captions are missing. Recreate the subtitles first.');
        save(p,{options:{...p.options,captionStyle}});
        enqueue(p);return json(res,202,publicProject(p));
      }
      if(req.method==='POST'&&action==='retranscribe') {
        if(!['ready','failed'].includes(p.status)||!p.uploaded||!p.options)fail(409,'Wait for processing to finish first.');
        if(!localReady())fail(400,'Free local subtitles are not installed.');
        if(!p.hasAudio)fail(400,'This video has no audio.');
        rebuilding.add(p.id);
        try {
        const folder=directory(p.id);
        const backup=path.join(folder,'previous-'+Date.now());
        await mkdir(backup,{recursive:true});
        for(const name of readdirSync(folder)) {
          if(/^(transcript\.json|selection\.json|project\.json|clip-[1-3]\.(mp4|jpg|srt|ass))$/.test(name)) await copyFile(path.join(folder,name),path.join(backup,name));
        }
        await rm(path.join(folder,'transcript.json'),{force:true});
        await rm(path.join(folder,'selection.json'),{force:true});
        save(p,{options:{...p.options,mode:'local',srt:undefined}});
        enqueue(p);return json(res,202,publicProject(p));
        } finally { rebuilding.delete(p.id); }
      }
      if(req.method==='GET'&&!action)return json(res,200,publicProject(p));
      if(req.method==='DELETE'&&!action) {
        if(activeStates.has(p.status)||p.status==='uploading')fail(409,'Wait for processing or upload to finish before deleting.');
        await rm(directory(p.id),{recursive:true,force:true});projects.delete(p.id);return json(res,200,{deleted:true});
      }
      if(req.method==='PUT'&&action==='video') {
        if(p.uploaded||activeStates.has(p.status)||p.status==='uploading')fail(409,'This project already has a video or an upload in progress.');
        if(!ffmpegReady)fail(503,'Video processing is unavailable. Install FFmpeg first.');
        const length=Number(req.headers['content-length']);if(!Number.isFinite(length)||length<=0||length>MAX_BYTES)fail(413,'Choose an MP4 smaller than 500 MB.');
        const temp=path.join(directory(p.id),'upload.part');save(p,{status:'uploading',stage:'Uploading video'});
        try {
          let received=0;
          await pipeline(req,new Transform({transform(chunk,enc,cb){received+=chunk.length;cb(received>MAX_BYTES?new Error('Video exceeds 500 MB.'):null,chunk);}}),createWriteStream(temp));
          const handle=await open(temp,'r');let header;
          try {header=Buffer.alloc(12);await handle.read(header,0,12,0);}finally{await handle.close();}
          if(header.toString('ascii',4,8)!=='ftyp')throw new Error('This file is not an MP4. Export it as MP4 and try again.');
          const info=await inspectVideo(temp);
          renameSync(temp,path.join(directory(p.id),'source.mp4'));
          save(p,{...info,uploaded:true,status:'uploaded',stage:'Ready to create clips',progress:0,error:null});
        }catch(e){await rm(temp,{force:true}).catch(()=>{});save(p,{status:'failed',error:e.message});throw Object.assign(e,{status:400});}
        return json(res,200,publicProject(p));
      }
      if(req.method==='POST'&&action==='process') {
        if(!p.uploaded)fail(400,'Upload a video first.');
        if(activeStates.has(p.status))fail(409,'This project is already processing.');
        if(p.options)fail(409,'This project was already started. Use Retry or create a new project.');
        const input=await body(req);
        if(!['ai','local','srt'].includes(input.mode))fail(400,'Choose AI or supplied subtitles.');
        if(input.mode==='ai'&&!key)fail(400,'Connect an OpenAI API key first, or use an English SRT file.');
        if(input.mode==='local'&&!localReady())fail(400,'Free local subtitles are not installed.');
        if(input.mode!=='srt'&&!p.hasAudio)fail(400,'No audio was found. Choose a video with English speech.');
        const length=Number(input.length),crop=Number(input.crop);
        if(![30,45,60].includes(length)||!Number.isFinite(crop)||crop<0||crop>100)fail(400,'Invalid clip length or crop position.');
        if(input.mode==='srt')validateSegments(parseSrt(input.srt || ''),p.duration);
        save(p,{options:{mode:input.mode,length:input.mode==='local'?30:length,crop,captionStyle:normalizeCaptionStyle(input.captionStyle),srt:input.mode==='srt'?String(input.srt):undefined}});
        enqueue(p);return json(res,202,publicProject(p));
      }
      if(req.method==='POST'&&action==='retry') {
        if(p.status!=='failed'||!p.options||!p.uploaded)fail(409,'This project cannot be retried. Start a new upload.');
        const input=await body(req);
        if(input.mode==='local') {
          if(!localReady())fail(400,'Free local subtitles are not installed.');
          if(!p.hasAudio)fail(400,'This video has no audio.');
          await rm(path.join(directory(p.id),'selection.json'),{force:true});
          save(p,{options:{...p.options,mode:'local',srt:undefined}});
        }
        if(p.options.mode==='ai'&&!key)fail(400,'Connect AI before retrying.');
        enqueue(p);return json(res,202,publicProject(p));
      }
    }
    const media=route.match(/^\/media\/([0-9a-f-]{36})\/(clip-[1-3]\.(?:mp4|jpg|srt))$/);
    if(['GET','HEAD'].includes(req.method)&&media) {
      const p=projects.get(media[1]);if(!p||p.status!=='ready')fail(404,'Clips are not ready.');
      return await serveFile(req,res,path.join(directory(p.id),media[2]),url.searchParams.has('download'));
    }
    if(['GET','HEAD'].includes(req.method)&&['/','/app.js','/style.css'].includes(route))return await serveFile(req,res,path.join(root,'public',route==='/'?'index.html':route.slice(1)));
    fail(404,'Not found.');
  }catch(e){if(!res.headersSent&&!res.destroyed)json(res,e.status||400,{error:e.message||'Something went wrong.'});else if(!res.destroyed)res.end();}
});
server.requestTimeout=15*60*1000;
server.headersTimeout=30000;
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Open the running app or stop it before restarting.` : `Cannot start Cutroom: ${error.message}`);
  process.exitCode = 1;
});
try { const filters=await runVideo(['-filters'],{timeout:10000});ffmpegReady=filters.includes(' ass '); } catch {}
server.listen(port,'127.0.0.1',()=>{
  const pidFile=path.join(dataRoot,'server.pid');
  writeFileSync(pidFile,String(process.pid));
  process.on('exit',()=>{try{if(readFileSync(pidFile,'utf8')===String(process.pid))unlinkSync(pidFile);}catch{}});
  console.log(`Cutroom ready: http://127.0.0.1:${port}\nVideo processing: ${ffmpegReady?'ready':'missing'} | AI: ${key?'configured':'not connected'}`);
});
