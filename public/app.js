let newCaptionStyle={font:'Arial',color:'#FFFFFF',size:42,position:'bottom'}, captionProject=null;
const $ = selector => document.querySelector(selector);
let config, projects=[], selectedFile=null, currentUpload=null, busy=false, detailSignature='', online=false;
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duration = value => `${Math.floor((value||0)/60)}:${String(Math.floor((value||0)%60)).padStart(2,'0')}`;
const labels = {draft:'Not uploaded',uploading:'Uploading',uploaded:'Ready to start',queued:'Queued',extracting:'Preparing audio',transcribing:'Transcribing',selecting:'Finding moments',rendering:'Rendering',ready:'Ready',failed:'Needs attention'};

async function api(url,options={}) {
  const response=await fetch(url,{signal:AbortSignal.timeout(10000),...options,headers:{'Content-Type':'application/json','X-Cutroom-Token':config?.token||'',...options.headers}});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error || 'The request failed.');
  return result;
}
function toast(message) {$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>{$('#toast').hidden=true;},5000);}
function formError(message) {$('#form-error').textContent=message;$('#form-error').hidden=!message;}
function navigate(hash) {if(location.hash===hash)renderRoute();else location.hash=hash;}
function setFile(file) {
  if(!file)return;
  if(busy)return;
  if(!file.name.toLowerCase().endsWith('.mp4'))return formError('Choose a video in MP4 format.');
  if(file.size>500*1024*1024)return formError('Please choose an MP4 smaller than 500 MB.');
  selectedFile=file;currentUpload=null;
  $('#file-label').textContent=file.name;$('#file-detail').textContent=`${(file.size/1024/1024).toFixed(1)} MB · Ready to upload`;
  formError('');
}
function updateMode() {
  const mode=$('#processing-mode').value;
  $('#srt-field').hidden=mode!=='srt';
  $('#mode-hint').textContent=mode==='local'?'Free speech recognition on this computer. No API charges. Clips use transcript excerpts, without AI moment ranking.':mode==='srt'?'Creates transcript-aligned excerpts locally. AI moment selection is not used.':config?.aiReady?'Audio and transcript are sent to OpenAI. Your API account is billed for usage.':'AI is not connected yet. Open Setup & help to connect it, or use your own SRT subtitles.';
  $('#generate').disabled=busy||!online||!config?.ffmpegReady||(mode==='ai'&&!config?.aiReady)||(mode==='local'&&!config?.localReady);
}
function empty() {return '<div class="empty-state"><span class="empty-icon">▤</span><div><strong>Your next great clip starts here</strong><p>Upload your first video. Your projects will appear here.</p></div></div>';}
function projectRows(items) {
  if(!items.length)return empty();
  return items.map(p=>`<button class="project-row" data-project="${p.id}"><span class="project-symbol">▷</span><span class="project-info"><strong>${esc(p.name)}</strong><small>${new Date(p.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})} · ${p.duration?duration(p.duration)+' · ':''}${p.clips.length} clips · English</small></span><span class="badge ${p.status}">${labels[p.status]||esc(p.status)}</span><span>↗</span></button>`).join('');
}
function renderLists() {
  $('#recent-projects').innerHTML=projectRows(projects.slice(0,3));
  $('#all-projects').innerHTML=projectRows(projects);
  $('#project-count').textContent=projects.length;
}
function renderRoute() {
  const hash=location.hash||'#create';
  const projectId=hash.startsWith('#project/')?hash.slice(9):null;
  const isProjects=hash==='#projects'||Boolean(projectId);
  $('#create-view').hidden=isProjects;$('#projects-view').hidden=hash!=='#projects';$('#detail-view').hidden=!projectId;
  $('#nav-create').classList.toggle('active',!isProjects);$('#nav-projects').classList.toggle('active',isProjects);
  $('#breadcrumb').textContent=projectId?'Project':isProjects?'My projects':'Create clips';
  if(projectId)renderDetail(projectId);
}
function renderDetail(id) {
  const p=projects.find(p=>p.id===id);
  if(!p){$('#project-detail').innerHTML='<div class="processing-card"><h2>Project not found</h2><p>Return to My projects to choose an upload.</p></div>';return;}
  const signature=JSON.stringify(p);
  if(detailSignature===signature&&$('#project-detail').dataset.id===id)return;
  detailSignature=signature;$('#project-detail').dataset.id=id;
  const removable=['ready','failed','uploaded','draft'].includes(p.status);
  let html=`<div class="detail-heading"><div><p class="eyebrow">${p.status==='ready'?'READY FOR YOUR NEXT POST':'YOUR VIDEO PROJECT'}</p><h1>${esc(p.name)}</h1><p>${p.duration?duration(p.duration)+' source · ':''}English · Vertical 9:16${p.selectionMode?' · '+esc(p.selectionMode):''}</p></div>${removable?`<button class="secondary danger" data-delete="${p.id}">Delete project</button>`:''}</div>`;
  if(['ready','failed'].includes(p.status)&&p.canRetry&&config?.localReady)html+=`<p><button class="secondary" data-retranscribe="${p.id}">Recreate with improved subtitles (free)</button></p>`;
  if(p.status==='ready') {
    html+=`<p><button class="secondary" data-caption-style="${p.id}">Change caption style</button></p>`;
    html+=`<div class="section-title"><h2>${p.clips.length} clips, ready to review</h2><span class="badge ready">720 × 1280 · Captions included</span></div><div class="clips-grid">`+p.clips.map(c=>`<article class="clip-card"><video controls playsinline preload="metadata" poster="${c.poster}" src="${c.url}"></video><div class="clip-body"><div class="clip-meta"><span>CLIP ${String(c.index).padStart(2,'0')}</span><span>${duration(c.end-c.start)} · ${duration(c.start)}–${duration(c.end)}</span></div><h3>${esc(c.title)}</h3><p>${esc(c.reason)}</p><a class="primary download" href="${c.url}?download" download>Download MP4 ↓</a><a class="srt-link" href="${c.captions}?download" download>Download subtitles (.srt)</a></div></article>`).join('')+'</div>';
  } else if(p.status==='failed') {
    html+=`<div class="processing-card"><h2>This project needs attention</h2><p class="error">${esc(p.error||'Processing could not finish.')}</p>${p.canRetry?`<button class="primary" data-retry="${p.id}">Retry processing</button>${config?.localReady?` <button class="secondary" data-local-retry="${p.id}">Use free local subtitles</button>`:""}`:p.uploaded?`<button class="primary" data-resume="${p.id}">Finish clip setup</button>`:'<p>Return to Create clips and choose a valid MP4 to try again.</p>'}<p>Completed transcription and selection are reused when available.</p></div>`;
  } else if(['uploaded','draft'].includes(p.status)) {
    html+=`<div class="processing-card"><h2>${p.uploaded?'Your video is uploaded':'Waiting for your video'}</h2><p>${p.uploaded?'Choose how to create your clips to continue.':'Return to Create clips to upload a video.'}</p>${p.uploaded?`<button class="primary" data-resume="${p.id}">Finish clip setup</button>`:''}</div>`;
  } else html+=`<div class="processing-card" aria-live="polite"><span class="pill">IN THE CUTTING ROOM</span><h2>${esc(p.stage||labels[p.status])}</h2><progress max="100" value="${p.progress||0}" aria-label="Processing progress"></progress><p>Your clips are processing in the background. You can leave this page; keep the local server running.</p><span class="badge">${labels[p.status]}</span></div>`;
  $('#project-detail').innerHTML=html;
}

