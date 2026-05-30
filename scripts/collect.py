#!/usr/bin/env python3
"""Collect practical tool tips into data/items.json without API keys."""

from __future__ import annotations

import email.utils
import hashlib
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCES_PATH = ROOT / "data" / "sources.json"
ITEMS_PATH = ROOT / "data" / "items.json"
MAX_ITEMS = 500
TIMEOUT = 18
GOOGLE_NEWS_LIMIT = 8
DEFAULT_FEED_LIMIT = 20
YOUTUBE_LIMIT = 12

PRACTICAL_KEYWORDS = {
    "tips": ["tips", "tricks", "便利", "コツ", "使い方", "活用"],
    "tutorial": ["tutorial", "guide", "how to", "入門", "手順", "解説"],
    "workflow": ["workflow", "automation", "system", "自動化", "ワークフロー"],
    "usecase": ["use case", "use cases", "examples", "case study", "事例", "できること"],
    "release": ["release notes", "changelog", "what's new", "リリース", "アップデート"],
}

TRACKING_PARAMS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "gclid",
    "fbclid",
    "mc_cid",
    "mc_eid",
}


def main() -> int:
    sources = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    quality_filters = sources.get("qualityFilters", {})
    existing = [
        item
        for item in load_existing_items()
        if not is_blocked_source(
            item.get("title", ""),
            item.get("url", ""),
            item.get("sourceName", ""),
            "",
            quality_filters,
        )
    ]
    collected = []
    errors = []

    for category in sources.get("categories", []):
        for query in category.get("queries", []):
            collected.extend(fetch_google_news(query, category["id"], errors, quality_filters))
        for rss_source in category.get("rss", []):
            collected.extend(
                fetch_feed(
                    rss_source["url"],
                    category["id"],
                    rss_source["name"],
                    rss_source.get("type", "article"),
                    errors,
                    quality_filters=quality_filters,
                    limit=int(rss_source.get("limit", DEFAULT_FEED_LIMIT)),
                )
            )

    for channel in sources.get("youtube", []):
        url = youtube_feed_url(channel, errors)
        if url:
            collected.extend(fetch_feed(url, channel["category"], channel["name"], "video", errors, quality_filters=quality_filters, limit=YOUTUBE_LIMIT))

    merged = merge_items(collected, existing)
    if stable_items(existing) == stable_items(merged[:MAX_ITEMS]):
        print(f"Collected {len(collected)} items, no item changes.")
        if errors:
            print(f"Completed with {len(errors)} source errors.", file=sys.stderr)
        return 0

    payload = {
        "generatedAt": now_iso(),
        "errors": errors[-20:],
        "items": merged[:MAX_ITEMS],
    }
    ITEMS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Collected {len(collected)} items, wrote {len(payload['items'])} items.")
    if errors:
        print(f"Completed with {len(errors)} source errors.", file=sys.stderr)
    return 0


def load_existing_items() -> list[dict]:
    if not ITEMS_PATH.exists():
        return []
    try:
        payload = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return payload.get("items", []) if isinstance(payload, dict) else []


def fetch_google_news(query: str, category: str, errors: list[str], quality_filters: dict) -> list[dict]:
    params = urllib.parse.urlencode({"q": query, "hl": "ja", "gl": "JP", "ceid": "JP:ja"})
    url = f"https://news.google.com/rss/search?{params}"
    return fetch_feed(url, category, f"Google News: {query}", "article", errors, query=query, quality_filters=quality_filters, limit=GOOGLE_NEWS_LIMIT)


def fetch_feed(url: str, category: str, source_name: str, default_type: str, errors: list[str], query: str | None = None, quality_filters: dict | None = None, limit: int | None = None) -> list[dict]:
    try:
        body = request_url(url)
        root = ET.fromstring(body)
    except Exception as exc:
        errors.append(f"{source_name}: {exc}")
        return []

    entries = parse_entries(root)
    items = []
    for entry in entries[: limit or DEFAULT_FEED_LIMIT]:
        title = clean_text(entry.get("title", ""))
        link = normalize_google_news_url(entry.get("link", ""))
        if not title or not link:
            continue
        excerpt = clean_text(entry.get("summary", ""))
        item_source_name = clean_text(entry.get("source_name", "")) or source_name
        item_source_url = entry.get("source_url", "")
        if is_blocked_source(title, link, item_source_name, item_source_url, quality_filters or {}):
            continue
        published_at = parse_date(entry.get("published", ""))
        item_type = classify_type(title, excerpt, default_type)
        item = {
            "id": stable_id(link, title),
            "title": title,
            "url": normalize_url(link),
            "sourceName": item_source_name,
            "category": category,
            "type": item_type,
            "language": detect_language(title, excerpt, query),
            "publishedAt": published_at,
            "fetchedAt": now_iso(),
            "excerpt": excerpt[:420],
            "score": score_item(title, excerpt, item_type, default_type),
            "tags": build_tags(title, excerpt, item_type, query),
        }
        items.append(item)
    return items


