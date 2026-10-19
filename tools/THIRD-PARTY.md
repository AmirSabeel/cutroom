# Video processing dependency

The bundled Windows executable was copied without modification from the `imageio-ffmpeg==0.6.0` wheel, file `imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe`.

- FFmpeg: https://ffmpeg.org/
- FFmpeg licensing and source: https://ffmpeg.org/legal.html and https://ffmpeg.org/download.html
- imageio-ffmpeg source, packaging and binary provenance: https://github.com/imageio/imageio-ffmpeg/tree/v0.6.0
- Wheel metadata: https://pypi.org/project/imageio-ffmpeg/0.6.0/

FFmpeg is separate software with its own licenses. The bundled build enables GPL components. Before redistributing a packaged product, fulfill the applicable FFmpeg/GPL source and notice requirements, or configure FFMPEG_PATH to a separately installed compatible FFmpeg. This folder is a local development runtime, not a redistribution license grant.
