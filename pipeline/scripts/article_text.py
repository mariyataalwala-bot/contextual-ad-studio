"""Clean article text from a saved HTML page, with Trafilatura (https://trafilatura.readthedocs.io).

usage: python -I article_text.py <page.html> <page url>
prints one JSON line: {"ok": true, "title", "text", "date", "sitename", "url", "image", "categories", "tags", "author", "version"}
or {"ok": false, "error": "..."} when Trafilatura is missing or finds no article text.

Only the main article is kept: navigation, comments, related-story lists, cookie banners and ads are left out by
Trafilatura's main-content detection (favor_precision). Nothing is fetched from the network here.
"""
import json
import sys


def main():
    sys.stdout.reconfigure(encoding="utf-8")   # the app reads UTF-8 (Windows pipes default to the ANSI code page)
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: article_text.py <page.html> <url>"}))
        return 2
    try:
        import trafilatura
    except ImportError:
        print(json.dumps({"ok": False, "error": "trafilatura is not installed (python -m pip install trafilatura==2.3.1)"}))
        return 3
    with open(sys.argv[1], "rb") as f:
        raw = f.read()
    html = raw.decode("utf-8", errors="replace")
    doc = trafilatura.bare_extraction(html, url=sys.argv[2], with_metadata=True, include_comments=False, include_tables=False,
                                      include_images=False, include_links=False, favor_precision=True, deduplicate=True)
    if doc is None:
        print(json.dumps({"ok": False, "error": "no article text found"}))
        return 0
    d = doc.as_dict() if hasattr(doc, "as_dict") else dict(doc)
    pick = lambda k: d.get(k) or None
    print(json.dumps({"ok": bool((d.get("text") or "").strip()), "title": pick("title"), "text": d.get("text") or "", "date": pick("date"),
                      "sitename": pick("sitename"), "url": pick("url"), "image": pick("image"), "author": pick("author"),
                      "categories": d.get("categories") or [], "tags": d.get("tags") or [], "version": trafilatura.__version__}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
