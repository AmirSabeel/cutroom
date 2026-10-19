import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSrt,validateSegments,chooseExcerpts,validateClips,clipCaptions,toSrt,toAss} from '../lib/captions.mjs';

test('SRT parsing accepts BOM, CRLF, multiline captions and decimal timestamp separators',()=>{
  const result=parseSrt('\uFEFF1\r\n00:00:01,000 --> 00:00:03,500\r\nHello\r\nworld.\r\n\r\n2\r\n00:00:04.000 --> 00:00:05.000\r\nNext.');
  assert.deepEqual(result,[{start:1,end:3.5,text:'Hello world.'},{start:4,end:5,text:'Next.'}]);
});
test('rejects malformed captions and out-of-bounds source timings',()=>{
  for(const value of ['','not captions','1\n00:61:00,000 --> 00:62:01,000\nBad','1\n00:00:05,000 --> 00:00:01,000\nBad'])assert.throws(()=>parseSrt(value));
  assert.throws(()=>validateSegments([{start:15,end:20,text:'Too late'}],10));
  assert.throws(()=>validateSegments([{start:0,end:NaN,text:'Bad'}],10));
});
test('clips rebase and clamp captions at both boundaries',()=>{
  const segments=[{start:2,end:7,text:'Before cut'},{start:8,end:14,text:'After cut'}];
  const clipped=clipCaptions(segments,5,10);
  assert.deepEqual(clipped,[{start:0,end:2,text:'Before cut'},{start:3,end:5,text:'After cut'}]);
  assert.deepEqual(parseSrt(toSrt(clipped)),clipped);
});
test('caption text cannot inject ASS override commands',()=>{
  const ass=toAss([{start:0,end:2,text:'{\\pos(0,0)} Hello \\N world'}]);
  assert.ok(!ass.includes('{\\pos'));
  assert.ok(!ass.includes('\\N'));
});
test('transcript fallback selects non-overlapping excerpts and never pads sparse speech',()=>{
  const segments=Array.from({length:8},(_,i)=>({start:i*12,end:(i+1)*12,text:`Sentence ${i}.`}));
  const result=validateClips(chooseExcerpts(segments,96,30),96);
  assert.equal(result.length,3);
  assert.deepEqual(result.map(c=>[c.start,c.end]),[[0,24],[36,60],[72,96]]);
  assert.equal(chooseExcerpts([{start:2,end:8,text:'Just one thought.'}],10,45).length,1);
});
test('AI output is rejected if invalid, excessive or overlapping',()=>{
  for(const clips of [[],[{start:-1,end:10}],[{start:0,end:65}],[{start:0,end:20},{start:10,end:30}],Array(4).fill({start:0,end:5})])assert.throws(()=>validateClips(clips,100));
});
