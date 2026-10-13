CONTEXTUAL AD STUDIO — Mediakart
================================

Makes a YouTube contextual-ad demo video in the house template (Amul Comfy style):
black laptop, YouTube search typed live, Visual Identify / Keywords / Object Identify,
the AI Check list, the brand's real ad playing mid-roll, "Contextual Ads Pushed by AI",
the MEDIAKART mark, and a music bed that fades into the ad's own sound.

HOW TO USE
1. Double-click start.bat. The app opens in your browser at http://localhost:4777
2. First time only: click Settings and paste your Claude API key, then Save.
   (Get one at https://platform.claude.com. It is stored only in settings.json here.)
3. Type the brand (and optionally the product), upload the logo (and packshots if
   you want an end card), then click "Find this brand's ads".
4. Pick the ad to place (or paste a YouTube link).
5. The app searches YouTube for a premium video where all three checks genuinely
   match the product, and shows you the Visual / Keywords / Object moments.
   Click "Approve", or "Try another video".
6. About 10 minutes later, the video is ready to watch and download.
   It is saved in  D:\contextual-ads\<brand>\<brand>-contextual-ad.mp4
   along with TIMING.md (sources and reasons).

NEEDS: Node.js, Python, ffmpeg (winget install Gyan.FFmpeg), internet.
Each video uses a few Claude API calls (vision): usually well under a dollar.

Notes
- Videos are captured from the YouTube player as screenshots and recorded audio;
  nothing is downloaded as a file.
- Keep this window open while a video is being made.
