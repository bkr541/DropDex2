"""Extract track titles from rendered search HTML; no network or database I/O."""

from urllib.parse import urlsplit

from selectolax.parser import HTMLParser

from . import selectors as S


def parse_track_titles(html: str, *, limit: int = 20) -> list[str]:
    titles: list[str] = []
    seen_paths: set[str] = set()
    if limit <= 0:
        return titles
    for link in HTMLParser(html).css(S.TRACK_LINK):
        title = " ".join(link.text(separator=" ", strip=True).split())
        href = (link.attributes.get("href") or "").strip()
        try:
            url = urlsplit(href)
        except ValueError:
            continue
        if url.scheme not in ("", "https") or url.netloc not in ("", "soundcloud.com", "www.soundcloud.com"):
            continue
        path = url.path.rstrip("/")
        if not title or len(path.strip("/").split("/")) != 2 or path in seen_paths:
            continue
        seen_paths.add(path)
        titles.append(title)
        if len(titles) >= limit:
            break
    return titles
