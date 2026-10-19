export function parseSrt(text) {
  const clean = String(text).replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  const segments = [];
  const time = s => {
    const m = s.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/);
    if (!m || +m[2] > 59 || +m[3] > 59) throw new Error('Invalid subtitle timestamp. Use an SRT file.');
    return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
  };
  for (const block of clean.split(/\n\s*\n/)) {
    const lines = block.trim().split('\n');
    if (/^\d+$/.test(lines[0])) lines.shift();
    const range = lines.shift()?.split(/\s+-->\s+/);
    if (!range || range.length !== 2) throw new Error('Invalid SRT file. Every caption needs a start and end timestamp.');
    const start = time(range[0]), end = time(range[1]);
    const caption = lines.join(' ').replace(/<[^>]*>/g, '').trim();
    if (!Number.isFinite(start) || end <= start || !caption) throw new Error('Captions must have text and a positive duration.');
    segments.push({ start, end, text: caption });
  }
  if (!segments.length || segments.length > 5000) throw new Error('Please supply 1–5,000 subtitle entries.');
  segments.sort((a, b) => a.start - b.start);
  return segments;
}

export function validateSegments(segments, duration) {
  if (!Array.isArray(segments) || !segments.length) throw new Error('No English speech or captions were found.');
  return segments.map(s => {
    const start = Number(s.start), end = Number(s.end), text = String(s.text || '').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start >= duration || end > duration + 2 || !text || text.length > 5000) {
      throw new Error('Subtitle timings do not match this video. Please check the transcript.');
    }
    return { start, end: Math.min(end, duration), text };
  }).sort((a, b) => a.start - b.start);
}

export function chooseExcerpts(segments, duration, length = 45) {
  // Deterministic transcript-based fallback, explicitly labelled as non-AI in the UI.
  const clips = [];
  let boundary = 0;
  for (let index = 0; index < 3; index++) {
    const desired = Math.max(boundary, index * Math.max(0, duration - length) / 2);
    const first = segments.find(s => s.start >= desired && s.end > s.start);
    if (!first) break;
    const included = segments.filter(s => s.start >= first.start && s.end <= first.start + length);
    if (!included.length) continue;
    const end = included.at(-1).end;
    if (end - first.start < 3) continue;
    clips.push({ start: first.start, end, title: first.text.split(/\s+/).slice(0, 8).join(' '), reason: 'A transcript-aligned excerpt. Review the cut before posting.' });
    boundary = end;
  }
  if (!clips.length) throw new Error('No usable excerpt was found. Supply captions with shorter entries.');
  return clips;
}

// Offline smart selection: rank transcript windows by hook/result language,
// questions, and energetic punctuation while keeping clips non-overlapping.
export function chooseSmartMoments(segments, duration, length = 45) {
  const positive = /\b(best|secret|tip|trick|key|important|amazing|love|win|won|success|result|finally|because|learned|mistake|never|always|must|should|how|why|what if)\b/gi;
  const candidates = [];
  for (let i = 0; i < segments.length; i++) {
    const first = segments[i];
    const included = segments.filter(s => s.start >= first.start && s.start < first.start + length);
    if (!included.length) continue;
    const end = Math.min(duration, included.at(-1).end);
    if (end - first.start < 3) continue;
    const text = included.map(s => s.text).join(' ');
    const hits = (text.match(positive) || []).length;
    const punctuation = (text.match(/[!?]/g) || []).length;
    const words = text.trim().split(/\s+/).length;
    const completeness = Math.min(1, words / 18);
    const score = hits * 3 + punctuation * 2 + completeness;
    candidates.push({ start:first.start, end, score, text });
  }
  candidates.sort((a,b) => b.score - a.score || a.start - b.start);
  const chosen = [];
  for (const candidate of candidates) {
    if (chosen.some(c => candidate.start < c.end && candidate.end > c.start)) continue;
    const title = candidate.text.split(/\s+/).slice(0, 8).join(' ');
    chosen.push({start:candidate.start,end:candidate.end,title,reason:'Offline smart selection found a strong hook or useful result in the transcript.'});
    if (chosen.length === 3) break;
  }
  if (!chosen.length) return chooseExcerpts(segments, duration, length);
  return chosen.sort((a,b) => a.start-b.start);
}

export function validateClips(clips, duration) {
  if (!Array.isArray(clips) || !clips.length || clips.length > 3) throw new Error('The AI did not return 1–3 valid clips. Retry selection.');
  const ordered = clips.map(c => {
    const start = Number(c.start), end = Number(c.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration + 0.1 || end - start < 3 || end - start > 61) throw new Error('The selected clip times are invalid. Retry selection.');
    return { start, end: Math.min(end, duration), title: String(c.title || 'Untitled clip').slice(0, 100), reason: String(c.reason || '').slice(0, 500) };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) if (ordered[i].start < ordered[i-1].end) throw new Error('Selected clips overlap. Retry selection.');
  return ordered;
}

export function clipCaptions(segments, start, end) {
  return segments.filter(s => s.end > start && s.start < end).map(s => ({ start: Math.max(0, s.start - start), end: Math.min(end - start, s.end - start), text: s.text }));
}

function timestamp(seconds, ass = false) {
  const units = ass ? 100 : 1000;
  const total = Math.round(Math.max(0, seconds) * units);
  const whole = Math.floor(total / units);
  const h = Math.floor(whole / 3600), m = Math.floor(whole % 3600 / 60), s = whole % 60;
  return `${String(h).padStart(ass ? 1 : 2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${ass ? '.' : ','}${String(total % units).padStart(ass ? 2 : 3, '0')}`;
}

export function toSrt(segments) {
  return segments.map((s, i) => `${i+1}\n${timestamp(s.start)} --> ${timestamp(s.end)}\n${s.text}\n`).join('\n');
}

export function normalizeCaptionStyle(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid caption style.');
  const style = {font:input.font ?? 'Arial', color:input.color ?? '#FFFFFF', size:input.size ?? 42, position:input.position ?? 'bottom'};
  if (!['Arial','Georgia','Verdana','Courier New'].includes(style.font) || !/^#[0-9a-fA-F]{6}$/.test(style.color) || !Number.isInteger(style.size) || style.size < 28 || style.size > 64 || !['top','center','bottom'].includes(style.position)) throw new Error('Choose a valid caption font, colour, size (28–64) and position.');
  return {...style,color:style.color.toUpperCase()};
}
export function toAss(segments, input) {
  const style = normalizeCaptionStyle(input);
  const color = '&H00' + style.color.slice(5,7) + style.color.slice(3,5) + style.color.slice(1,3);
  const alignment = {top:8,center:5,bottom:2}[style.position];
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${style.font},${style.size},${color},&H00FFFFFF,&H00121212,&H80121212,-1,0,0,0,100,100,0,0,1,3,1,${alignment},45,45,170,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = [];
  for (const segment of segments) {
    const words = segment.text.replace(/[{}\\]/g, '').replace(/[\r\n]/g, ' ').split(/\s+/).filter(Boolean);
    // Segment-only transcripts have approximate within-segment caption timing.
    for (let i = 0; i < words.length; i += 9) {
      const start = segment.start + (segment.end - segment.start) * i / words.length;
      const end = segment.start + (segment.end - segment.start) * Math.min(i+9, words.length) / words.length;
      events.push(`Dialogue: 0,${timestamp(start, true)},${timestamp(end, true)},Default,,0,0,0,,${words.slice(i, i+9).join(' ')}`);
    }
  }
  return header + events.join('\n') + '\n';
}
