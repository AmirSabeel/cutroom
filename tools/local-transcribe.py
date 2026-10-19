import sys, pathlib, json, os
root = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(root / 'local-packages'))
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HOME'] = str(root / 'hf-cache')
os.environ['HF_HUB_DISABLE_XET'] = '1'
from faster_whisper import WhisperModel
model_name = (root / 'local-model.txt').read_text().strip() if (root / 'local-model.txt').exists() else 'base.en'
if sys.argv[1] == '--install':
    model_name = sys.argv[2] if len(sys.argv) > 2 else 'medium.en'
    if model_name not in ('base.en', 'small.en', 'medium.en'):
        raise ValueError('Unsupported English model')
    model_path = root / ('whisper-' + model_name)
    from huggingface_hub import snapshot_download
    snapshot_download('Systran/faster-whisper-' + model_name, local_dir=str(model_path), allow_patterns=['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.*'])
    WhisperModel(str(model_path), device='cpu', compute_type='int8')
    (root / 'local-model.txt').write_text(model_name)
    (root / 'local-ready').write_text(model_name + ' CPU int8')
    print('Local subtitles ready')
else:
    model_path = root / ('whisper-' + model_name)
    model = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=4)
    segments, _ = model.transcribe(sys.argv[1], language='en', vad_filter=True, beam_size=5, word_timestamps=True)
    captions = []
    for segment in segments:
        group = []
        def flush():
            if group and group[-1].end > group[0].start:
                captions.append(dict(start=group[0].start, end=group[-1].end, text=''.join(w.word for w in group).strip()))
            group.clear()
        for word in segment.words or []:
            if word.end <= word.start or not word.word.strip():
                continue
            if group and (len(group) >= 7 or word.end - group[0].start > 3.5 or word.start - group[-1].end > 0.7):
                flush()
            group.append(word)
            if word.word.rstrip().endswith(('.', '?', '!')):
                flush()
        flush()
    print(json.dumps(captions))
