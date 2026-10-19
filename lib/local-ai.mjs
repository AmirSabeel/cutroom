import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const tool = name => fileURLToPath(new URL('../tools/'+name, import.meta.url));
const python = () => readFileSync(tool('local-python-path.txt'),'utf8').trim();
export function localReady() {
  try { return existsSync(python()) && existsSync(tool('local-ready')); } catch { return false; }
}
const workers = new Set();
export function stopLocalWorkers() { for(const child of workers) child.kill(); }
export function transcribeLocal(filename) {
  if(!localReady()) throw new Error('Free local subtitles are not installed yet.');
  return new Promise((resolve,reject) => {
    const child=spawn(python(),[tool('local-transcribe.py'),filename],{windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1'}});
    workers.add(child);
    let output='',errors='';
    const timer=setTimeout(()=>child.kill(),60*60*1000);
    child.stdout.on('data',data=>output+=data);
    child.stderr.on('data',data=>{errors=(errors+data).slice(-4000);});
    child.on('error',error=>{clearTimeout(timer);workers.delete(child);reject(error);});
    child.on('close',code=>{
      clearTimeout(timer);workers.delete(child);
      if(code!==0)return reject(new Error('Local transcription failed: '+errors));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Local transcription returned invalid output.')); }
    });
  });
}

export function downloadYoutube(url, destination) {
  if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) throw new Error('Paste a valid YouTube URL.');
  return new Promise((resolve,reject) => {
    const child=spawn(python(),['-m','yt_dlp','--no-playlist','--format','best[ext=mp4][height<=720]/best[ext=mp4]/best','--max-filesize','500M','--merge-output-format','mp4','--output',destination,url],{windowsHide:true,env:{...process.env,PYTHONPATH:String(root/'local-packages')}});
    workers.add(child);let errors='';child.stderr.on('data',d=>errors=(errors+d).slice(-4000));
    child.on('error',e=>{workers.delete(child);reject(new Error('YouTube downloader is not installed. Run tools/setup-local.py first.'));});
    child.on('close',code=>{workers.delete(child);if(code!==0)reject(new Error(errors||'YouTube download failed. Check the link and try again.'));else resolve(destination);});
  });
}
