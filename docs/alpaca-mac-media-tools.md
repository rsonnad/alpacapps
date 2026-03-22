# Alpaca Mac — Media & Video Tools Reference

> **Machine:** Mac Studio (Alpaca Mac) — 192.168.1.74
> **User:** `alpaca` (shared guest account)
> **OS:** macOS
> **Connect:** `ssh alpaca@192.168.1.74` (must be on Alpaca Playhouse WiFi)

---

## Installed Tools

### FFmpeg (via Homebrew)

Full-featured video/audio encoder, decoder, transcoder, and stream processor.

```bash
# Check version
ffmpeg -version

# Transcode video to H.264 MP4 (web-friendly)
ffmpeg -i input.mov -c:v libx264 -crf 23 -c:a aac -b:a 128k output.mp4

# Extract audio from video
ffmpeg -i video.mp4 -vn -c:a libmp3lame -q:a 2 audio.mp3

# Create a thumbnail from video
ffmpeg -i video.mp4 -ss 00:00:05 -frames:v 1 thumbnail.jpg

# Trim video (no re-encode)
ffmpeg -i input.mp4 -ss 00:01:00 -to 00:02:30 -c copy trimmed.mp4

# Resize video to 1080p
ffmpeg -i input.mp4 -vf scale=1920:1080 -c:a copy output_1080p.mp4

# Convert image sequence to video
ffmpeg -framerate 30 -i frame_%04d.png -c:v libx264 -pix_fmt yuv420p output.mp4

# Add text overlay / watermark
ffmpeg -i input.mp4 -vf "drawtext=text='Alpaca Playhouse':fontsize=24:fontcolor=white:x=10:y=10" output.mp4

# Concatenate videos (file list method)
# Create list.txt with lines like: file 'clip1.mp4'
ffmpeg -f concat -safe 0 -i list.txt -c copy merged.mp4

# Generate waveform image from audio
ffmpeg -i audio.mp3 -filter_complex "showwavespic=s=1920x200:colors=blue" waveform.png

# Extract frames at 1fps (for timelapse / analysis)
ffmpeg -i video.mp4 -vf fps=1 frames/frame_%04d.jpg
```

### FFprobe (bundled with FFmpeg)

Inspect media file metadata.

```bash
# Show all metadata
ffprobe -v quiet -print_format json -show_format -show_streams input.mp4

# Quick summary
ffprobe -v error -show_entries format=duration,size,bit_rate -of default=noprint_wrappers=1 input.mp4

# Get video resolution
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 input.mp4
```

### yt-dlp (via Homebrew)

Download video/audio from YouTube and 1000+ sites.

```bash
# Download best quality video+audio
yt-dlp "https://youtube.com/watch?v=VIDEO_ID"

# Download audio only (MP3)
yt-dlp -x --audio-format mp3 "https://youtube.com/watch?v=VIDEO_ID"

# Download specific format (list available first)
yt-dlp -F "URL"            # list formats
yt-dlp -f 137+140 "URL"    # pick video+audio format codes

# Download playlist
yt-dlp -o "%(playlist_index)s-%(title)s.%(ext)s" "PLAYLIST_URL"

# Download with subtitles
yt-dlp --write-subs --sub-lang en "URL"
```

### Blender 4.5 (CLI for video)

Blender's Video Sequence Editor (VSE) can be used headlessly for compositing and rendering.

```bash
# Path
/usr/local/bin/blender

# Render a .blend project to video
/usr/local/bin/blender -b project.blend -o //output/frame_#### -F PNG -a

# Render specific frame range
/usr/local/bin/blender -b project.blend -s 1 -e 250 -a
```

### ImageMagick (via Homebrew)

Image processing from the command line.

```bash
# Resize image
magick input.jpg -resize 1920x1080 output.jpg

# Convert format
magick input.png output.jpg

# Create contact sheet / montage
magick montage *.jpg -geometry 200x200+5+5 -tile 4x contact_sheet.jpg

# Add text to image
magick input.jpg -pointsize 36 -fill white -annotate +10+40 "Alpaca Playhouse" output.jpg

# Batch resize all images in directory
for f in *.jpg; do magick "$f" -resize 50% "resized_$f"; done
```

---

## Common Workflows

### Property Walkthrough Video
```bash
# 1. Transfer video from phone/camera to Mac
# 2. Trim to relevant section
ffmpeg -i raw_walkthrough.mov -ss 00:00:10 -to 00:05:00 -c copy trimmed.mp4
# 3. Add property watermark
ffmpeg -i trimmed.mp4 -vf "drawtext=text='160 Still Forest Dr':fontsize=20:fontcolor=white:x=w-tw-10:y=h-th-10" final.mp4
# 4. Generate thumbnail
ffmpeg -i final.mp4 -ss 00:00:03 -frames:v 1 thumbnail.jpg
```

### Timelapse from Photos
```bash
# Photos named IMG_0001.jpg through IMG_0500.jpg
ffmpeg -framerate 24 -i IMG_%04d.jpg -c:v libx264 -pix_fmt yuv420p timelapse.mp4
```

### Audio Extraction for Transcription
```bash
# Extract clean audio for Whisper/transcription
ffmpeg -i meeting.mp4 -vn -ar 16000 -ac 1 -c:a pcm_s16le meeting.wav
```

---

## File Locations

- **Working directory:** Use `~/Desktop` or `~/Movies` for media projects
- **Blender projects:** `~/Documents/blender/`
- **Downloaded media:** `~/Downloads/`

## Notes

- All tools installed via Homebrew (`brew upgrade` to update)
- This is the `alpaca` guest account — not the admin account
- Must be on local network (Alpaca Playhouse WiFi) to SSH in
- For Blender GUI work, use Chrome Remote Desktop (PIN in password vault)
