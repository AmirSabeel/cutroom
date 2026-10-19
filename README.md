# Cutroom — local English video clipping app

This is the first local working milestone, not a hosted multi-user service.

## Install after cloning (Windows)

Install Node.js 22+ and Python 3.12, then run from this folder:

```powershell
python tools/setup-local.py
```

This downloads FFmpeg, the free speech recognition packages and the medium.en English model. Allow several GB of disk space and an internet connection for installation. Then double-click **Start Cutroom.cmd**. Local transcription works offline after setup. No API key is needed for free local subtitles.

Only source code and synthetic sample captions are tracked in Git. Run `npm run sample` after setup to generate the sample video. Uploaded videos, transcripts, exports, API keys, local runtime paths and downloaded models are excluded. This repository does not deploy a public website.

## Open the app

Double-click **Start Cutroom.cmd** on Windows. Node.js 22 or newer is required. The app opens at http://127.0.0.1:4317 and the local server runs in the background.

To stop it, double-click **Stop Cutroom.cmd**. Keep the server running while videos render. Closing a browser tab does not stop processing.

### If the page says “This site can't be reached”

The local server must be started before opening its address. In Windows File Explorer, open this app folder and double-click **Start Cutroom.cmd**. The launcher checks that the server is ready before opening your default browser. If startup fails, it keeps the error visible instead of opening an unreachable page. Do not open `public/index.html` directly.

An agent sandbox's server may be unreachable from the desktop browser. In that case, launch the app directly from File Explorer; no firewall or browser security changes are needed. Once the page is loaded, it displays a disconnected message and automatically reconnects after a server restart.

## Processing modes

**Free local subtitles:** choose Free local subtitles + transcript excerpts. Speech recognition runs locally with medium.en; clips use transcript excerpts rather than semantic AI ranking. Review captions for recognition errors.

**Paid OpenAI:** stop the existing server, then double-click **Start with AI.cmd**. Enter your own OpenAI API key in the hidden local prompt. The key is held in the server process, not written to a file or exposed to the browser. API billing is separate from a coding subscription. Audio is sent to OpenAI for English transcription; the timestamped transcript is sent for clip selection. AI requests are not automatically retried. Completed transcript and selection files are cached for manual retries.

**Own subtitles:** upload an English MP4 and its matching SRT file. This makes real clips locally, with deterministic transcript excerpts instead of AI moment selection. No external AI calls or API key are required. A supplied SRT must match the source video timings.

For a no-key smoke test, use the MP4 and SRT inside `sample/`, choose **Use my English subtitles**, and set the clip length to **30 seconds**. This is a synthetic color-pattern test with a tone and supplied captions, not a recording of English speech or an AI-generated result. It should produce three 24-second clips.

## Supported flow

- MP4 upload: 5 seconds to 10 minutes, up to 500 MB.
- Up to three clips, targeting 30, 45 or 60 seconds. Short sources or sparse captions may produce fewer clips.
- 720 × 1280 MP4 export with adjustable horizontal crop; not automatic face tracking.
- Burned-in English captions plus downloadable SRT. Text is broken into short groups with approximate within-segment timing; no word-level sync claim.
- Project history on disk, one processing job at a time, stage progress, explicit errors, manual retry and project deletion.
- Range-enabled video preview and MP4/SRT downloads.

The AI pathway is implemented but cannot be verified live until a valid API key and billing are connected. No synthetic test output should be described as AI-generated.

## Storage and limits

`data/` contains originals, extracted audio, transcript, exports and metadata. Projects remain until deleted using the app. This local milestone allows 50 projects and does not have resumable uploads, scheduled retention, user accounts, payments or cloud backups. The server binds only to 127.0.0.1. Do not expose it as a public multi-user server.

## Developer commands

```
npm start
npm test
npm run test:integration
```

There are no npm runtime dependencies. The Windows FFmpeg executable is in `tools/ffmpeg.exe`; alternatively set `FFMPEG_PATH` to a compatible build containing libx264, libmp3lame and libass. FFmpeg was obtained from the imageio-ffmpeg 0.6.0 Windows wheel. See `tools/THIRD-PARTY.md` for provenance and licensing. Other operating systems need their own compatible FFmpeg executable.

Configuration: `PORT` (default 4317), `CUTROOM_DATA_DIR`, `FFMPEG_PATH`, `OPENAI_API_KEY`, `OPENAI_SELECTION_MODEL` (default gpt-4.1-mini). Transcription uses whisper-1 for segment timestamps. Launchers use the default port.

## Next milestone

Validate real English speech with your API account, then add transcript editing and trim controls. Accounts, private cloud storage, robust external workers, credits, payments and deployment follow after the local pipeline is proven.

## Free local subtitles
This computer now has faster-whisper 1.2.1, PyAV 16.0.1 and the base.en model installed under tools. It uses CPU int8 inference and the bundled Codex Python path recorded in tools/local-python-path.txt. Moving to a different computer requires installing a compatible Python runtime and updating that path.

Restart using Stop Cutroom.cmd then Start Cutroom.cmd in Windows File Explorer. Choose "Free local subtitles + transcript excerpts". No API key or API payment is needed. Inference runs offline; clips use deterministic transcript excerpts, not semantic moment ranking. Review captions for accuracy. Failed projects can switch using "Use free local subtitles" without uploading again.

Local model: https://huggingface.co/Systran/faster-whisper-base.en
Speech engine (MIT): https://github.com/SYSTRAN/faster-whisper
Model download and installation happened during setup; ordinary processing does not download models.

### Subtitle accuracy upgrade
Local English recognition now uses medium.en (CPU int8) instead of base.en. Word timestamps split captions into short phrases. This improves the available model capacity but is not a guarantee of word accuracy, especially names and speech over crowd noise. Processing takes longer.

After restarting the app, use "Recreate with improved subtitles (free)" on an existing project. This reruns transcription rather than reusing its old transcript. Prior transcript, selection and exported clips are backed up inside the project's previous-* folder.

### Caption styles
Create clips > Caption style offers Arial, Georgia, Verdana and Courier New, a colour picker, size 28–64, and top/centre/bottom placement with a sample preview. On a completed project, Change caption style > Apply & re-export clips reuses saved transcription and clip selections, without a new AI request. Styles are burned into MP4 exports; SRT remains plain text. Restart the server and refresh the page after upgrading.

Validated caption style rendering and re-export with a real video, including saved settings, invalid-font rejection and unchanged cached transcription. Six existing caption unit tests pass.
