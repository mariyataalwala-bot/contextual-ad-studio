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
6. A 720p preview is ready in about 1–2 minutes (full HD on request).
   It is saved in  D:\contextual-ads\<brand>\<brand>-contextual-ad.mp4
   along with TIMING.md (sources and reasons).

SHARE WITH YOUR TEAM
- Double-click share.bat, choose a password, and send the link it shows
  (https://….trycloudflare.com) with the password. They sign in with any username.
- You on this PC never need the password. Settings can only be changed on this PC.
- The link changes every time you start sharing; keep the window open while it's in use.
- Only one video renders at a time; others wait in a queue.

MANUAL MODE (when the free AI quota is used up)
- On the approval screen: click a small frame, or type an exact time (e.g. 8:07)
  and press "Use this time"; drag on the picture to draw the box; type keywords
  copied exactly from the video title.
- You can also paste your own content video link in step 2.

NEEDS: Node.js, Python, ffmpeg (winget install Gyan.FFmpeg), internet.
AI: free Gemini key (a few videos a day) or a Claude key; YouTube Data API key optional.
Article reading (Open Web / In-Image), optional:
- Trafilatura for clean article text when a page's own metadata has none:
  python -m pip install trafilatura==2.3.1
- Firecrawl for pages built by JavaScript: put "firecrawlKey" in settings.json
  (or set FIRECRAWL_API_KEY). Never used for pages a publisher refuses or paywalls.

Notes
- Videos are captured from the YouTube player as screenshots and recorded audio;
  nothing is downloaded as a file.
- Keep this window open while a video is being made.

OPEN WEB TAB (existing creatives on relevant articles)
Click "Open Web →" at the top right (or open http://localhost:4777/openweb).
Recommendation and mock previews only: nothing is served, and no ad server, SSP,
DSP or brand-safety vendor is connected.
1. Inventory: the pilot publishers (config/publishers.v2.json) and the formats each
   one sells, each checked against your media plan (D:\Media Plan Automation).
   "Refresh showcase catalogue" imports showcase.mediakart.co.in for reference.
2. Put source creative files (MP4, WebM, PNG, JPG, GIF) in
   D:\contextual-ads\openweb\creatives\ (sub-folders are fine).
3. Campaigns: enter brand, status, dates (IST, inclusive), creatives (format and
   file), target IAB categories, keywords and exclusions. Without an active campaign
   inside its dates, nothing is recommended.
4. "Fetch & analyse latest" reads each publisher's RSS feed (robots.txt is
   honoured; sites that block scripts are reported as BLOCKED, never worked around),
   then checks safety, campaign, exclusions and format in that order, and scores
   relevance. Click a row for the evidence: verbatim quotes, gate results and
   reason codes.
5. "Needs review" items can be approved or rejected with your name and a reason.
   Excluded pages can't be approved.
6. "Make mock" opens the real article in a phone-sized browser and places your
   creative in the slot. It saves PNG (+ optional MP4) and a JSON record to
   D:\contextual-ads\openweb\mocks\.
IN-IMAGE STUDIO (http://localhost:4777/inimage)
Type a brand and product (or upload the client's own ad). The studio finds the exact
Indian product picture and logo, builds the ad in a design that suits the brand, picks
a directly relevant, brand-safe article picture on a media-plan publisher (one brand
per article) and records it on a phone, in under 2 minutes. Brand knowledge for the 50
pitched brands is in openweb\config\brands.v2.json. Every run ends with a status:
success, partial, needs_review, no_match or failed — and saves result.json with the
reasons in D:\contextual-ads\inimage\<brand>\<time>\.

HOSTED ON RENDER (https://contextual-ad-studio.onrender.com)
Every push to main deploys automatically (render.yaml + Dockerfile). Set
GEMINI_API_KEY and APP_PASSWORD in the Render dashboard (Environment); without
APP_PASSWORD the hosted app stays locked. Files made there are lost on redeploy.

Policies, taxonomy and scoring are versioned files in openweb\config\. If you change
one, raise its version; stored articles are re-checked automatically.
Developer checks: npm test · npm run typecheck · npm run lint
