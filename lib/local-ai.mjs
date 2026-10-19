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