function uploadVideo(id,file) {
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('PUT',`/api/projects/${id}/video`);xhr.setRequestHeader('X-Cutroom-Token',config.token);xhr.setRequestHeader('Content-Type','video/mp4');xhr.timeout=15*60*1000;
    xhr.upload.onprogress=e=>{if(e.lengthComputable){const pc=Math.round(e.loaded/e.total*100);$('#upload-progress').value=pc;$('#upload-message').textContent=pc===100?'Checking video…':`Uploading video · ${pc}%`;}};
    xhr.onload=()=>{try{const result=JSON.parse(xhr.responseText);if(xhr.status>=200&&xhr.status<300)resolve(result);else reject(new Error(result.error));}catch{reject(new Error('Upload failed. Please try again.'));}};
    xhr.onerror=()=>reject(new Error('Connection lost during upload. Check that the local server is running.'));
    xhr.ontimeout=()=>reject(new Error('Upload timed out. Try a smaller video.'));
    xhr.send(file);
  });
}
$('#generate').addEventListener('click',async()=>{
  if(busy)return;
  formError('');
  if(!selectedFile&&!currentUpload?.uploaded)return formError('Choose an English MP4 video first.');
  const mode=$('#processing-mode').value;
  let srt='';
  if(mode==='srt') {
    const file=$('#srt-file').files[0];
    if(!file)return formError('Choose the matching English SRT subtitle file.');
    if(file.size>750000)return formError('The subtitle file is too large. Use an SRT smaller than 750 KB.');
    srt=await file.text();
    if(!srt.includes('-->'))return formError('This does not look like an SRT subtitle file.');
  }
  busy=true;updateMode();$('#video-file').disabled=true;$('#generate').textContent='Preparing your video…';
  try {
    if(!currentUpload?.uploaded){
      currentUpload=await api('/api/projects',{method:'POST',body:JSON.stringify({name:selectedFile.name})});
      $('#upload-status').hidden=false;$('#upload-progress').value=0;
      currentUpload=await uploadVideo(currentUpload.id,selectedFile);
    }
    const p=await api(`/api/projects/${currentUpload.id}/process`,{method:'POST',body:JSON.stringify({mode,srt,captionStyle:newCaptionStyle,length:Number($('#clip-length').value),crop:Number($('#crop-position').value)})});
    projects=await api('/api/projects');renderLists();navigate(`#project/${p.id}`);
    currentUpload=null;selectedFile=null;$('#video-file').value='';$('#file-label').textContent='Drop your video here';$('#file-detail').innerHTML='or <u>browse files</u> on your computer';
  }catch(e){formError(e.message);}finally{busy=false;$('#video-file').disabled=false;$('#upload-status').hidden=true;$('#generate').innerHTML='Create my clips <span>↗</span>';updateMode();}
});
document.addEventListener('click',async e=>{
  const styleButton=e.target.closest('[data-caption-style]');if(styleButton){openCaptionEditor(styleButton.dataset.captionStyle);return;}
  const row=e.target.closest('[data-project]');if(row){detailSignature='';navigate(`#project/${row.dataset.project}`);return;}
  const localRetry=e.target.closest('[data-local-retry]');
  if(localRetry){localRetry.disabled=true;try{await api(`/api/projects/${localRetry.dataset.localRetry}/retry`,{method:'POST',body:JSON.stringify({mode:'local'})});await refresh();}catch(err){toast(err.message);localRetry.disabled=false;}return;}
  const rebuild=e.target.closest('[data-retranscribe]');
  if(rebuild){rebuild.disabled=true;try{await api(`/api/projects/${rebuild.dataset.retranscribe}/retranscribe`,{method:'POST',body:'{}'});await refresh();}catch(err){toast(err.message);rebuild.disabled=false;}return;}
  const retry=e.target.closest('[data-retry]');
  if(retry){retry.disabled=true;try{await api(`/api/projects/${retry.dataset.retry}/retry`,{method:'POST',body:'{}'});await refresh();}catch(err){toast(err.message);retry.disabled=false;}return;}
  const resume=e.target.closest('[data-resume]');
  if(resume){currentUpload=projects.find(p=>p.id===resume.dataset.resume);selectedFile=null;$('#file-label').textContent=currentUpload.name;$('#file-detail').textContent='Already uploaded · Choose settings below';navigate('#create');return;}
  const del=e.target.closest('[data-delete]');
  if(del){if(!confirm('Delete this project, its source video and all clips from this computer?'))return;try{await api(`/api/projects/${del.dataset.delete}`,{method:'DELETE'});await refresh();navigate('#projects');toast('Project deleted.');}catch(err){toast(err.message);}}
});
$('#video-file').addEventListener('change',e=>setFile(e.target.files[0]));
$('#srt-file').addEventListener('change',e=>{$('#srt-name').textContent=e.target.files[0]?.name||'Match the timings to your video';});
$('#processing-mode').addEventListener('change',updateMode);
$('#crop-position').addEventListener('input',e=>{$('.crop-settings summary span').textContent=`${e.target.value}% from left`;});
for(const event of ['dragenter','dragover'])$('#drop-zone').addEventListener(event,e=>{e.preventDefault();$('#drop-zone').classList.add('dragover');});
for(const event of ['dragleave','drop'])$('#drop-zone').addEventListener(event,e=>{e.preventDefault();$('#drop-zone').classList.remove('dragover');if(event==='drop')setFile(e.dataTransfer.files[0]);});
$('#nav-create').onclick=()=>navigate('#create');$('#nav-projects').onclick=$('#view-all').onclick=$('#back-projects').onclick=()=>navigate('#projects');
$('#settings-open').onclick=$('#connection').onclick=()=>$('#settings').showModal();$('#settings-close').onclick=()=>$('#settings').close();
window.addEventListener('hashchange',()=>{detailSignature='';renderRoute();});
async function refresh(){projects=await api('/api/projects');renderLists();renderRoute();}
async function connect(){
    const initial=!config;
    const next=await api('/api/config');
    if(next.application!=='cutroom')throw new Error('Unexpected local application.');
    config=next;online=true;$('#connection-error').hidden=true;
    $('#connection').innerHTML=`<span class="status-dot ${config.aiReady?'':'amber'}"></span>${config.localReady?'Free subtitles ready':config.aiReady?'OpenAI key configured':'Setup needed'}`;
    $('#setup-status').innerHTML=`<div class="setup-status">Free local subtitles: <strong>${config.localReady?'Ready':'Not installed'}</strong><br>Video processor: <strong>${config.ffmpegReady?'Ready':'Not installed'}</strong><br>AI service: <strong>${config.aiReady?'Key configured; usage not yet verified':'Not connected'}</strong><br>Language: <strong>English</strong><br>Storage: <strong>This computer</strong></div>`;
    if(initial)$('#processing-mode').value=config.localReady?'local':config.aiReady?'ai':'srt';
    if(!config.ffmpegReady)formError('The video processor is not available. Open Setup & help.');
    updateMode();
}
async function poll(){
  try{await connect();await refresh();}
  catch{online=false;$('#connection-error').hidden=false;$('#connection').textContent='Server offline';updateMode();}
  setTimeout(poll,2500);
}
updateMode();poll();

