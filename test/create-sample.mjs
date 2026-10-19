import {runVideo} from '../lib/video.mjs';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../sample/',import.meta.url));
await runVideo(['-y','-f','lavfi','-i','testsrc2=size=640x360:rate=10:duration=96','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=96','-c:v','libx264','-preset','ultrafast','-crf','35','-threads','2','-c:a','aac','-shortest','test-video.mp4'],{cwd});
console.log('Created sample/test-video.mp4. Use it with sample/test-video.srt.');
