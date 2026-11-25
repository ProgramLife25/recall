import os
import re
import json
import base64
import io
import tempfile
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler

try:
    from PIL import Image
except ImportError:
    Image = None

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
        elif tag in ["p", "h2", "h3"]:
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
            src = (
                attrs_dict.get("data-old-hires") or
                attrs_dict.get("data-zoom-image") or
                attrs_dict.get("data-highres-image") or
                attrs_dict.get("src") or
                attrs_dict.get("data-src") or ""
            )
            if attrs_dict.get("data-a-dynamic-image"):
                try:
                    dyn = json.loads(attrs_dict["data-a-dynamic-image"])
                    if isinstance(dyn, dict) and dyn:
                        urls = sorted(dyn.keys(), key=lambda u: dyn[u][0] * dyn[u][1], reverse=True)
                        if urls:
                            src = urls[0]
                except Exception:
                    pass

            if src and not src.lower().endswith(".svg") and "data:image/svg" not in src.lower():
                lower_src = src.lower()
                skip_words = ["avatar", "logo", "icon", "blank", "tracking", "beacon", "pixel", "badge", "shackle", "protection", "button", "arrow"]
                if not any(skip in lower_src for skip in skip_words):
                    self.img_candidates.append(urllib.parse.urljoin(self.base_url, src))

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
        elif tag in ["p", "h2", "h3"]:
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

    # 1. Direct video file check
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

    # 1e. Code Files, GitHub Repositories, Gists, and Code Snippets
    # 1e-1. GitHub File / Blob URL
    gh_blob_match = re.search(r'github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)', url, re.I)
    if gh_blob_match:
        owner = gh_blob_match.group(1)
        repo = gh_blob_match.group(2)
        branch = gh_blob_match.group(3)
        filepath = gh_blob_match.group(4)
        filename = os.path.basename(filepath)
        ext = os.path.splitext(filename)[1].lower().replace(".", "")
        lang_map = {
            "py": "Python", "js": "JavaScript", "ts": "TypeScript", "tsx": "TypeScript React", "jsx": "JavaScript React",
            "rs": "Rust", "go": "Go", "cpp": "C++", "c": "C", "h": "C/C++", "hpp": "C++", "java": "Java",
            "kt": "Kotlin", "swift": "Swift", "rb": "Ruby", "php": "PHP", "sql": "SQL", "sh": "Shell",
            "bash": "Bash", "zsh": "Zsh", "yaml": "YAML", "yml": "YAML", "json": "JSON", "toml": "TOML",
            "css": "CSS", "scss": "SCSS", "html": "HTML", "md": "Markdown", "vue": "Vue", "svelte": "Svelte"
        }
        lang = lang_map.get(ext, ext.capitalize() if ext else "Code")
        raw_code = ""
        line_count = 0
        try:
            raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{filepath}"
            req = urllib.request.Request(raw_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                raw_code = resp.read(60000).decode("utf-8", errors="ignore")
                line_count = len(raw_code.splitlines())
        except Exception:
            pass

        return {
            "title": f"{filename} ({owner}/{repo})",
            "description": f"{lang} source code in {owner}/{repo}",
            "author": owner,
            "publication": "GitHub",
            "heroImg": "",
            "price": "",
            "isCode": True,
            "codeLanguage": lang,
            "codeFilename": filename,
            "codeRepo": f"{owner}/{repo}",
            "codeBranch": branch,
            "codeFilepath": filepath,
            "codeLines": line_count,
            "codeSnippet": raw_code,
            "codeText": raw_code,
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": "github.com",
            "url": url,
            "paragraphs": [raw_code[:500]] if raw_code else [],
            "tags": ["code", "github", lang.lower(), repo.lower(), owner.lower()]
        }

    # 1e-2. GitHub Gist URL
    gist_match = re.search(r'gist\.github\.com\/([^\/]+)\/([a-zA-Z0-9]+)', url, re.I)
    if gist_match:
        gist_user = gist_match.group(1)
        gist_id = gist_match.group(2)
        raw_code = ""
        line_count = 0
        try:
            raw_url = f"https://gist.githubusercontent.com/{gist_user}/{gist_id}/raw"
            req = urllib.request.Request(raw_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                raw_code = resp.read(60000).decode("utf-8", errors="ignore")
                line_count = len(raw_code.splitlines())
        except Exception:
            pass
        return {
            "title": f"Gist by {gist_user} ({gist_id[:7]})",
            "description": f"GitHub Gist by {gist_user}",
            "author": gist_user,
            "publication": "GitHub Gist",
            "heroImg": "",
            "price": "",
            "isCode": True,
            "codeLanguage": "Code",
            "codeFilename": f"gist_{gist_id[:7]}.txt",
            "codeRepo": f"{gist_user}/gist",
            "codeLines": line_count,
            "codeSnippet": raw_code,
            "codeText": raw_code,
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": "github.com",
            "url": url,
            "paragraphs": [raw_code[:500]] if raw_code else [],
            "tags": ["code", "github", "gist", gist_user.lower()]
        }

    # 1e-3. GitHub Repository URL (e.g. github.com/owner/repo)
    gh_repo_match = re.search(r'github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:\/)?$', url, re.I)
    if gh_repo_match and gh_repo_match.group(1).lower() not in ["features", "topics", "collections", "trending", "explore", "pricing", "marketplace"]:
        owner = gh_repo_match.group(1)
        repo = gh_repo_match.group(2)
        og_img = f"https://opengraph.githubassets.com/1/{owner}/{repo}"
        repo_title = f"{owner}/{repo}"
        repo_desc = f"GitHub repository {owner}/{repo}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                html = resp.read(200000).decode("utf-8", errors="ignore")
                m_desc = re.search(r'<meta property=\"og:description\" content=\"([^\"]+)\"', html)
                if m_desc:
                    repo_desc = m_desc.group(1).strip()
        except Exception:
            pass

        return {
            "title": repo_title,
            "description": repo_desc,
            "author": owner,
            "publication": "GitHub",
            "heroImg": og_img,
            "price": "",
            "isCode": True,
            "isRepo": True,
            "codeLanguage": "Repository",
            "codeFilename": f"{repo}",
            "codeRepo": f"{owner}/{repo}",
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": "github.com",
            "url": url,
            "paragraphs": [repo_desc],
            "tags": ["code", "github", "repository", repo.lower(), owner.lower()]
        }

    # 1e-4. Direct Code File (.py, .js, .ts, etc.)
    code_ext_match = re.search(r'\.(py|js|ts|tsx|jsx|rs|go|cpp|c|h|hpp|java|kt|swift|rb|php|sql|sh|bash|zsh|yaml|yml|json|toml|css|scss|lua|r|zig)(\?.*)?$', url, re.I)
    if code_ext_match:
        filename = os.path.basename(urllib.parse.urlparse(url).path)
        ext = code_ext_match.group(1).lower()
        lang_map = {
            "py": "Python", "js": "JavaScript", "ts": "TypeScript", "tsx": "TypeScript React", "jsx": "JavaScript React",
            "rs": "Rust", "go": "Go", "cpp": "C++", "c": "C", "h": "C/C++", "hpp": "C++", "java": "Java",
            "kt": "Kotlin", "swift": "Swift", "rb": "Ruby", "php": "PHP", "sql": "SQL", "sh": "Shell",
            "bash": "Bash", "zsh": "Zsh", "yaml": "YAML", "yml": "YAML", "json": "JSON", "toml": "TOML",
            "css": "CSS", "scss": "SCSS", "lua": "Lua", "r": "R", "zig": "Zig"
        }
        lang = lang_map.get(ext, ext.upper())
        raw_code = ""
        line_count = 0
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                raw_code = resp.read(60000).decode("utf-8", errors="ignore")
                line_count = len(raw_code.splitlines())
        except Exception:
            pass

        return {
            "title": filename or f"Code File ({lang})",
            "description": f"{lang} code file ({domain})",
            "author": domain,
            "publication": domain,
            "heroImg": "",
            "price": "",
            "isCode": True,
            "codeLanguage": lang,
            "codeFilename": filename,
            "codeLines": line_count,
            "codeSnippet": raw_code,
            "codeText": raw_code,
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": domain,
            "url": url,
            "paragraphs": [raw_code[:500]] if raw_code else [],
            "tags": ["code", lang.lower(), ext, domain]
        }

    # 1f. Social Posts (Twitter/X, Reddit, LinkedIn, Threads, Bluesky, Instagram)
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
        sub_name = reddit_match.group(1)
        subreddit = f"r/{sub_name}"
        post_id = reddit_match.group(2) or ""
        slug = reddit_match.group(3) or ""
        
        post_title = " ".join([w.capitalize() for w in slug.split("_") if w]) if slug else f"Reddit Discussion in {subreddit}"
        author_name = subreddit
        handle = subreddit
        post_desc = f"Discussion on {subreddit}"
        hero_img = f"https://share.redd.it/preview/post/{post_id}" if post_id else ""
        
        # Try Reddit oEmbed to get the real post title and author
        try:
            oe_url = f"https://www.reddit.com/oembed?url={urllib.parse.quote(url)}"
            oe_req = urllib.request.Request(oe_url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
            })
            with urllib.request.urlopen(oe_req, timeout=4) as oe_resp:
                oe_data = json.loads(oe_resp.read().decode("utf-8"))
                if oe_data.get("title"):
                    post_title = oe_data["title"]
                if oe_data.get("author_name"):
                    author_name = f"u/{oe_data['author_name']}"
                    handle = author_name
                post_desc = f"{post_title} — Discussion in {subreddit} by {author_name}"
        except Exception:
            pass

        return {
            "title": f"{post_title} - {subreddit}",
            "description": post_desc,
            "author": author_name,
            "publication": "Reddit",
            "heroImg": hero_img,
            "price": "",
            "isSocial": True,
            "socialPlatform": "reddit",
            "socialPlatformLabel": subreddit,
            "socialAuthorName": author_name,
            "socialHandle": subreddit,
            "socialAvatar": "https://www.redditstatic.com/shreddit/assets/favicon/192x192.png",
            "socialText": post_title,
            "socialMediaUrl": hero_img,
            "socialLikes": 0,
            "socialReposts": 0,
            "socialReplies": 0,
            "isVideo": False,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": domain,
            "url": url,
            "paragraphs": [post_title, post_desc],
            "tags": ["social", "reddit", sub_name.lower()]
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
    ig_match = re.search(r'instagram\.com\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)', url, re.I)
    if ig_match or ("instagram.com" in domain and ("/p/" in url or "/reel/" in url)):
        shortcode = ig_match.group(1) if ig_match else ""
        user_match = re.search(r'instagram\.com\/([a-zA-Z0-9_.]+)\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)', url, re.I)
        ig_user = user_match.group(1) if user_match and user_match.group(1).lower() not in ["p", "reel", "tv", "explore", "stories"] else ""
        
        author_name = f"@{ig_user}" if ig_user else "Instagram"
        handle = f"@{ig_user}" if ig_user else "@instagram"
        post_title = f"Instagram Post by {author_name}" if ig_user else "Instagram Post"
        embed_url = f"https://www.instagram.com/p/{shortcode}/embed/" if shortcode else ""
        ig_text = ""
        hero_img = ""
        
        # Try fetching embed page for caption & author
        if shortcode:
            try:
                oe_url = f"https://www.instagram.com/p/{shortcode}/embed/"
                oe_req = urllib.request.Request(oe_url, headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
                })
                with urllib.request.urlopen(oe_req, timeout=4) as oe_resp:
                    raw_html = oe_resp.read().decode("utf-8", errors="ignore")
                    m_cap = re.search(r'class=\"[^\"]*Caption[^\"]*\"[^>]*>(.*?)<\/div>', raw_html, re.DOTALL)
                    if m_cap:
                        ig_text = re.sub(r'<[^>]+>', '', m_cap.group(1)).strip()
                    if not ig_user:
                        m_u = re.search(r'instagram\.com\/([a-zA-Z0-9_.]+)\/\"', raw_html)
                        if m_u and m_u.group(1).lower() not in ["legal", "about"]:
                            ig_user = m_u.group(1)
                            author_name = f"@{ig_user}"
                            handle = f"@{ig_user}"
            except Exception:
                pass

        if ig_text:
            short_txt = (ig_text[:60] + "…") if len(ig_text) > 60 else ig_text
            post_title = f"{author_name}: \"{short_txt}\""
            
        desc = ig_text or f"Instagram post by {author_name}"

        return {
            "title": post_title,
            "description": desc,
            "author": author_name,
            "publication": "Instagram",
            "heroImg": hero_img,
            "price": "",
            "isSocial": True,
            "socialPlatform": "instagram",
            "socialPlatformLabel": "Instagram",
            "socialAuthorName": author_name,
            "socialHandle": handle,
            "socialAvatar": "https://www.instagram.com/static/images/ico/favicon-192.png/68d99ba29cc8.png",
            "socialText": ig_text or (f"Instagram Post by {author_name}" if ig_user else "Instagram Post • Tap to open and view post details on Instagram"),
            "socialMediaUrl": hero_img,
            "socialEmbedUrl": embed_url,
            "socialLikes": 0,
            "socialReposts": 0,
            "socialReplies": 0,
            "isVideo": "/reel/" in url,
            "isAudio": False,
            "isBuying": False,
            "isArticle": False,
            "domain": "instagram.com",
            "url": url,
            "paragraphs": [ig_text] if ig_text else [],
            "tags": ["social", "instagram"] + ([ig_user.lower()] if ig_user else [])
        }

    # 2. YouTube Video Detection
    yt_match = re.search(r'(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})', url)
    if yt_match:
        video_id = yt_match.group(1)
        embed_url = f"https://www.youtube-nocookie.com/embed/{video_id}"
        hero_img = f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"
        title = "YouTube Video"
        author = "YouTube"
        desc = ""
        extra_tags = []

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

        haystack = f"{title} {author} {desc} {' '.join(extra_tags)}".lower()
        topic_tags = ["video", "youtube"]
        if author and author != "YouTube":
            topic_tags.append(author.lower())

        if any(w in haystack for w in ["music", "song", "audio", "lyrics", "remaster", "album", "artist", "singer", "pop", "rock", "rap", "hip hop", "soundtrack"]):
            topic_tags.extend(["music", "song"])
        if any(w in haystack for w in ["game", "gaming", "gameplay", "walkthrough", "trailer", "ps5", "xbox", "nintendo", "gta"]):
            topic_tags.extend(["gaming", "gameplay"])
        if any(w in haystack for w in ["tutorial", "how to", "guide", "course", "learn", "coding", "code", "programming", "python", "javascript"]):
            topic_tags.extend(["tutorial", "education"])
        if any(w in haystack for w in ["podcast", "interview", "talk", "conversation", "documentary", "discussion"]):
            topic_tags.extend(["podcast", "interview"])
        if any(w in haystack for w in ["movie", "film", "cinema", "trailer", "teaser", "scene"]):
            topic_tags.extend(["movie", "film"])
        if any(w in haystack for w in ["tech", "technology", "review", "unboxing", "apple", "gadget", "software", "ai"]):
            topic_tags.extend(["technology", "tech"])

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

    # 3. Direct image
    is_img = (
        re.search(r'\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?.*)?$', url, re.I) or
        "gstatic.com/images?q=" in url or
        "googleusercontent.com/" in url or
        "images.unsplash.com/" in url
    )
    if is_img:
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

    # 4. Standard Web Scraping
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            content_type = resp.headers.get("Content-Type", "").lower()
            if "image/" in content_type:
                return {
                    "title": domain or "Image",
                    "heroImg": url,
                    "domain": domain,
                    "url": url,
                    "isDirectImage": True
                }
            raw = resp.read(1024 * 1024)
            html_text = raw.decode("utf-8", errors="replace")
    except Exception as e:
        return {"title": domain, "description": str(e), "heroImg": "", "domain": domain, "url": url}

    parser = MetaScraper(url)
    try:
        parser.feed(html_text)
    except Exception:
        pass

    meta = parser.meta_tags
    title = meta.get("og:title") or parser.title or parser.h1_title or domain
    desc = meta.get("og:description") or meta.get("description") or ""

    # JSON-LD Product image and offers
    json_ld_image = ""
    price = ""
    for ld in parser.json_ld:
        def check_ld(item):
            nonlocal json_ld_image, price
            if not isinstance(item, dict): return
            itype = str(item.get("@type", ""))
            if "Product" in itype and not json_ld_image:
                img = item.get("image")
                if isinstance(img, list) and img:
                    first = img[0]
                    json_ld_image = first if isinstance(first, str) else (first.get("url", "") if isinstance(first, dict) else "")
                elif isinstance(img, dict):
                    json_ld_image = img.get("url", "")
                elif isinstance(img, str):
                    json_ld_image = img
            if "offers" in item and not price:
                offers = item["offers"]
                offer = offers[0] if isinstance(offers, list) and offers else offers
                if isinstance(offer, dict) and "price" in offer:
                    curr = str(offer.get("priceCurrency", "USD")).upper()
                    sym = "$" if curr == "USD" else ("₹" if curr == "INR" else ("€" if curr == "EUR" else ("£" if curr == "GBP" else curr + " ")))
                    price = f"{sym}{offer['price']}"

        if isinstance(ld, list):
            for it in ld: check_ld(it)
        elif isinstance(ld, dict):
            if "@graph" in ld and isinstance(ld["@graph"], list):
                for it in ld["@graph"]: check_ld(it)
            else:
                check_ld(ld)

    if not price and parser.price_texts:
        for pt in parser.price_texts:
            m = re.search(r'(?:[$€£₹]|Rs\.?)\s*[0-9,]+(?:\.[0-9]{2})?', pt, re.I)
            if m:
                price = m.group(0).strip().replace("Rs.", "₹").replace(" ", "")
                break

    shopping_keywords = [
        'amazon.', 'ebay.', 'walmart.', 'target.', 'bestbuy.', 'shopify', 'apple.com',
        'nike.com', 'aliexpress.', 'flipkart.', 'myntra.', 'nykaa.', 'ikea.', 'pepperfry.'
    ]
    is_buying = any(k in domain for k in shopping_keywords) or bool(price)

    hero_img = json_ld_image or meta.get("og:image:secure_url") or meta.get("og:image") or meta.get("twitter:image") or ""
    if hero_img:
        hero_img = urllib.parse.urljoin(url, hero_img)
    elif parser.img_candidates:
        hero_img = parser.img_candidates[0]

    if hero_img:
        hero_img = upgrade_image_url_to_max_res(hero_img)

    paragraphs = parser.paragraphs
    if len(paragraphs) < 2:
        for p_match in re.finditer(r'<p[^>]*>(.*?)</p>', html_text, re.DOTALL | re.I):
            clean = re.sub(r'<[^>]+>', ' ', p_match.group(1)).strip()
            clean = re.sub(r'\s+', ' ', clean)
            if len(clean) > 28 and clean not in paragraphs:
                paragraphs.append(clean)

    return {
        "title": title,
        "description": desc,
        "heroImg": hero_img,
        "price": price,
        "isBuying": is_buying,
        "paragraphs": paragraphs,
        "articleBody": "\n\n".join(paragraphs),
        "domain": domain,
        "url": url,
        "isArticle": len(paragraphs) >= 2 and not is_buying,
        "tags": (["product", "buying"] if is_buying else ["web"]) + [domain]
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
                    # Ensure tags include primarySubject, action, and scene
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


def analyze_text_groq(text, api_key=None):
    key = api_key or os.environ.get("GROQ_API_KEY")
    if not key or not text:
        return None
    try:
        url = "https://api.groq.com/openai/v1/chat/completions"
        prompt = (
            "Analyze this text for Recall (a personal visual memory app).\n"
            "Determine if it is a Quote or Note. Extract an engaging title (3-7 words), summary, and semantic tags.\n"
            "Return ONLY a valid strict JSON object:\n"
            "{\n"
            '  "isQuote": true,\n'
            '  "quoteText": "Verbatim quote if quote, else empty string",\n'
            '  "quoteAttribution": "Author or source if quote, else empty string",\n'
            '  "title": "A short, clean, descriptive title (3 to 7 words)",\n'
            '  "tldr": "A 1-2 sentence concise summary",\n'
            '  "tags": ["relevant", "keywords"]\n'
            "}"
        )
        payload = {
            "model": "qwen/qwen3.8-27b",
            "messages": [
                {
                    "role": "user",
                    "content": f"{prompt}\n\nText to analyze:\n{text[:3500]}"
                }
            ],
            "max_completion_tokens": 450,
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
        with urllib.request.urlopen(req, timeout=12) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            content = res_data.get("choices", [{}])[0].get("message", {}).get("content", "")
            if content:
                match = re.search(r"\{[\s\S]*\}", content)
                if match:
                    return json.loads(match.group(0))
    except Exception as e:
        print("[Groq Text Backend Error]", e)
    return None


class handler(BaseHTTPRequestHandler):
    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/memories":
            mems_list = []
            try:
                base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                mem_file = os.path.join(base_dir, "data", "memories.json")
                if os.path.exists(mem_file):
                    with open(mem_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        raw_mems = list(data.values()) if isinstance(data, dict) else data
                        demo_ids = {"lion", "tables", "youattract", "fran", "tryagain", "givingup", "orange_silhouette", "studio", "believe", "redbull"}
                        mems_list = [m for m in raw_mems if isinstance(m, dict) and m.get("id") not in demo_ids and not m.get("isDemo")]
            except Exception as e:
                pass

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "memories": mems_list}).encode("utf-8"))
            return

        if parsed.path == "/api/inbox":
            inbox_items = []
            try:
                query = urllib.parse.parse_qs(parsed.query)
                user_id = query.get("userId", [""])[0]
                if user_id:
                    safe_uid = re.sub(r'[^a-zA-Z0-9_-]', '', str(user_id))[:64]
                    if safe_uid:
                        user_inbox = os.path.join(tempfile.gettempdir(), f"recall_inbox_{safe_uid}.json")
                        if os.path.exists(user_inbox):
                            with open(user_inbox, "r", encoding="utf-8") as f:
                                inbox_items = json.load(f)
            except Exception:
                pass
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "memories": inbox_items}).encode("utf-8"))
            return

        if parsed.path == "/api/proxy-image":
            query = urllib.parse.parse_qs(parsed.query)
            target = query.get("url", [""])[0]
            if not target:
                self.send_response(400)
                self.end_headers()
                return

            try:
                req = urllib.request.Request(target, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=8) as resp:
                    data = resp.read()
                    content_type = resp.headers.get("Content-Type", "image/jpeg")
                    self.send_response(200)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Cache-Control", "public, max-age=86400")
                    self.send_cors_headers()
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as e:
                self.send_response(502)
                self.end_headers()
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/memories/clear":
            try:
                base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                mem_file = os.path.join(base_dir, "data", "memories.json")
                if os.path.exists(mem_file):
                    with open(mem_file, "w", encoding="utf-8") as f:
                        json.dump({}, f)
                inbox_file = os.path.join(base_dir, "data", "inbox.json")
                if os.path.exists(inbox_file):
                    with open(inbox_file, "w", encoding="utf-8") as f:
                        json.dump([], f)
            except Exception:
                pass
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
            return

        if parsed.path == "/api/memories/delete":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length).decode("utf-8")) if length > 0 else {}
                target_id = body.get("id")
                if target_id:
                    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                    mem_file = os.path.join(base_dir, "data", "memories.json")
                    if os.path.exists(mem_file):
                        with open(mem_file, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        if isinstance(data, dict) and target_id in data:
                            del data[target_id]
                            with open(mem_file, "w", encoding="utf-8") as f:
                                json.dump(data, f, indent=2)
                        elif isinstance(data, list):
                            data = [m for m in data if m.get("id") != target_id]
                            with open(mem_file, "w", encoding="utf-8") as f:
                                json.dump(data, f, indent=2)
            except Exception:
                pass
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
            return

        if parsed.path == "/api/inbox/ack":
            try:
                base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                inbox_file = os.path.join(base_dir, "data", "inbox.json")
                if os.path.exists(inbox_file):
                    with open(inbox_file, "w", encoding="utf-8") as f:
                        json.dump([], f)
            except Exception:
                pass
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
            return

        if parsed.path == "/api/scrape-url":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length).decode("utf-8")) if length > 0 else {}
                url = body.get("url", "").strip()
                if not url:
                    self.send_response(400)
                    self.end_headers()
                    return

                res = scrape_url_meta(url)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "data": res}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        if parsed.path == "/api/ai/groq-analyze":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length).decode("utf-8")) if length > 0 else {}
                img_data = body.get("image", "")
                text_data = body.get("text", "")
                auth_header = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
                user_key = body.get("apiKey") or auth_header
                if text_data:
                    result = analyze_text_groq(text_data, user_key)
                else:
                    result = analyze_image_groq(img_data, user_key)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "data": result}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        if parsed.path == "/api/memories/save":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
            return

        if parsed.path == "/api/save":
            try:
                length = int(self.headers.get("Content-Length", 0))
                payload = json.loads(self.rfile.read(length).decode("utf-8")) if length > 0 else {}
                source = payload.get("source") or payload.get("url") or ""
                if source.startswith("http") and (not payload.get("title") or payload.get("title") == "Saved Memory"):
                    scraped = scrape_url_meta(source)
                    if scraped.get("title"):
                        payload["title"] = scraped["title"]
                    if scraped.get("description"):
                        payload["tldr"] = scraped["description"]
                    if scraped.get("heroImg") and not payload.get("heroImg"):
                        payload["heroImg"] = scraped["heroImg"]

                # Enrich with Groq Vision (qwen/qwen3.8-27b) if image is present (skip products: use exact page info)
                hero_img = payload.get("heroImg")
                is_product = bool(payload.get("isBuying") or payload.get("price") or payload.get("type") == "Product")
                auth_header = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
                groq_key = payload.get("apiKey") or auth_header or os.environ.get("GROQ_API_KEY")
                if hero_img and groq_key and not is_product:
                    groq_res = analyze_image_groq(hero_img, groq_key)
                    if groq_res:
                        curr_title = payload.get("title", "")
                        is_noisy_title = (
                            not curr_title or
                            curr_title in ["Saved Memory", "Web image", "Pasted Image", "Saved Item", "Pasted Screenshot"] or
                            "Google Search" in curr_title or
                            "Google Images" in curr_title or
                            "gstatic.com" in curr_title or
                            curr_title.startswith("mem_")
                        )
                        if groq_res.get("title") and (is_noisy_title or len(groq_res.get("title", "")) > len(curr_title)):
                            payload["title"] = groq_res["title"]
                        if groq_res.get("tldr"):
                            payload["tldr"] = groq_res["tldr"]
                        if groq_res.get("ocrText"):
                            payload["ocrText"] = groq_res["ocrText"]
                        if groq_res.get("isBook"):
                            payload["isBook"] = True
                            payload["type"] = "Book"
                            payload["isQuote"] = False
                        if groq_res.get("hasAnimals"):
                            payload["hasAnimals"] = True
                            payload["isQuote"] = False
                            payload["type"] = "Web image"
                            payload.pop("quote", None)
                        elif not groq_res.get("isQuote") and not payload.get("isBook"):
                            payload["isQuote"] = False
                            payload["type"] = "Web image"
                            payload.pop("quote", None)
                        if groq_res.get("tags"):
                            existing_tags = set(payload.get("tags", []))
                            for t in groq_res["tags"]:
                                existing_tags.add(str(t).lower())
                            payload["tags"] = list(existing_tags)

                # Enrich with Groq Text Analysis if note/text (NOT products)
                if not hero_img and groq_key and not is_product and (payload.get("body") or payload.get("title")):
                    text_str = payload.get("body") or payload.get("title")
                    t_res = analyze_text_groq(text_str, groq_key)
                    if t_res:
                        if t_res.get("isQuote"):
                            payload["isQuote"] = True
                            payload["type"] = "Quote"
                            if t_res.get("quoteText"):
                                payload["quote"] = t_res["quoteText"]
                            if t_res.get("quoteAttribution"):
                                payload["attribution"] = t_res["quoteAttribution"]
                        if t_res.get("title") and (not payload.get("title") or payload.get("title") in ("Untitled Note", "Saved Item", "Note")):
                            payload["title"] = t_res["title"]
                        if t_res.get("tldr"):
                            payload["tldr"] = t_res["tldr"]
                        if t_res.get("tags"):
                            existing_tags = set(payload.get("tags", []))
                            for t in t_res["tags"]:
                                existing_tags.add(str(t).lower())
                            payload["tags"] = list(existing_tags)

                if "imageUrl" not in payload:
                    payload["imageUrl"] = payload.get("heroImg") or source
                if "url" not in payload:
                    payload["url"] = source

                # Buffer into user-partitioned inbox for polling clients
                user_id = payload.get("userId")
                if user_id:
                    try:
                        safe_uid = re.sub(r'[^a-zA-Z0-9_-]', '', str(user_id))[:64]
                        if safe_uid:
                            user_inbox = os.path.join(tempfile.gettempdir(), f"recall_inbox_{safe_uid}.json")
                            inbox = []
                            if os.path.exists(user_inbox):
                                try:
                                    with open(user_inbox, "r", encoding="utf-8") as f:
                                        inbox = json.load(f)
                                except Exception:
                                    inbox = []
                            inbox.append(payload)
                            with open(user_inbox, "w", encoding="utf-8") as f:
                                json.dump(inbox, f)
                    except Exception:
                        pass

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "memory": payload}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        if parsed.path == "/api/inbox/ack":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length).decode("utf-8")) if length > 0 else {}
                user_id = body.get("userId")
                if user_id:
                    safe_uid = re.sub(r'[^a-zA-Z0-9_-]', '', str(user_id))[:64]
                    if safe_uid:
                        user_inbox = os.path.join(tempfile.gettempdir(), f"recall_inbox_{safe_uid}.json")
                        if os.path.exists(user_inbox):
                            os.remove(user_inbox)
                legacy_file = os.path.join(tempfile.gettempdir(), "recall_inbox.json")
                if os.path.exists(legacy_file):
                    os.remove(legacy_file)
            except Exception:
                pass
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
