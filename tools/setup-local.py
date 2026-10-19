"""Install local speech recognition and FFmpeg after cloning the source."""
import os
import pathlib
import shutil
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parent
if sys.version_info < (3, 10):
    raise SystemExit('Install Python 3.10 or newer (3.12 recommended).')
temp = root / 'setup-temp'
temp.mkdir(exist_ok=True)
env = dict(os.environ, TEMP=str(temp), TMP=str(temp))
subprocess.run([sys.executable, '-m', 'pip', 'install', '--upgrade', '--target', str(root / 'local-packages'), '-r', str(root / 'requirements-local.txt')], check=True, env=env)
sys.path.insert(0, str(root / 'local-packages'))
import imageio_ffmpeg
shutil.copy2(imageio_ffmpeg.get_ffmpeg_exe(), root / ('ffmpeg.exe' if os.name == 'nt' else 'ffmpeg'))
(root / 'local-python-path.txt').write_text(sys.executable, encoding='utf-8')
subprocess.run([sys.executable, str(root / 'local-transcribe.py'), '--install', 'medium.en'], check=True, env=env)
print('Setup complete. On Windows, double-click Start Cutroom.cmd.')
