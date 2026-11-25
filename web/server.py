import os
import re
import json
import base64
import io
import time
from datetime import datetime
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
try:
    from rapidocr_onnxruntime import RapidOCR
except ImportError:
    RapidOCR = None
try:
    from PIL import Image
except ImportError:
    Image = None

# Initialize PaddleOCR engine
ocr_engine = RapidOCR() if RapidOCR else None

WEB_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(WEB_DIR, "data")
INBOX_FILE = os.path.join(DATA_DIR, "inbox.json")
MEMORIES_FILE = os.path.join(DATA_DIR, "memories.json")
DELETED_FILE = os.path.join(DATA_DIR, "deleted.json")
os.makedirs(DATA_DIR, exist_ok=True)

if not os.path.exists(INBOX_FILE):
    with open(INBOX_FILE, "w", encoding="utf-8") as f:
        json.dump([], f)

if not os.path.exists(MEMORIES_FILE):
    with open(MEMORIES_FILE, "w", encoding="utf-8") as f:
        json.dump({}, f)

def read_inbox():
    try:
        if os.path.exists(INBOX_FILE):
            with open(INBOX_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        print("[Inbox Read Error]", e)
    return []

def write_inbox(items):
    try:
        with open(INBOX_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print("[Inbox Write Error]", e)

def read_memories():
    try:
        if os.path.exists(MEMORIES_FILE):
            with open(MEMORIES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                demo_ids = {"lion", "tables", "youattract", "fran", "tryagain", "givingup", "orange_silhouette", "studio", "believe", "redbull"}
                raw_dict = data if isinstance(data, dict) else {m["id"]: m for m in data if "id" in m}
                return {k: v for k, v in raw_dict.items() if k not in demo_ids and not (isinstance(v, dict) and v.get("isDemo"))}
    except Exception as e:
        print("[Memories Read Error]", e)
    return {}

def write_memories(mem_dict):
    try:
        with open(MEMORIES_FILE, "w", encoding="utf-8") as f:
            json.dump(mem_dict, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print("[Memories Write Error]", e)

# ── High-Precision Web & Product Scraper ──
class MetaScraper(HTMLParser):
    def __init__(self, base_url):
        super().__init__()
        self.base_url = base_url
        self.title = ""
        self.og_title = ""
        self.h1_title = ""
        self.meta_tags = {}
        self.json_ld = []
        self.img_candidates = []
        self.in_title = False
        self.in_h1 = False
        self.in_script_ld = False
        self.current_script_text = ""
        self.has_article_tag = False
        self.in_p = False
        self.current_p_text = ""
        self.paragraphs = []
        self.p_count = 0
        self.in_price_el = False
        self.price_texts = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = {k.lower(): v for k, v in attrs if v is not None}
        cls = attrs_dict.get("class", "").lower()
        itemprop = attrs_dict.get("itemprop", "").lower()
        data_test = attrs_dict.get("data-test", "").lower()
        el_id = attrs_dict.get("id", "").lower()

        if tag == "title":
            self.in_title = True
        elif tag == "h1":
            self.in_h1 = True
        elif tag == "article" or attrs_dict.get("role") == "article":
            self.has_article_tag = True
        elif tag == "p" or tag in ["h2", "h3"]:
            if self.in_p:
                self._flush_p()
            self.in_p = True
            self.current_p_text = ""
        elif tag == "script" and attrs_dict.get("type") == "application/ld+json":
            self.in_script_ld = True
            self.current_script_text = ""
        elif tag == "meta":
            prop = attrs_dict.get("property") or attrs_dict.get("name") or ""
            content = attrs_dict.get("content") or ""
            if prop:
                self.meta_tags[prop.lower()] = content
        elif tag == "img":
            # Extract highest res attribute
            src = (
                attrs_dict.get("data-old-hires") or
                attrs_dict.get("data-zoom-image") or
                attrs_dict.get("data-highres-image") or
                attrs_dict.get("src") or
                attrs_dict.get("data-src") or ""
            )
            # Check Amazon dynamic image JSON
            if attrs_dict.get("data-a-dynamic-image"):
                try:
                    dyn = json.loads(attrs_dict["data-a-dynamic-image"])
                    if isinstance(dyn, dict) and dyn:
                        urls = sorted(dyn.keys(), key=lambda u: dyn[u][0] * dyn[u][1], reverse=True)
                        if urls:
                            src = urls[0]
                except Exception:
                    pass

            if src and not src.lower().endswith(".svg") and not "data:image/svg" in src.lower():
                lower_src = src.lower()
                skip_words = ["avatar", "logo", "icon", "blank", "tracking", "beacon", "pixel", "badge", "shackle", "protection", "button", "arrow", "20px-", "30px-", "40px-", "50px-"]
                if not any(skip in lower_src for skip in skip_words):
                    w = attrs_dict.get("width")
                    h = attrs_dict.get("height")
                    is_too_small = False
                    try:
                        if w and int(w) < 120: is_too_small = True
                        if h and int(h) < 120: is_too_small = True
                    except Exception:
                        pass
                    if not is_too_small:
                        self.img_candidates.append(urllib.parse.urljoin(self.base_url, src))

        # Detect elements likely containing price
        if any(keyword in cls or keyword in itemprop or keyword in data_test or keyword in el_id for keyword in [
            "price", "pip-temp-price", "pip-price", "v-price-box", "vip-price", "pdp-price", "a-offscreen", "sale-price"
        ]):
            self.in_price_el = True

    def _flush_p(self):
        p_clean = self.current_p_text.strip()
        if len(p_clean) > 28:
            lower_p = p_clean.lower()
            boilerplate = [
                "cookie policy", "terms of use", "privacy policy", "all rights reserved",
                "sign up for", "subscribe to", "advertisement", "sponsored content",
                "follow us on", "share this article", "comments (", "leave a reply",
                "read more:", "related articles", "recommended stories"
            ]
            if not any(b in lower_p for b in boilerplate):
                self.p_count += 1
                self.paragraphs.append(p_clean)
        self.current_p_text = ""

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        elif tag == "h1":
            self.in_h1 = False
        elif tag == "p" or tag in ["h2", "h3"]:
            self.in_p = False
            self._flush_p()
        elif tag == "script" and self.in_script_ld:
            self.in_script_ld = False
            try:
                data = json.loads(self.current_script_text)
                self.json_ld.append(data)
            except Exception:
                pass
        if self.in_price_el:
            self.in_price_el = False

    def handle_data(self, data):
        if self.in_title and not self.title:
            self.title = data.strip()
        elif self.in_h1 and not self.h1_title:
            self.h1_title = data.strip()
        elif self.in_p:
            self.current_p_text += " " + data
        elif self.in_script_ld:
            self.current_script_text += data
        elif self.in_price_el:
            self.price_texts.append(data.strip())

def upgrade_image_url_to_max_res(url):
    if not url or not isinstance(url, str):
        return url
    u = url.strip()
    # 1. Amazon: strip thumbnail dimensions/tokens to get original uncompressed master
    if "media-amazon.com" in u or "images-amazon.com" in u or "ssl-images-amazon" in u:
        u = re.sub(r"\._[A-Z0-9_,]+_\.([a-zA-Z]+)(\?.*)?$", r".\1\2", u, flags=re.I)
    # 2. Flipkart: upgrade thumbnail dimensions to high-res (1664x1664)
    elif "flixcart.com" in u:
        u = re.sub(r"/image/\d+/\d+/", r"/image/1664/1664/", u)
    # 3. Shopify: upgrade thumbnail suffixes (_small, _medium, _compact, etc.) to 2048x2048
    elif "cdn.shopify.com" in u:
        u = re.sub(r"_(?:pico|icon|thumb|small|compact|medium|large|grande|\d+x\d+)\.([a-zA-Z]+)(\?.*)?$", r"_2048x2048.\1\2", u, flags=re.I)
    # 4. Walmart: upgrade odnHeight & odnWidth to 1200
    elif "walmartimages.com" in u:
        u = re.sub(r"odnHeight=\d+&odnWidth=\d+", r"odnHeight=1200&odnWidth=1200", u)
    # 5. Target / Scene7: upgrade width and height
    elif "scene7.com" in u or "target.com" in u:
        u = re.sub(r"wid=\d+&hei=\d+", r"wid=1200&hei=1200", u)
    # 6. Myntra: upgrade dynamic transform to high-res
    elif "myntassets.com" in u:
        u = re.sub(r"/h_\d+,q_\d+,w_\d+/", r"/h_1440,q_95,w_1080/", u)
    # 7. AliExpress / Taobao: strip dimension suffix
    elif "alicdn.com" in u:
        u = re.sub(r"_\d+x\d+\.([a-zA-Z]+)(\?.*)?$", r".\1\2", u, flags=re.I)
    # 8. Generic thumbnail suffixes
    else:
        u = re.sub(r"[-_](?:thumb|thumbnail|small|preview|min)\.([a-zA-Z]+)(\?.*)?$", r".\1\2", u, flags=re.I)
    return u


def scrape_url_meta(url):
    domain = urllib.parse.urlparse(url).netloc.lower().replace("www.", "")

    # 1. Direct video file check (.mp4, .webm, .mov, .mkv, .m4v, .ogv)
    if re.search(r'\.(mp4|webm|mov|mkv|m4v|ogv)(\?.*)?$', url, re.I):
        filename = os.path.basename(urllib.parse.urlparse(url).path)
        return {
            "title": filename or "Video",
            "description": f"Video file ({domain})",
            "heroImg": "",
            "price": "",
            "isVideo": True,
            "isBuying": False,
            "isArticle": False,
            "videoFileUrl": url,
            "domain": domain,
            "url": url,
            "tags": ["video", domain]
        }

    # 1b. Direct PDF document check
    if re.search(r'\.pdf(\?.*)?$', url, re.I):
        filename = os.path.basename(urllib.parse.urlparse(url).path)
        clean_name = os.path.splitext(filename)[0].replace("-", " ").replace("_", " ")
        return {
            "title": clean_name or "PDF Document",
            "description": f"PDF document ({domain})",
            "heroImg": "",
            "price": "",
            "isDocument": True,
            "isPDF": True,
            "docType": "pdf",
            "pdfUrl": url,
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": domain,
            "url": url,
            "tags": ["document", "pdf", domain]
        }

    # 1c. Direct Excel / Spreadsheet / CSV check
    if re.search(r'\.(xlsx|xls|csv|tsv|ods)(\?.*)?$', url, re.I) or "docs.google.com/spreadsheets" in url:
        filename = os.path.basename(urllib.parse.urlparse(url).path)
        ext = os.path.splitext(filename)[1].lower().replace(".", "") or "sheet"
        clean_name = os.path.splitext(filename)[0].replace("-", " ").replace("_", " ")
        return {
            "title": clean_name or "Spreadsheet",
            "description": f"{ext.upper()} spreadsheet ({domain})",
            "heroImg": "",
            "price": "",
            "isDocument": True,
            "isSpreadsheet": True,
            "docType": ext,
            "sheetUrl": url,
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": domain,
            "url": url,
            "tags": ["document", "spreadsheet", ext, domain]
        }

    # 1d. arXiv & Academic Research Papers (arxiv.org/abs/... or arxiv.org/pdf/...)
    arxiv_match = re.search(r'arxiv\.org\/(abs|pdf)\/([0-9]+\.[0-9]+|[a-z\-]+(\.[A-Z]{2})?\/[0-9]+)', url, re.I)
    if arxiv_match:
        arxiv_id = arxiv_match.group(2).replace(".pdf", "")
        abs_url = f"https://arxiv.org/abs/{arxiv_id}"
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        title = f"arXiv:{arxiv_id} Research Paper"
        authors = []
        abstract = ""
        tags = ["document", "paper", "research", "arxiv"]
        try:
            req = urllib.request.Request(abs_url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})
            with urllib.request.urlopen(req, timeout=6) as resp:
                html = resp.read().decode("utf-8", errors="ignore")
                m_title = re.search(r'<meta name="citation_title" content="([^"]+)"', html)
                if m_title:
                    title = m_title.group(1).strip()
                m_authors = re.findall(r'<meta name="citation_author" content="([^"]+)"', html)
                if m_authors:
                    authors = m_authors[:6]
                m_abs = re.search(r'<meta name="citation_abstract" content="([^"]+)"', html)
                if m_abs:
                    abstract = m_abs.group(1).strip()
                elif 'class="abstract mathjax"' in html:
                    m_abs2 = re.search(r'<blockquote class="abstract mathjax"><span class="descriptor">Abstract:</span>\s*([^<]+)', html)
                    if m_abs2:
                        abstract = m_abs2.group(1).strip()
                m_cats = re.search(r'<td class="tablecell subjects">([^<]+)', html)
                if m_cats:
                    for c in m_cats.group(1).split(";"):
                        c_clean = c.strip().lower()
                        if c_clean and len(c_clean) < 30:
                            tags.append(c_clean)
        except Exception:
            pass

        author_str = ", ".join(authors) if authors else "arXiv"
        return {
            "title": title,
            "description": abstract or f"Research paper by {author_str}",
            "author": author_str,
            "publication": "arXiv.org",
            "heroImg": "",
            "price": "",
            "isDocument": True,
            "isPDF": True,
            "isResearchPaper": True,
            "docType": "paper",
            "pdfUrl": pdf_url,
            "arxivId": arxiv_id,
            "abstract": abstract,
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": "arxiv.org",
            "url": abs_url,
            "paragraphs": [abstract] if abstract else [],
            "tags": list(dict.fromkeys(tags))
        }

    # 1e. Social Posts (Twitter/X, Reddit, LinkedIn, Threads, Bluesky, Instagram)
    # Twitter / X Post Detection
    x_match = re.search(r'(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/([0-9]+)', url, re.I)
    if x_match:
        screen_name = x_match.group(1)
        tweet_id = x_match.group(2)
        author_name = screen_name
        handle = f"@{screen_name}"
        avatar_url = ""
        tweet_text = ""
        media_img = ""
        likes = 0
        retweets = 0
        replies = 0

        # Try api.fxtwitter.com
        try:
            fx_req = urllib.request.Request(f"https://api.fxtwitter.com/{screen_name}/status/{tweet_id}", headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(fx_req, timeout=5) as fx_resp:
                fx_data = json.loads(fx_resp.read().decode("utf-8"))
                if fx_data.get("code") == 200 and "tweet" in fx_data:
                    tw = fx_data["tweet"]
                    author_obj = tw.get("author", {})
                    author_name = author_obj.get("name") or screen_name
                    handle = f"@{author_obj.get('screen_name') or screen_name}"
                    avatar_url = author_obj.get("avatar_url", "")
                    tweet_text = tw.get("text", "")
                    likes = tw.get("likes", 0)
                    retweets = tw.get("retweets", 0)
                    replies = tw.get("replies", 0)
                    photos = tw.get("media", {}).get("photos", [])
                    if photos and isinstance(photos, list):
                        media_img = photos[0].get("url", "")
                    elif tw.get("media", {}).get("videos"):
                        media_img = tw["media"]["videos"][0].get("thumbnail_url", "")
        except Exception:
            pass

        # Fallback to Twitter oEmbed
        if not tweet_text:
            try:
                oe_req = urllib.request.Request(f"https://publish.twitter.com/oembed?url={urllib.parse.quote(url)}&omit_script=true", headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(oe_req, timeout=5) as oe_resp:
                    oe_data = json.loads(oe_resp.read().decode("utf-8"))
                    author_name = oe_data.get("author_name", author_name)
                    html_snippet = oe_data.get("html", "")
                    p_match = re.search(r'<p[^>]*>(.*?)</p>', html_snippet, re.DOTALL)
                    if p_match:
                        tweet_text = re.sub(r'<[^>]+>', '', p_match.group(1)).strip()
            except Exception:
                pass

        card_title = f"{author_name} on X"
        if tweet_text:
            short_txt = (tweet_text[:60] + "…") if len(tweet_text) > 60 else tweet_text
            card_title = f"{author_name}: \"{short_txt}\""

        return {
            "title": card_title,
            "description": tweet_text or f"Post by {handle} on X",
            "author": author_name,
            "publication": "X (Twitter)",
            "heroImg": media_img,
            "price": "",
            "isSocial": True,
            "socialPlatform": "x",
            "socialPlatformLabel": "𝕏 Post",
            "socialAuthorName": author_name,
            "socialHandle": handle,
            "socialAvatar": avatar_url,
            "socialText": tweet_text,
            "socialMediaUrl": media_img,
            "socialLikes": likes,
            "socialReposts": retweets,
            "socialReplies": replies,
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": domain,
            "url": url,
            "paragraphs": [tweet_text] if tweet_text else [],
            "tags": ["social", "x", "twitter", screen_name.lower()]
        }

    # Reddit Post Detection
    reddit_match = re.search(r'reddit\.com\/r\/([a-zA-Z0-9_]+)(?:\/comments\/([a-zA-Z0-9]+)(?:\/([a-zA-Z0-9_]+)?)?)?', url, re.I)
    if reddit_match:
        subreddit = f"r/{reddit_match.group(1)}"
        slug = reddit_match.group(3) or ""
        post_title = " ".join([w.capitalize() for w in slug.split("_") if w]) if slug else f"Reddit Discussion in {subreddit}"
        return {
            "title": f"{post_title} - {subreddit}",
            "description": f"Reddit discussion in {subreddit}",
            "author": subreddit,
            "publication": "Reddit",
            "heroImg": "",
            "price": "",
            "isSocial": True,
            "socialPlatform": "reddit",
            "socialPlatformLabel": "Reddit",
            "socialAuthorName": subreddit,
            "socialHandle": subreddit,
            "socialAvatar": "",
            "socialText": post_title,
            "socialMediaUrl": "",
            "socialLikes": 0,
            "socialReposts": 0,
            "socialReplies": 0,
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": domain,
            "url": url,
            "paragraphs": [post_title],
            "tags": ["social", "reddit", reddit_match.group(1).lower()]
        }

    # LinkedIn Post Detection
    if "linkedin.com" in domain and ("/posts/" in url or "/feed/update/" in url or "/pulse/" in url):
        return {
            "title": "LinkedIn Post",
            "description": f"LinkedIn professional post ({domain})",
            "author": "LinkedIn",
            "publication": "LinkedIn",
            "heroImg": "",
            "price": "",
            "isSocial": True,
            "socialPlatform": "linkedin",
            "socialPlatformLabel": "LinkedIn",
            "socialAuthorName": "LinkedIn",
            "socialHandle": "LinkedIn",
            "socialAvatar": "",
            "socialText": "",
            "socialMediaUrl": "",
            "socialLikes": 0,
            "socialReposts": 0,
            "socialReplies": 0,
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": domain,
            "url": url,
            "tags": ["social", "linkedin"]
        }

    # Threads Post Detection
    threads_match = re.search(r'threads\.net\/@([a-zA-Z0-9_.]+)(?:\/post\/([a-zA-Z0-9_-]+))?', url, re.I)
    if threads_match:
        th_handle = f"@{threads_match.group(1)}"
        return {
            "title": f"Post by {th_handle} on Threads",
            "description": f"Post by {th_handle} on Threads",
            "author": threads_match.group(1),
            "publication": "Threads",
            "heroImg": "",
            "price": "",
            "isSocial": True,
            "socialPlatform": "threads",
            "socialPlatformLabel": "Threads",
            "socialAuthorName": threads_match.group(1),
            "socialHandle": th_handle,
            "socialAvatar": "",
            "socialText": "",
            "socialMediaUrl": "",
            "socialLikes": 0,
            "socialReposts": 0,
            "socialReplies": 0,
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": domain,
            "url": url,
            "tags": ["social", "threads", threads_match.group(1).lower()]
        }

    # Bluesky Post Detection
    bsky_match = re.search(r'bsky\.app\/profile\/([a-zA-Z0-9_.]+)\/post\/([a-zA-Z0-9_-]+)', url, re.I)
    if bsky_match:
        bsky_handle = f"@{bsky_match.group(1)}"
        return {
            "title": f"Post by {bsky_handle} on Bluesky",
            "description": f"Post by {bsky_handle} on Bluesky",
            "author": bsky_match.group(1),
            "publication": "Bluesky",
            "heroImg": "",
            "price": "",
            "isSocial": True,
            "socialPlatform": "bluesky",
            "socialPlatformLabel": "Bluesky",
            "socialAuthorName": bsky_match.group(1),
            "socialHandle": bsky_handle,
            "socialAvatar": "",
            "socialText": "",
            "socialMediaUrl": "",
            "socialLikes": 0,
            "socialReposts": 0,
            "socialReplies": 0,
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": domain,
            "url": url,
            "tags": ["social", "bluesky", bsky_match.group(1).lower()]
        }

    # Instagram Post Detection
    if "instagram.com" in domain and ("/p/" in url or "/reel/" in url):
        return {
            "title": "Instagram Post",
            "description": f"Post on Instagram ({domain})",
            "author": "Instagram",
            "publication": "Instagram",
            "heroImg": "",
            "price": "",
            "isSocial": True,
            "socialPlatform": "instagram",
            "socialPlatformLabel": "Instagram",
            "socialAuthorName": "Instagram",
            "socialHandle": "@instagram",
            "socialAvatar": "",
            "socialText": "",
            "socialMediaUrl": "",
            "socialLikes": 0,
            "socialReposts": 0,
            "socialReplies": 0,
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": domain,
            "url": url,
            "tags": ["social", "instagram"]
        }

    # 2. YouTube Video Detection (watch?v=, youtu.be/, /shorts/, /embed/)
    yt_match = re.search(r'(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})', url)
    if yt_match:
        video_id = yt_match.group(1)
        embed_url = f"https://www.youtube-nocookie.com/embed/{video_id}"
        hero_img = f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"
        title = "YouTube Video"
        author = "YouTube"
        desc = ""
        extra_tags = []

        # 1. Primary oEmbed API
        try:
            oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
            oe_req = urllib.request.Request(oembed_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(oe_req, timeout=6) as oe_resp:
                oe_data = json.loads(oe_resp.read().decode("utf-8"))
                title = oe_data.get("title", title)
                author = oe_data.get("author_name", author)
                desc = f"Video by {author} on YouTube"
                if oe_data.get("thumbnail_url"):
                    hero_img = oe_data.get("thumbnail_url")
        except Exception:
            pass

        # 2. Scrape watch page for rich description, meta keywords, and content details
        try:
            watch_url = f"https://www.youtube.com/watch?v={video_id}"
            page_req = urllib.request.Request(watch_url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})
            with urllib.request.urlopen(page_req, timeout=5) as p_resp:
                html = p_resp.read().decode("utf-8", errors="ignore")
                m_title = re.search(r'<meta name="title" content="([^"]+)"', html)
                if m_title and m_title.group(1).strip():
                    title = m_title.group(1).strip()
                m_desc = re.search(r'<meta name="description" content="([^"]+)"', html)
                if m_desc and m_desc.group(1).strip():
                    desc = m_desc.group(1).strip()
                m_kw = re.search(r'<meta name="keywords" content="([^"]+)"', html)
                if m_kw:
                    raw_kws = [k.strip().lower() for k in m_kw.group(1).split(",") if k.strip() and len(k.strip()) < 35]
                    extra_tags.extend(raw_kws[:12])
        except Exception:
            pass

        # 3. Topic classification: detect what the video is about
        haystack = f"{title} {author} {desc} {' '.join(extra_tags)}".lower()
        topic_tags = ["video", "youtube"]
        if author and author != "YouTube":
            topic_tags.append(author.lower())

        if any(w in haystack for w in ["music", "song", "audio", "lyrics", "remaster", "album", "artist", "singer", "pop", "rock", "rap", "hip hop", "soundtrack", "official video", "4k remaster"]):
            topic_tags.extend(["music", "song"])
        if any(w in haystack for w in ["game", "gaming", "gameplay", "walkthrough", "trailer", "ps5", "xbox", "nintendo", "gta"]):
            topic_tags.extend(["gaming", "gameplay"])
        if any(w in haystack for w in ["tutorial", "how to", "guide", "course", "learn", "coding", "code", "programming", "python", "javascript", "developer"]):
            topic_tags.extend(["tutorial", "education"])
        if any(w in haystack for w in ["podcast", "interview", "talk", "conversation", "documentary", "discussion"]):
            topic_tags.extend(["podcast", "interview"])
        if any(w in haystack for w in ["movie", "film", "cinema", "trailer", "teaser", "scene"]):
            topic_tags.extend(["movie", "film"])
        if any(w in haystack for w in ["tech", "technology", "review", "unboxing", "apple", "gadget", "software", "ai", "hardware"]):
            topic_tags.extend(["technology", "tech"])
        if any(w in haystack for w in ["comedy", "funny", "meme", "parody", "sketch", "humor"]):
            topic_tags.extend(["comedy", "entertainment"])
        if any(w in haystack for w in ["cooking", "recipe", "food", "chef", "bake", "kitchen"]):
            topic_tags.extend(["food", "cooking"])
        if any(w in haystack for w in ["workout", "fitness", "gym", "exercise", "health", "training"]):
            topic_tags.extend(["fitness", "health"])

        all_tags = list(dict.fromkeys(topic_tags + extra_tags))

        return {
            "title": title,
            "description": desc or f"Video by {author} on YouTube",
            "author": author,
            "publication": "YouTube",
            "heroImg": hero_img,
            "price": "",
            "isVideo": True,
            "videoId": video_id,
            "videoEmbedUrl": embed_url,
            "isBuying": False,
            "isArticle": False,
            "domain": "youtube.com",
            "url": url,
            "paragraphs": [desc] if desc else [],
            "tags": all_tags
        }

    # 2b. Direct audio file check
    if re.search(r'\.(mp3|wav|m4a|aac|ogg|flac|opus)(\?.*)?$', url, re.I):
        filename = os.path.basename(urllib.parse.urlparse(url).path)
        return {
            "title": filename or "Audio Track",
            "description": f"Audio file ({domain})",
            "author": "Audio",
            "publication": domain,
            "heroImg": "",
            "price": "",
            "isAudio": True,
            "isVideo": False,
            "isBuying": False,
            "isArticle": False,
            "audioUrl": url,
            "audioFileUrl": url,
            "domain": domain,
            "url": url,
            "tags": ["audio", "music", domain]
        }

    # 2c. Spotify Detection (Tracks, Albums, Playlists, Podcasts, Shows)
    spotify_match = re.search(r'open\.spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)', url, re.I)
    if spotify_match:
        sp_type = spotify_match.group(1).lower()
        sp_id = spotify_match.group(2)
        embed_url = f"https://open.spotify.com/embed/{sp_type}/{sp_id}?utm_source=generator"
        title = f"Spotify {sp_type.capitalize()}"
        author = "Spotify"
        desc = "Listen on Spotify"
        hero_img = ""
        try:
            oembed_url = f"https://open.spotify.com/oembed?url={urllib.parse.quote(url)}"
            oe_req = urllib.request.Request(oembed_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(oe_req, timeout=5) as oe_resp:
                oe_data = json.loads(oe_resp.read().decode("utf-8"))
                title = oe_data.get("title", title)
                if oe_data.get("thumbnail_url"):
                    hero_img = oe_data.get("thumbnail_url")
                if oe_data.get("iframe_url"):
                    embed_url = oe_data.get("iframe_url")
                desc = f"{title} on Spotify"
        except Exception:
            pass
        return {
            "title": title,
            "description": desc,
            "author": "Spotify",
            "publication": "Spotify",
            "heroImg": hero_img,
            "price": "",
            "isAudio": True,
            "isVideo": False,
            "isBuying": False,
            "isArticle": False,
            "audioProvider": "spotify",
            "audioPlatform": "Spotify",
            "audioType": sp_type,
            "audioId": sp_id,
            "audioEmbedUrl": embed_url,
            "url": url,
            "domain": "spotify.com",
            "tags": ["audio", "music", "spotify", sp_type]
        }

    # 2d. SoundCloud Detection
    sc_match = re.search(r'soundcloud\.com\/([a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+)', url, re.I)
    if sc_match:
        title = "SoundCloud Audio"
        author = "SoundCloud"
        desc = "Listen on SoundCloud"
        hero_img = ""
        embed_url = f"https://w.soundcloud.com/player/?url={urllib.parse.quote(url)}&color=%23ff5500&auto_play=false"
        try:
            oembed_url = f"https://soundcloud.com/oembed?url={urllib.parse.quote(url)}&format=json"
            oe_req = urllib.request.Request(oembed_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(oe_req, timeout=5) as oe_resp:
                oe_data = json.loads(oe_resp.read().decode("utf-8"))
                title = oe_data.get("title", title)
                author = oe_data.get("author_name", author)
                desc = oe_data.get("description", desc)
                if oe_data.get("thumbnail_url"):
                    hero_img = oe_data.get("thumbnail_url")
        except Exception:
            pass
        return {
            "title": title,
            "description": desc,
            "author": author,
            "publication": "SoundCloud",
            "heroImg": hero_img,
            "price": "",
            "isAudio": True,
            "isVideo": False,
            "isBuying": False,
            "isArticle": False,
            "audioProvider": "soundcloud",
            "audioPlatform": "SoundCloud",
            "audioEmbedUrl": embed_url,
            "url": url,
            "domain": "soundcloud.com",
            "tags": ["audio", "music", "soundcloud"]
        }

    # 2e. Apple Music & Apple Podcasts
    if "music.apple.com" in domain or "podcasts.apple.com" in domain:
        embed_url = url.replace("music.apple.com", "embed.music.apple.com").replace("podcasts.apple.com", "embed.podcasts.apple.com")
        is_pod = "podcasts" in domain
        return {
            "title": "Apple Podcast" if is_pod else "Apple Music",
            "description": f"Listen on {domain}",
            "author": "Apple",
            "publication": domain,
            "heroImg": "",
            "price": "",
            "isAudio": True,
            "isVideo": False,
            "isBuying": False,
            "isArticle": False,
            "audioProvider": "applepodcasts" if is_pod else "applemusic",
            "audioPlatform": "Apple Podcasts" if is_pod else "Apple Music",
            "audioEmbedUrl": embed_url,
            "url": url,
            "domain": domain,
            "tags": ["audio", "podcast" if is_pod else "music", "apple"]
        }

    # 3. Vimeo Video Detection
    vimeo_match = re.search(r'vimeo\.com\/(?:video\/)?([0-9]+)', url)
    if vimeo_match:
        video_id = vimeo_match.group(1)
        embed_url = f"https://player.vimeo.com/video/{video_id}"
        title = "Vimeo Video"
        author = "Vimeo"
        hero_img = ""
        desc = ""
        try:
            oembed_url = f"https://vimeo.com/api/oembed.json?url=https://vimeo.com/{video_id}"
            oe_req = urllib.request.Request(oembed_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(oe_req, timeout=6) as oe_resp:
                oe_data = json.loads(oe_resp.read().decode("utf-8"))
                title = oe_data.get("title", title)
                author = oe_data.get("author_name", author)
                hero_img = oe_data.get("thumbnail_url", "")
                desc = oe_data.get("description", f"Video by {author} on Vimeo")
        except Exception:
            pass

        return {
            "title": title,
            "description": desc,
            "author": author,
            "publication": "Vimeo",
            "heroImg": hero_img,
            "price": "",
            "isVideo": True,
            "videoId": video_id,
            "videoEmbedUrl": embed_url,
            "isBuying": False,
            "isArticle": False,
            "domain": "vimeo.com",
            "url": url,
            "paragraphs": [desc] if desc else [],
            "tags": ["video", "vimeo", author]
        }

    # 4. Direct image file check
    if re.search(r'\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?.*)?$', url, re.I):
        return {
            "title": domain or "Image",
            "description": "",
            "heroImg": url,
            "price": "",
            "isBuying": False,
            "isArticle": False,
            "domain": domain,
            "url": url,
            "isDirectImage": True
        }

    shopping_keywords = [
        'ikea.', 'pepperfry.', 'amazon.', 'ebay.', 'etsy.', 'walmart.', 'target.',
        'bestbuy.', 'shopify', 'apple.com', 'nike.com', 'aliexpress.', 'flipkart.',
        'myntra.', 'nykaa.', 'zara.', 'hm.com', 'costco.', 'newegg.', 'wayfair.',
        'cart', 'store', 'shop'
    ]
    is_known_store = any(k in domain for k in shopping_keywords)

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            content_type = resp.headers.get("Content-Type", "").lower()
            if "image/" in content_type:
                return {
                    "title": domain or "Image",
                    "description": "",
                    "heroImg": url,
                    "price": "",
                    "isBuying": False,
                    "isArticle": False,
                    "domain": domain,
                    "url": url,
                    "isDirectImage": True
                }

            charset = "utf-8"
            if "charset=" in content_type:
                charset = content_type.split("charset=")[-1].split(";")[0].strip()

            raw_data = resp.read(1024 * 1024 * 2)  # Read up to 2MB for full article text
            try:
                html_text = raw_data.decode(charset, errors="replace")
            except Exception:
                html_text = raw_data.decode("utf-8", errors="replace")
    except Exception as e:
        return {
            "title": domain,
            "description": str(e),
            "heroImg": "",
            "price": "",
            "isBuying": False,
            "isArticle": False,
            "domain": domain,
            "url": url,
            "error": str(e)
        }

    parser = MetaScraper(url)
    try:
        parser.feed(html_text)
    except Exception:
        pass

    meta = parser.meta_tags
    title = meta.get("og:title") or parser.title or parser.h1_title or domain
    desc = meta.get("og:description") or meta.get("description") or ""

    # OpenGraph image
    og_img = meta.get("og:image:secure_url") or meta.get("og:image") or meta.get("twitter:image") or ""
    if og_img and (og_img.lower().endswith(".svg") or "blank" in og_img.lower()):
        og_img = ""
    if og_img:
        og_img = urllib.parse.urljoin(url, og_img)

    # Price, Product Image and Article extraction from JSON-LD
    price = ""
    json_ld_image = ""
    json_ld_article_body = ""
    json_ld_author = ""

    def process_ld_item(item):
        nonlocal price, json_ld_image, json_ld_article_body, json_ld_author
        if not isinstance(item, dict):
            return
        item_types = [item.get("@type", "")] if isinstance(item.get("@type"), str) else (item.get("@type") or [])
        item_type = str(item.get("@type", ""))

        # Product Image
        if "Product" in item_type or item.get("@type") in ["Product", "IndividualProduct"]:
            img = item.get("image")
            if isinstance(img, list) and img:
                first = img[0]
                json_ld_image = first if isinstance(first, str) else (first.get("url", "") if isinstance(first, dict) else "")
            elif isinstance(img, dict):
                json_ld_image = img.get("url", "")
            elif isinstance(img, str):
                json_ld_image = img

        # Article Body & Author
        if any("Article" in str(t) or str(t) in ["NewsArticle", "BlogPosting", "TechArticle", "Report", "Article"] for t in item_types):
            body = item.get("articleBody") or item.get("text")
            if isinstance(body, str) and len(body.strip()) > 80 and not json_ld_article_body:
                json_ld_article_body = body.strip()
            auth = item.get("author")
            if isinstance(auth, list) and auth:
                auth = auth[0]
            if isinstance(auth, dict) and "name" in auth and not json_ld_author:
                json_ld_author = str(auth["name"])
            elif isinstance(auth, str) and not json_ld_author:
                json_ld_author = auth

        if "offers" in item and not price:
            offers = item["offers"]
            offer = offers[0] if isinstance(offers, list) and offers else offers
            if isinstance(offer, dict) and "price" in offer:
                curr = str(offer.get("priceCurrency", "USD")).upper()
                sym = "$" if curr == "USD" else ("₹" if curr == "INR" else ("€" if curr == "EUR" else ("£" if curr == "GBP" else curr + " ")))
                p_val = offer['price']
                price = f"{sym}{p_val}"

    for ld in parser.json_ld:
        if isinstance(ld, list):
            for item in ld:
                process_ld_item(item)
        elif isinstance(ld, dict):
            if "@graph" in ld and isinstance(ld["@graph"], list):
                for item in ld["@graph"]:
                    process_ld_item(item)
            else:
                process_ld_item(ld)

    # Fallback to meta tags for price
    if not price:
        meta_amount = meta.get("product:price:amount") or meta.get("price:amount")
        meta_curr = str(meta.get("product:price:currency") or meta.get("price:currency") or "USD").upper()
        if meta_amount:
            sym = "$" if meta_curr == "USD" else ("₹" if meta_curr == "INR" else ("€" if meta_curr == "EUR" else ("£" if meta_curr == "GBP" else meta_curr + " ")))
            price = f"{sym}{meta_amount}"

    # Fallback to price DOM elements
    if not price and parser.price_texts:
        for pt in parser.price_texts:
            m = re.search(r'(?:[$€£₹]|Rs\.?)\s*[0-9,]+(?:\.[0-9]{2})?', pt, re.I)
            if m:
                price = m.group(0).strip().replace("Rs.", "₹").replace(" ", "")
                break

    # If known store, check regex in first 50KB if still not found
    if not price and is_known_store:
        m = re.search(r'(?:[$€£₹]|Rs\.?)\s*[0-9,]+(?:\.[0-9]{2})?', html_text[:50000], re.I)
        if m:
            price = m.group(0).strip().replace("Rs.", "₹").replace(" ", "")

    is_buying = is_known_store or bool(price)

    # Hero image priority: JSON-LD Product image -> OpenGraph -> largest img candidate
    hero_img = json_ld_image or og_img
    if not hero_img and parser.img_candidates:
        hero_img = parser.img_candidates[0]
    if hero_img:
        hero_img = urllib.parse.urljoin(url, hero_img)
        hero_img = upgrade_image_url_to_max_res(hero_img)

    article_keywords = [
        'medium.com', 'substack.com', 'wikipedia.org', 'nytimes.com', 'theverge.com',
        'techcrunch.com', 'wired.com', 'bloomberg.com', 'reuters.com', 'bbc.', 'cnn.',
        'dev.to', 'hashnode.', 'github.blog', 'towardsdatascience.com', 'arxiv.org',
        'news', 'blog', 'article', 'post', 'story', 'journal', 'essay'
    ]
    has_article_domain = any(k in domain for k in article_keywords) or any(s in url.lower() for s in ['/article/', '/blog/', '/post/', '/news/', '/story/'])
    og_type = meta.get("og:type", "").lower()
    og_video = meta.get("og:video") or meta.get("og:video:url") or meta.get("og:video:secure_url") or meta.get("twitter:player") or ""
    is_video = bool(og_video or "video" in og_type or any(k in domain for k in ['tiktok.com', 'twitch.tv', 'dailymotion.com', 'loom.com', 'ted.com']))

    is_article = (not is_buying) and (not is_video) and (og_type == "article" or parser.has_article_tag or has_article_domain or parser.p_count >= 2)

    author = meta.get("author") or meta.get("article:author") or meta.get("dc.creator") or meta.get("parsely-author") or json_ld_author or ""
    publication = meta.get("og:site_name") or meta.get("application-name") or domain

    # Build comprehensive full article paragraphs
    article_paras = []
    if json_ld_article_body:
        article_paras = [p.strip() for p in re.split(r'\n\n+|\r\n\r\n+|\n+', json_ld_article_body) if len(p.strip()) > 20]
    if len(article_paras) < 3 and parser.paragraphs:
        article_paras = parser.paragraphs
        if len(article_paras) < 2:
            for p_match in re.finditer(r'<p[^>]*>(.*?)</p>', html_text, re.DOTALL | re.I):
                clean = re.sub(r'<[^>]+>', ' ', p_match.group(1)).strip()
                clean = re.sub(r'\s+', ' ', clean)
                if len(clean) > 28 and clean not in article_paras:
                    article_paras.append(clean)

    return {
        "title": title,
        "description": desc,
        "author": author,
        "publication": publication,
        "heroImg": hero_img,
        "price": price,
        "isVideo": is_video,
        "videoEmbedUrl": og_video if og_video.startswith("http") else "",
        "isBuying": is_buying,
        "isArticle": is_article,
        "domain": domain,
        "url": url,
        "paragraphs": article_paras,
        "articleBody": "\n\n".join(article_paras),
        "tags": (["video"] if is_video else []) + [domain]
    }

def analyze_image_groq(image_data, groq_key=None):
    """
    Ultra-Fast Multimodal Visual Analysis using Groq and qwen/qwen3.8-27b
    Automatically fetches and converts external image URLs to base64 data URIs
    because Groq Vision endpoints strictly reject HTTP/HTTPS URLs.
    """
    key = groq_key or os.environ.get("GROQ_API_KEY")
    if not key or not image_data:
        return None

    formatted_image = image_data
    if image_data.startswith("http://") or image_data.startswith("https://"):
        try:
            req_img = urllib.request.Request(
                image_data,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "image/webp,image/apng,image/*,*/*;q=0.8"
                }
            )
            with urllib.request.urlopen(req_img, timeout=12) as img_resp:
                raw_bytes = img_resp.read()
                content_type = img_resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
                if not content_type.startswith("image/"):
                    content_type = "image/jpeg"
                if Image and len(raw_bytes) > 2 * 1024 * 1024:
                    try:
                        im = Image.open(io.BytesIO(raw_bytes))
                        im.thumbnail((1200, 1200))
                        if im.mode in ("RGBA", "P"):
                            im = im.convert("RGB")
                        buf = io.BytesIO()
                        im.save(buf, format="JPEG", quality=85)
                        raw_bytes = buf.getvalue()
                        content_type = "image/jpeg"
                    except Exception:
                        pass
                b64 = base64.b64encode(raw_bytes).decode("utf-8")
                formatted_image = f"data:{content_type};base64,{b64}"
        except Exception as fetch_err:
            print("[Groq Image Fetch Error]", fetch_err)
            return None

    try:
        url = "https://api.groq.com/openai/v1/chat/completions"
        prompt = (
            "Analyze this image thoroughly for Recall, a visual memory and personal search app.\n"
            "Your objective is to make this image discoverable under ANY relevant search query.\n"
            "Return ONLY a valid strict JSON object (no markdown formatting, no backticks, no surrounding text):\n"
            "{\n"
            '  "title": "A precise, natural title. If a book cover, exact book title + author/volume. If an animal/creature, species + action + environment (e.g. \'Male African Lion Resting on Golden Savanna Grass\'). If a product, exact brand + product. If a photo, primary subject + setting.",\n'
            '  "ocrText": "Extract ALL visible text verbatim. Every single word, book title, author, publisher, quote, subtitle, chapter, brand label, sign, or stamp.",\n'
            '  "tldr": "A detailed 2-3 sentence descriptive caption summarizing the primary subject, secondary elements, physical appearance, colors, lighting, setting/backdrop, actions, and overall mood.",\n'
            '  "tags": ["15-20 lowercase search keywords covering: primary subject, species/category, secondary objects, colors, environment/scene, actions, materials, art style, mood, synonyms (e.g. lion, african-lion, feline, predator, cat, wildlife, savanna, safari, grassland, resting, golden, mane, nature, outdoors, mammal, wild)"],\n'
            '  "isBook": true,\n'
            '  "hasAnimals": true,\n'
            '  "isQuote": false,\n'
            '  "primarySubject": "Specific noun (e.g. lion, book, quote, sneakers)",\n'
            '  "author": "Author name if book or quote, else empty string",\n'
            '  "action": "Action if animal or person is moving (e.g. resting, walking, running, sitting, standing), else empty string",\n'
            '  "scene": "Environment (e.g. savanna, safari, nature, office, studio, outdoors), else empty string"\n'
            "}"
        )
        payload = {
            "model": "qwen/qwen3.8-27b",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": formatted_image}}
                    ]
                }
            ],
            "reasoning_effort": "none",
            "max_completion_tokens": 1024,
            "temperature": 0.1
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {key.strip()}",
                "Content-Type": "application/json",
                "User-Agent": "Recall-App/1.0"
            }
        )
        with urllib.request.urlopen(req, timeout=16) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            content = res_data.get("choices", [{}])[0].get("message", {}).get("content", "")
            if content:
                match = re.search(r"\{[\s\S]*\}", content)
                if match:
                    parsed = json.loads(match.group(0))
                    tags_set = set()
                    for t in parsed.get("tags", []):
                        clean_t = str(t).lower().strip()
                        if clean_t:
                            tags_set.add(clean_t)
                    if parsed.get("primarySubject"):
                        tags_set.add(str(parsed["primarySubject"]).lower().strip())
                    if parsed.get("action"):
                        tags_set.add(str(parsed["action"]).lower().strip())
                    if parsed.get("scene"):
                        tags_set.add(str(parsed["scene"]).lower().strip())
                    parsed["tags"] = list(tags_set)
                    return parsed
    except Exception as e:
        print("[Groq Backend Error]", e)
    return None

class RecallPaddleServer(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        # ── Cross-Browser Shared Memories API ──
        if parsed.path == "/api/memories":
            mems = read_memories()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "memories": list(mems.values())}).encode("utf-8"))
            return

        # ── Extension Inbox Queue ──
        if parsed.path == "/api/inbox":
            query = urllib.parse.parse_qs(parsed.query)
            user_id = query.get("userId", [""])[0]
            items = read_inbox()
            if user_id:
                items = [m for m in items if not m.get("userId") or m.get("userId") == user_id]
            else:
                items = []
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "memories": items}).encode("utf-8"))
            return

        # ── Image Proxy (to allow client canvas pixel reading without CORS restrictions) ──
        if parsed.path == "/api/proxy-image":
            query = urllib.parse.parse_qs(parsed.query)
            target_url = query.get("url", [""])[0]
            if not target_url:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Missing url parameter"}).encode("utf-8"))
                return
            try:
                req = urllib.request.Request(
                    target_url,
                    headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
                )
                with urllib.request.urlopen(req, timeout=12) as resp:
                    c_type = resp.headers.get("Content-Type", "image/jpeg")
                    img_data = resp.read()
                    self.send_response(200)
                    self.send_header("Content-Type", c_type)
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Cache-Control", "public, max-age=86400")
                    self.end_headers()
                    self.wfile.write(img_data)
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        # ── Full Article Extraction Endpoint ──
        if parsed.path == "/api/article-content":
            query = urllib.parse.parse_qs(parsed.query)
            target_url = query.get("url", [""])[0].strip()
            mem_id = query.get("id", [""])[0].strip()
            if not target_url and mem_id:
                mems = read_memories()
                if mem_id in mems:
                    target_url = mems[mem_id].get("source", "")

            if not target_url:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Missing url parameter"}).encode("utf-8"))
                return

            scraped = scrape_url_meta(target_url)
            paras = scraped.get("paragraphs", [])
            body_text = scraped.get("articleBody", "")

            if mem_id and paras:
                try:
                    mems = read_memories()
                    if mem_id in mems:
                        mems[mem_id]["paragraphs"] = paras
                        mems[mem_id]["articleBody"] = body_text
                        if scraped.get("author") and not mems[mem_id].get("author"):
                            mems[mem_id]["author"] = scraped["author"]
                        if scraped.get("publication") and not mems[mem_id].get("publication"):
                            mems[mem_id]["publication"] = scraped["publication"]
                        write_memories(mems)
                except Exception as sync_e:
                    print("[Article Content Sync Error]", sync_e)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "paragraphs": paras,
                "articleBody": body_text,
                "title": scraped.get("title", ""),
                "author": scraped.get("author", ""),
                "publication": scraped.get("publication", "")
            }).encode("utf-8"))
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        # ── 1. Save / Sync Memories Across Browsers ──
        if parsed.path == "/api/memories/save":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode("utf-8"))

                mems = read_memories()
                items = payload.get("memories") if isinstance(payload, dict) and "memories" in payload else (payload if isinstance(payload, list) else [payload])

                for item in items:
                    if item and isinstance(item, dict) and item.get("id"):
                        mems[item["id"]] = item

                write_memories(mems)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "count": len(mems)}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        # ── 2. Delete Memory Across Browsers ──
        if parsed.path == "/api/memories/delete":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode("utf-8")) if post_data else {}

                ids = payload.get("ids") or ([payload["id"]] if "id" in payload else [])
                mems = read_memories()
                for mem_id in ids:
                    mems.pop(mem_id, None)
                write_memories(mems)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        # ── 3. Clear All Memories Across Browsers ──
        if parsed.path == "/api/memories/clear":
            try:
                write_memories({})
                write_inbox([])
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        # ── 3b. AI Groq Vision & Text Analysis ──
        if parsed.path == "/api/ai/groq-analyze":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length).decode("utf-8")) if length > 0 else {}
                img_data = body.get("image", "")
                auth_header = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
                user_key = body.get("apiKey") or auth_header or os.environ.get("GROQ_API_KEY")
                result = analyze_image_groq(img_data, user_key)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "data": result}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        # ── 4. Save Endpoint for "Save to Recall" Extension ──
        if parsed.path == "/api/save":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode("utf-8"))

                now = datetime.now()
                date_str = now.strftime("%b %d, %Y")
                time_str = now.strftime("%b %d, %Y at %I:%M %p")
                mem_id = payload.get("id") or f"ext_{int(time.time() * 1000)}"

                mem_type = payload.get("type", "Web image")
                source = payload.get("source") or payload.get("url") or "Browser Extension"
                title = payload.get("title") or "Saved Memory"
                body = payload.get("body") or payload.get("text") or ""
                hero_img = payload.get("heroImg") or payload.get("image") or ""
                tldr = payload.get("tldr") or body or title
                price = payload.get("price") or ""
                tags = payload.get("tags") or []
                if not isinstance(tags, list):
                    tags = [str(tags)]

                is_buying = bool(payload.get("isBuying") or price)
                is_note = bool(payload.get("isNote") or mem_type.lower() == "note")
                is_video = bool(payload.get("isVideo") or mem_type.lower() == "video" or "video" in tags or any(k in source.lower() for k in ["youtube.com", "youtu.be", "vimeo.com"]))
                is_article = bool((payload.get("isArticle") or mem_type.lower() == "article") and not is_video)

                if is_buying:
                    if "buying" not in tags: tags.append("buying")
                    if "product" not in tags: tags.append("product")
                    if "shop" not in tags: tags.append("shop")
                elif is_video:
                    if "video" not in tags: tags.append("video")
                elif is_article:
                    if "article" not in tags: tags.append("article")
                    if "reading" not in tags: tags.append("reading")

                ocr_text = payload.get("ocrText") or ""
                if not ocr_text and hero_img and hero_img.startswith("data:image"):
                    try:
                        header, base64_str = hero_img.split(",", 1) if "," in hero_img else ("", hero_img)
                        image_bytes = base64.b64decode(base64_str)
                        pil_img = Image.open(io.BytesIO(image_bytes))
                        ocr_result, _ = ocr_engine(pil_img)
                        if ocr_result:
                            ocr_text = "\n".join([item[1] for item in ocr_result])
                    except Exception as ocr_err:
                        print("[Extension Image OCR]", ocr_err)

                memory_item = {
                    "id": mem_id,
                    "type": "Note" if is_note else ("Product" if is_buying else ("Video" if is_video else ("Article" if is_article else mem_type))),
                    "contentType": "Note" if is_note else ("Product" if is_buying else ("Video" if is_video else ("Article" if is_article else "Image"))),
                    "title": title,
                    "date": date_str,
                    "dateDetail": time_str,
                    "tldr": f"{tldr} ({price})" if price and price not in tldr else tldr,
                    "body": body,
                    "ocrText": ocr_text,
                    "source": source,
                    "imageUrl": payload.get("imageUrl") or hero_img or source,
                    "url": payload.get("url") or source,
                    "heroImg": hero_img,
                    "price": price,
                    "palette": payload.get("palette") or ["#1C1C1E", "#48484A", "#8E8E93", "#D1D1D6", "#F2F2F7"],
                    "tags": list(set(["extension", "saved", *tags])),
                    "isNote": is_note,
                    "isBuying": is_buying,
                    "isVideo": is_video,
                    "videoId": payload.get("videoId") or "",
                    "videoEmbedUrl": payload.get("videoEmbedUrl") or "",
                    "videoFileUrl": payload.get("videoFileUrl") or "",
                    "paragraphs": payload.get("paragraphs") or [],
                    "articleBody": payload.get("articleBody") or "",
                    "author": payload.get("author") or "",
                    "publication": payload.get("publication") or "",
                    "subtitle": payload.get("subtitle") or payload.get("description") or "",
                    "isArticle": is_article,
                    "isBook": bool(payload.get("isBook")),
                    "hasAnimals": bool(payload.get("hasAnimals")),
                    "createdAt": int(time.time() * 1000)
                }

                # Auto-scrape video metadata if not provided or if title is generic
                is_generic_video_title = not title or title.strip() in ["Saved Memory", "YouTube Video", "Video", "Saved Page", "Saved Item", source] or title.startswith("http")
                if is_video and source.startswith("http"):
                    try:
                        scraped = scrape_url_meta(source)
                        if scraped.get("isVideo"):
                            memory_item["videoId"] = scraped.get("videoId", "")
                            memory_item["videoEmbedUrl"] = scraped.get("videoEmbedUrl", "")
                            if (is_generic_video_title or memory_item["title"] == "Saved Memory") and scraped.get("title"):
                                memory_item["title"] = scraped["title"]
                            if scraped.get("description"):
                                memory_item["tldr"] = scraped["description"]
                                memory_item["body"] = scraped["description"]
                                memory_item["paragraphs"] = [scraped["description"]]
                            if not memory_item["heroImg"] and scraped.get("heroImg"):
                                memory_item["heroImg"] = scraped["heroImg"]
                            if scraped.get("author") and not memory_item["author"]:
                                memory_item["author"] = scraped["author"]
                            if scraped.get("publication") and not memory_item["publication"]:
                                memory_item["publication"] = scraped["publication"]
                            if scraped.get("tags"):
                                memory_item["tags"] = list(dict.fromkeys(memory_item["tags"] + scraped["tags"]))
                    except Exception as v_err:
                        print("[Auto Video Scrape]", v_err)

                # Auto-scrape full article content if not supplied by client
                if is_article and not memory_item["paragraphs"] and source.startswith("http"):
                    try:
                        scraped = scrape_url_meta(source)
                        if scraped.get("paragraphs"):
                            memory_item["paragraphs"] = scraped["paragraphs"]
                            memory_item["articleBody"] = scraped.get("articleBody", "")
                            if not memory_item["heroImg"] and scraped.get("heroImg"):
                                memory_item["heroImg"] = scraped["heroImg"]
                            if not memory_item["author"] and scraped.get("author"):
                                memory_item["author"] = scraped["author"]
                            if not memory_item["publication"] and scraped.get("publication"):
                                memory_item["publication"] = scraped["publication"]
                    except Exception as s_err:
                        print("[Auto Full Article Scrape]", s_err)

                # Enrich with Groq Vision if image is present (skip for products to preserve exact page info)
                groq_key = payload.get("apiKey") or self.headers.get("Authorization", "").replace("Bearer ", "").strip() or os.environ.get("GROQ_API_KEY")
                if hero_img and groq_key and not is_buying:
                    groq_res = analyze_image_groq(hero_img, groq_key)
                    if groq_res:
                        curr_title = memory_item.get("title", "")
                        is_noisy_title = (
                            not curr_title or
                            curr_title in ["Saved Memory", "Web image", "Pasted Image", "Saved Item", "Pasted Screenshot"] or
                            "Google Search" in curr_title or
                            "Google Images" in curr_title or
                            "gstatic.com" in curr_title or
                            curr_title.startswith("mem_") or
                            curr_title.startswith("ext_")
                        )
                        if groq_res.get("title") and (is_noisy_title or len(groq_res.get("title", "")) > len(curr_title)):
                            memory_item["title"] = groq_res["title"]
                        if groq_res.get("tldr"):
                            memory_item["tldr"] = groq_res["tldr"]
                        if groq_res.get("ocrText"):
                            memory_item["ocrText"] = groq_res["ocrText"]
                        if groq_res.get("isBook"):
                            memory_item["isBook"] = True
                            memory_item["type"] = "Book"
                            memory_item["contentType"] = "Book"
                            memory_item["isQuote"] = False
                        if groq_res.get("hasAnimals"):
                            memory_item["hasAnimals"] = True
                            memory_item["isQuote"] = False
                            memory_item["type"] = "Web image"
                            memory_item["contentType"] = "Image"
                            memory_item.pop("quote", None)
                        elif not groq_res.get("isQuote") and not memory_item.get("isBook"):
                            memory_item["isQuote"] = False
                            memory_item["type"] = "Web image"
                            memory_item["contentType"] = "Image"
                            memory_item.pop("quote", None)
                        if groq_res.get("tags"):
                            existing_tags = set(memory_item.get("tags", []))
                            for t in groq_res["tags"]:
                                existing_tags.add(str(t).lower())
                            memory_item["tags"] = list(existing_tags)

                # Save directly into central memories
                mems = read_memories()
                mems[mem_id] = memory_item
                write_memories(mems)

                # Also place in inbox queue for active web clients
                inbox = read_inbox()
                inbox.insert(0, memory_item)
                write_inbox(inbox)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "id": mem_id,
                    "memory": memory_item,
                    "message": "Saved to Recall"
                }).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        # ── 5. Acknowledge / Drain Inbox Queue ──
        if parsed.path == "/api/inbox/ack":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode("utf-8")) if post_data else {}
                ack_ids = set(payload.get("ids", []))
                user_id = payload.get("userId")

                inbox = read_inbox()
                if ack_ids:
                    inbox = [m for m in inbox if m.get("id") not in ack_ids]
                elif user_id:
                    inbox = [m for m in inbox if m.get("userId") != user_id]
                else:
                    inbox = []
                write_inbox(inbox)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        # ── 6. PaddleOCR API ──
        if parsed.path == "/api/ocr":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode("utf-8"))

                img_data_url = payload.get("image")
                img_path = payload.get("imagePath")

                image_to_process = None
                if img_path and os.path.exists(img_path):
                    image_to_process = img_path
                elif img_data_url:
                    if "," in img_data_url:
                        header, base64_str = img_data_url.split(",", 1)
                    else:
                        base64_str = img_data_url
                    image_bytes = base64.b64decode(base64_str)
                    image_to_process = Image.open(io.BytesIO(image_bytes))

                if image_to_process is not None:
                    ocr_result, elapse = ocr_engine(image_to_process)
                    lines = []
                    if ocr_result:
                        for item in ocr_result:
                            box, text, score = item
                            lines.append({
                                "text": text,
                                "score": float(score),
                                "box": [[float(pt[0]), float(pt[1])] for pt in box]
                            })
                    full_text = "\n".join([l["text"] for l in lines])
                    response = {
                        "success": True,
                        "engine": "PaddleOCR (PP-OCRv4)",
                        "text": full_text,
                        "lines": lines,
                        "elapse": elapse
                    }
                else:
                    response = {"success": False, "error": "No image data provided"}

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(response).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        # ── 7. URL Content & Metadata Scraper (E-Commerce, Articles, Images) ──
        if parsed.path == "/api/scrape-url":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode("utf-8")) if post_data else {}
                url = payload.get("url", "").strip()

                if not url:
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": "No URL provided"}).encode("utf-8"))
                    return

                # Perform high-precision scrape
                scraped_data = scrape_url_meta(url)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "data": scraped_data
                }).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        super().do_POST()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

if __name__ == "__main__":
    port = 8088
    server = ThreadingHTTPServer(("0.0.0.0", port), RecallPaddleServer)
    print(f"Recall Web Server with PaddleOCR running on http://localhost:{port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        server.server_close()
