# third_party/

Lip-sync engines are research repos (not pip packages). Clone them here; this
folder is git-ignored.

```
third_party/
  Wav2Lip/     git clone https://github.com/Rudrabha/Wav2Lip
               checkpoints/wav2lip_gan.pth                      (links in its README)
               face_detection/detection/sfd/s3fd.pth             (python main.py download-models --lipsync)
  MuseTalk/    git clone https://github.com/TMElyralab/MuseTalk
               models/...                                        (its download_weights.bat / .sh)
```

Both are released for **non-commercial research** use. Check their licenses.
DubForge only uses them for private, personal dubbing.
