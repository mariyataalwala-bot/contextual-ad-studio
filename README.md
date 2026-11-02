---
title: MediaKart Contextual Ad Studio
emoji: 🎬
colorFrom: blue
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
---

# MediaKart Contextual Ad Studio

YouTube contextual ads, In-Image ads and 2-in-1 ads from a brand and a product. Preview only: nothing is served live.

Hosting notes are in `README.txt`. On Hugging Face Spaces (Docker) add these under Settings → Variables and secrets:
`AI_PROVIDER` (openai), `OPENAI_COMPAT_KEY`, `OPEN_ACCESS` (1, or set `APP_PASSWORD` instead) and `YOUTUBE_API_KEY`.

Render's free plan has 512 MB of memory: browser work (video recording, YouTube search without an API key) is refused there with a plain message.
A host with 2 GB or more (or your own PC) runs everything.