function captionValues(){return {font:$('#caption-font').value,color:$('#caption-color').value,size:Number($('#caption-size').value),position:$('#caption-position').value};}
function drawCaptionPreview(){
  const style=captionValues(),ctx=$('#caption-preview').getContext('2d');
  const gradient=ctx.createLinearGradient(0,0,240,426);gradient.addColorStop(0,'#465c58');gradient.addColorStop(1,'#17252c');ctx.fillStyle=gradient;ctx.fillRect(0,0,240,426);
  ctx.fillStyle='#637b71';ctx.beginPath();ctx.arc(120,155,43,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(120,325,90,115,0,0,Math.PI*2);ctx.fill();
  ctx.font=`bold ${style.size/3}px "${style.font}"`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.strokeStyle='#121212';ctx.lineWidth=2;
  const words='Make every moment worth watching'.split(' '),lines=[];let line='';
  for(const word of words){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>210){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);
  const height=style.size/3*1.2,total=lines.length*height;
  const top=style.position==='top'?170/3:style.position==='center'?(426-total)/2:426-170/3-total;
  ctx.fillStyle=style.color;lines.forEach((text,i)=>{const y=top+height*(i+.5);ctx.strokeText(text,120,y);ctx.fillText(text,120,y);});
  $('#caption-size-value').textContent=style.size+' px';
}
function openCaptionEditor(id=null){
  captionProject=id;const style=(id?projects.find(p=>p.id===id)?.captionStyle:newCaptionStyle)||newCaptionStyle;
  $('#caption-font').value=style.font;$('#caption-color').value=style.color;$('#caption-size').value=style.size;$('#caption-position').value=style.position;
  $('#caption-error').hidden=true;$('#caption-apply').textContent=id?'Apply & re-export clips':'Use this style';drawCaptionPreview();$('#caption-editor').showModal();
}
$('#new-caption-style').onclick=()=>openCaptionEditor();
$('#caption-close').onclick=()=>$('#caption-editor').close();
for(const id of ['font','color','size','position'])$('#caption-'+id).addEventListener('input',drawCaptionPreview);
$('#caption-apply').onclick=async()=>{
  const button=$('#caption-apply'),style=captionValues();button.disabled=true;
  try{
    if(captionProject){await api(`/api/projects/${captionProject}/restyle`,{method:'POST',body:JSON.stringify({captionStyle:style})});await refresh();toast('Re-exporting with your caption style. No new AI request is needed.');}
    else{newCaptionStyle=style;$('#caption-style-summary').textContent=`${style.font} · ${style.color.toUpperCase()} · ${style.size} px · ${style.position}`;}
    $('#caption-editor').close();
  }catch(error){$('#caption-error').textContent=error.message;$('#caption-error').hidden=false;}
  finally{button.disabled=false;}
};
