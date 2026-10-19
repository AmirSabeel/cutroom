# Verification — 18 October 2026

## Startup repair

- Reproduced the reported browser state: “This site can't be reached”; no desktop launcher logs were present.
- Updated startup to wait for an app-specific health endpoint, validate Node.js, handle early exits and port conflicts, preserve environment settings and show startup failures.
- Verified actual PowerShell launch, HTTP health, repeated launch without a second server, and authenticated stop in one execution session.
- Replaced the stop script's failing CIM process inspection with an authenticated local shutdown endpoint. Shutdown terminates owned video workers.
- Added offline feedback, automatic configuration reload and token refresh after restarts. Frontend syntax checked; live browser interaction verification remains blocked by the browser tool's security policy.

## Passed

- Six automated caption and clip-validation tests: subtitle parsing, bad timestamps, source bounds, timestamp rebasing, ASS-command sanitization, excerpt boundaries and invalid AI output rejection.
- Actual HTTP upload of a generated 96-second MP4 with AAC audio.
- Background processing produced three 24-second H.264/AAC MP4 files at 720 × 1280 and 30 fps.
- Downloaded all three outputs and inspected their media metadata.
- Parsed output SRT files and verified clip-relative caption times.
- Extracted and visually checked a rendered frame: captions are burned in and readable.
- MP4 downloads, attachment headers, byte-range playback, suffix ranges and invalid-range responses.
- Rejected invalid file extensions, invalid MP4 contents, malformed subtitles, duplicate processing and deletion during processing.
- Rejected missing mutation tokens, cross-origin API requests and access to source videos through export routes.
- Node.js syntax checks and PowerShell launcher syntax checks.

## Limits

- The end-to-end test used supplied subtitles and a synthetic color-pattern video with a tone. It does not verify speech recognition or AI editorial quality.
- No OpenAI key was configured. Live transcription, live AI selection and API billing behavior remain unverified.
- The sandbox allowed HTTP checks within one execution session but blocked the separate browser from reaching the local server. Browser rendering and interaction QA remain unverified. Launch the app using Start Cutroom.cmd on the desktop to review it.
- The repaired background launch and stop scripts were executed successfully with browser handoff disabled; the desktop browser handoff remains unverified outside this restricted execution environment.
- This is a local single-user milestone, not a deployed SaaS product.
