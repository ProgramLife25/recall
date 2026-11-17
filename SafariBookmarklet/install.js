(() => {
  "use strict";

  function saveToRecall() {
    const clean = value => typeof value === "string" ? value.trim() : "";
    const selectedText = clean(window.getSelection()?.toString()).slice(0, 6000);
    const meta = (...selectors) => {
      for (const selector of selectors) {
        const value = document.querySelector(selector)?.content;
        if (clean(value)) return clean(value);
      }
      return "";
    };
    const list = value => Array.isArray(value) ? value : [value];
    const products = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        const queue = list(JSON.parse(script.textContent));
        while (queue.length) {
          const item = queue.shift();
          if (!item || typeof item !== "object") continue;
          if (item["@graph"]) queue.push(...list(item["@graph"]));
          if (list(item["@type"]).map(String).some(type => type.toLowerCase() === "product")) products.push(item);
        }
      } catch {}
    });
    const product = products[0] || {};
    const host = location.hostname.toLowerCase();
    const isAmazon = /(^|\.)amazon\./i.test(host);
    const isFlipkart = /(^|\.)flipkart\./i.test(host);
    const firstText = (...selectors) => {
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (node && clean(node.textContent)) return clean(node.textContent).replace(/\s+/g, " ");
      }
      return "";
    };
    const platformTitle = isAmazon ? firstText("#productTitle")
      : isFlipkart ? firstText("h1 .VU-ZEz", "h1 span.B_NuCI", "h1") : "";
    let platformImage = "";
    if (isAmazon) {
      const node = document.querySelector("#landingImage, #imgTagWrapperId img");
      try { platformImage = node?.dataset?.oldHires || Object.keys(JSON.parse(node?.dataset?.aDynamicImage || "{}"))[0] || node?.currentSrc || node?.src || ""; } catch { platformImage = node?.currentSrc || node?.src || ""; }
    } else if (isFlipkart) {
      const node = document.querySelector("img.DByuf4, img._396cs4, [data-testid='product-image'] img");
      platformImage = node?.currentSrc || node?.src || "";
    }
    const platformPrice = isAmazon ? firstText("#corePriceDisplay_desktop_feature_div .a-price .a-offscreen", ".reinventPricePriceToPayMargin .a-offscreen", "#priceblock_dealprice", "#priceblock_ourprice")
      : isFlipkart ? firstText(".Nx9bqj", "._30jeq3") : "";
    const isVideoPage = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/i.test(location.hostname)
      || /^video/i.test(meta('meta[property="og:type"]'));
    const isArticlePage = /article|news/i.test(meta('meta[property="og:type"]'))
      || !!document.querySelector('article, [itemtype*="Article"], meta[property="article:published_time"]');
    const isMarketplaceProduct = /(^|\.)(amazon\.|flipkart\.)/i.test(location.hostname)
      && (/\/dp\//i.test(location.pathname) || /\/gp\/product\//i.test(location.pathname) || /\/p\//i.test(location.pathname));
    const offers = list(product.offers || {}).filter(Boolean);
    const offer = offers.find(value => clean(value.availability).toLowerCase().includes("instock")) || offers[0] || {};
    const productImage = list(product.image || {})[0];
    const structuredImage = typeof productImage === "string" ? productImage : productImage?.url;
    const imageCandidates = [];
    document.querySelectorAll("img").forEach(node => {
      const area = Math.max(1, (node.naturalWidth || node.width || 1) * (node.naturalHeight || node.height || 1));
      [node.dataset.iurl, node.dataset.src, node.dataset.original, node.currentSrc, node.src].forEach((value, index) => {
        if (!value || !/^https?:/i.test(value)) return;
        const url = new URL(value, document.baseURI).href;
        const penalty = /googlelogo|gstatic\.com\/images\/branding|favicon|logo/i.test(url) ? 1000000000 : 0;
        imageCandidates.push({ url, score: area + (5 - index) * 1000000 - penalty, node });
      });
    });
    document.querySelectorAll("[style*='background-image']").forEach(node => {
      const match = getComputedStyle(node).backgroundImage.match(/url\(["']?(https?:\/\/[^"')]+)/i);
      if (!match) return;
      const box = node.getBoundingClientRect();
      imageCandidates.push({ url: match[1], score: Math.max(1, box.width * box.height), node });
    });
    imageCandidates.sort((left, right) => right.score - left.score);
    const bestImage = imageCandidates[0];
    let image = platformImage || structuredImage || meta(
      'meta[property="og:image:secure_url"]', 'meta[property="og:image"]',
      'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]'
    ) || bestImage?.url || "";
    if (isVideoPage && !image) {
      const videoID = location.hostname.includes("youtu.be") ? location.pathname.split("/").filter(Boolean)[0]
        : new URL(location.href).searchParams.get("v") || location.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1];
      if (videoID) image = `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`;
    }
    let visiblePrice = "";
    for (const selector of ['[itemprop="price"]', '[data-product-price]', '[data-price]', '.price-item--sale', '.price__current', '.product-price', '.sale-price', '.price']) {
      const node = [...document.querySelectorAll(selector)].find(element => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && clean(element.textContent);
      });
      if (node) { visiblePrice = clean(node.textContent).replace(/\s+/g, " "); break; }
    }
    const pageText = clean(document.body?.innerText).replace(/\s+/g, " ");
    const visibleMoney = pageText.match(/(?:₹|Rs\.?|INR)\s*[0-9][0-9,.]*/i)?.[0]
      || pageText.match(/(?:\$|€|£)\s*[0-9][0-9,.]*/)?.[0]
      || "";
    const amount = clean(offer.price || offer.lowPrice || meta('meta[property="product:price:amount"]', 'meta[itemprop="price"]'));
    const currency = clean(offer.priceCurrency || meta('meta[property="product:price:currency"]', 'meta[itemprop="priceCurrency"]'));
    const imageLink = bestImage?.node?.closest("a[href]")?.href;
    const visitLink = [...document.querySelectorAll("a[href]")].find(anchor => /^(visit|shop|buy|view product)$/i.test(clean(anchor.textContent)))?.href;
    const googleImageLink = (() => {
      try {
        const candidate = new URL(imageLink || "", document.baseURI);
        return candidate.searchParams.get("imgrefurl") || candidate.searchParams.get("url") || "";
      } catch { return ""; }
    })();
    const externalLink = [googleImageLink, visitLink, imageLink].find(value => {
      try { return /^https?:$/.test(new URL(value, document.baseURI).protocol); } catch { return false; }
    });
    const currentProductPage = (isAmazon && (/\/dp\//i.test(location.pathname) || /\/gp\/product\//i.test(location.pathname))) || (isFlipkart && /\/p\//i.test(location.pathname));
    const detectedType = isVideoPage ? "Video" : products.length || amount || visiblePrice || isMarketplaceProduct ? "Product" : isArticlePage ? "Article" : "Web image";
    const values = {
      url: currentProductPage ? location.href : (externalLink || document.querySelector('link[rel="canonical"]')?.href || location.href),
      image: image ? new URL(image, document.baseURI).href : "",
      title: platformTitle || clean(product.name) || meta('meta[property="og:title"]', 'meta[name="twitter:title"]') || clean(bestImage?.node?.alt) || clean(document.title),
      price: detectedType === "Video" ? "" : (platformPrice.match(/(?:₹|Rs\.?|INR|\$|€|£)?\s*[0-9][0-9,.]*/i)?.[0] || visiblePrice.match(/(?:₹|Rs\.?|INR|\$|€|£)?\s*[0-9][0-9,.]*/i)?.[0] || visibleMoney || [currency, amount].filter(Boolean).join(" ")).slice(0, 100),
      site: meta('meta[property="og:site_name"]') || location.hostname.replace(/^www\./, ""),
      type: detectedType,
      silent: "1"
    };
    if (selectedText) {
      values.text = selectedText;
      values.type = "Highlight";
      values.image = "";
      values.price = "";
    }
    const query = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => { if (value) query.set(key, value); });
    location.href = `recall://save?${query}`;
  }

  const address = `javascript:(${saveToRecall.toString()})()`;
  document.querySelector("#bookmark").href = address;
  document.querySelector("#copy").addEventListener("click", async () => {
    const status = document.querySelector("#status");
    try {
      await navigator.clipboard.writeText(address);
      status.textContent = "Bookmark address copied.";
    } catch {
      status.textContent = "Safari blocked copying. Drag the orange button instead.";
    }
  });
})();