def youtube_feed_url(channel: dict, errors: list[str]) -> str | None:
    if channel.get("channelId"):
        return f"https://www.youtube.com/feeds/videos.xml?channel_id={urllib.parse.quote(channel['channelId'])}"

    channel_url = channel.get("url", "")
    if not channel_url:
        errors.append(f"{channel.get('name', 'YouTube')}: missing channelId or url")
        return None

    try:
        body = request_url(channel_url).decode("utf-8", errors="ignore")
    except Exception as exc:
        errors.append(f"{channel.get('name', channel_url)}: {exc}")
        return None

    feed_match = re.search(r'<link[^>]+type=["\']application/rss\+xml["\'][^>]+href=["\']([^"\']+)["\']', body)
    if feed_match:
        return html.unescape(feed_match.group(1))

    id_match = re.search(r'"channelId"\s*:\s*"(UC[^"]+)"', body) or re.search(r"channel/(UC[\w-]+)", body)
    if id_match:
        return f"https://www.youtube.com/feeds/videos.xml?channel_id={urllib.parse.quote(id_match.group(1))}"

    errors.append(f"{channel.get('name', channel_url)}: could not resolve YouTube channel RSS")
    return None


def request_url(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ToolNotesBot/1.0 (+https://github.com/)",
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read()


def parse_entries(root: ET.Element) -> list[dict[str, str]]:
    entries = []
    if root.tag.endswith("rss") or root.find("channel") is not None:
        for item in root.findall("./channel/item"):
            entries.append(
                {
                    "title": text_at(item, "title"),
                    "link": text_at(item, "link"),
                    "summary": text_at(item, "description"),
                    "published": text_at(item, "pubDate"),
                    "source_name": text_at(item, "source"),
                    "source_url": source_url_at(item),
                }
            )
        return entries

    ns = {"atom": "http://www.w3.org/2005/Atom"}
    for entry in root.findall(".//atom:entry", ns):
        link_el = entry.find("atom:link[@rel='alternate']", ns) or entry.find("atom:link", ns)
        entries.append(
            {
                "title": text_at(entry, "atom:title", ns),
                "link": link_el.attrib.get("href", "") if link_el is not None else "",
                "summary": text_at(entry, "atom:summary", ns) or text_at(entry, "atom:content", ns),
                "published": text_at(entry, "atom:published", ns) or text_at(entry, "atom:updated", ns),
                "source_name": "",
                "source_url": "",
            }
        )
    return entries


def text_at(element: ET.Element, path: str, ns: dict[str, str] | None = None) -> str:
    found = element.find(path, ns or {})
    return "".join(found.itertext()).strip() if found is not None else ""


def source_url_at(element: ET.Element) -> str:
    found = element.find("source")
    return found.attrib.get("url", "") if found is not None else ""


def is_blocked_source(title: str, url: str, source_name: str, source_url: str, quality_filters: dict) -> bool:
    name = source_name.lower()
    hostname = hostname_of(source_url or url)
    blocked_names = [value.lower() for value in quality_filters.get("blockedSourceNames", [])]
    blocked_domains = [value.lower() for value in quality_filters.get("blockedDomains", [])]
    if any(blocked in name for blocked in blocked_names):
        return True
    if any(hostname == domain or hostname.endswith(f".{domain}") for domain in blocked_domains):
        return True
    for pattern in quality_filters.get("blockedTitlePatterns", []):
        if re.search(pattern, title, re.IGNORECASE):
            return True
    return False


def hostname_of(url: str) -> str:
    hostname = urllib.parse.urlparse(url).hostname or ""
    return hostname.lower().removeprefix("www.")


def clean_text(value: str) -> str:
    value = html.unescape(value or "")
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def normalize_google_news_url(url: str) -> str:
    # Google News RSS sometimes wraps the destination. Keep the stable Google URL if no direct target is present.
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    for key in ("url", "q"):
        if query.get(key):
            return query[key][0]
    return url


def normalize_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=False)
    query = [(key, value) for key, value in query if key not in TRACKING_PARAMS]
    normalized = parsed._replace(query=urllib.parse.urlencode(query), fragment="")
    return urllib.parse.urlunparse(normalized)


def stable_id(url: str, title: str) -> str:
    key = normalize_url(url) or normalize_title(title)
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def classify_type(title: str, excerpt: str, default_type: str) -> str:
    if default_type == "video":
        return "video"
    text = f"{title} {excerpt}".lower()
    best_type = default_type
    best_hits = 0
    for item_type, keywords in PRACTICAL_KEYWORDS.items():
        hits = sum(1 for keyword in keywords if keyword.lower() in text)
        if hits > best_hits:
            best_type = item_type
            best_hits = hits
    if best_type == "release" and default_type not in {"official", "release"}:
        return "article"
    return best_type


def score_item(title: str, excerpt: str, item_type: str, default_type: str) -> int:
    text = f"{title} {excerpt}".lower()
    score = 40
    score += {"usecase": 22, "tips": 24, "tutorial": 20, "workflow": 24, "video": 15, "article": 8, "official": 4, "release": 0}.get(item_type, 0)
    for keywords in PRACTICAL_KEYWORDS.values():
        score += sum(4 for keyword in keywords if keyword.lower() in text)
    if default_type in {"official", "release"}:
        score -= 12
    if re.search(r"\b(how|why|build|create|automate|template|example)\b", text):
        score += 8
    if re.search(r"(使い方|活用|事例|手順|自動化|テンプレート)", text):
        score += 8
    return max(score, 0)


def build_tags(title: str, excerpt: str, item_type: str, query: str | None) -> list[str]:
    text = f"{title} {excerpt}".lower()
    tags = [item_type]
    if query:
        tags.extend(word for word in re.split(r"\s+", query) if 2 < len(word) < 18)
    for tag, keywords in PRACTICAL_KEYWORDS.items():
        if tag != item_type and any(keyword.lower() in text for keyword in keywords):
            tags.append(tag)
    deduped = []
    for tag in tags:
        normalized = tag.strip("#").strip()
        if normalized and normalized not in deduped:
            deduped.append(normalized)
    return deduped[:6]


def detect_language(title: str, excerpt: str, query: str | None) -> str:
    text = f"{title} {excerpt} {query or ''}"
    return "ja" if re.search(r"[\u3040-\u30ff\u3400-\u9fff]", text) else "en"


def parse_date(value: str) -> str:
    if not value:
        return now_iso()
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        pass
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return now_iso()


def merge_items(new_items: list[dict], existing_items: list[dict]) -> list[dict]:
    by_url = {}
    title_fingerprints = set()
    for item in existing_items + new_items:
        url = normalize_url(item.get("url", ""))
        title_key = normalize_title(item.get("title", ""))
        if not url or not title_key:
            continue
        if url in by_url or title_key in title_fingerprints:
            current = by_url.get(url)
            if current and should_replace_item(current, item):
                item["fetchedAt"] = current.get("fetchedAt", item.get("fetchedAt"))
                by_url[url] = item
            continue
        item["url"] = url
        by_url[url] = item
        title_fingerprints.add(title_key)

    return sorted(
        by_url.values(),
        key=lambda item: (timestamp(item.get("publishedAt")), int(item.get("score", 0))),
        reverse=True,
    )


def should_replace_item(current: dict, candidate: dict) -> bool:
    if candidate.get("score", 0) > current.get("score", 0):
        return True
    if not current.get("excerpt") and candidate.get("excerpt"):
        return True
    return False


def stable_items(items: list[dict]) -> list[dict]:
    stable = []
    for item in items[:MAX_ITEMS]:
        stable.append(
            {
                key: item.get(key)
                for key in (
                    "id",
                    "title",
                    "url",
                    "sourceName",
                    "category",
                    "type",
                    "language",
                    "publishedAt",
                    "excerpt",
                    "score",
                    "tags",
                )
            }
        )
    return stable


def normalize_title(title: str) -> str:
    title = clean_text(title).lower()
    title = re.sub(r"[-–—|｜].*$", "", title)
    title = re.sub(r"[^\w\u3040-\u30ff\u3400-\u9fff]+", " ", title)
    return " ".join(title.split())[:96]


def timestamp(value: str | None) -> float:
    if not value:
        return 0
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    raise SystemExit(main())
