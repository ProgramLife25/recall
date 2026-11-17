(() => {
  "use strict";
  const clean = value => typeof value === "string" ? value.trim() : "";
  const meta = (...selectors) => {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.content;
      if (clean(value)) return clean(value);
    }
    return "";
  };
  const absolute = value => {
    try { return new URL(value, document.baseURI).href; } catch { return ""; }
  };
  const array = value => Array.isArray(value) ? value : [value];
  const products = [];

  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const queue = array(JSON.parse(script.textContent));
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;
        if (item["@graph"]) queue.push(...array(item["@graph"]));
        const types = array(item["@type"]).map(String);
        if (types.some(type => type.toLowerCase() === "product")) products.push(item);
      }
    } catch { /* Other page signals are used when JSON-LD is malformed. */ }
  }

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
  const platformTitle = isAmazon ? firstText("#productTitle") : isFlipkart ? firstText("h1 .VU-ZEz", "h1 span.B_NuCI", "h1") : "";
  let platformImage = "";
  if (isAmazon) {
    const node = document.querySelector("#landingImage, #imgTagWrapperId img");
    try { platformImage = node?.dataset?.oldHires || Object.keys(JSON.parse(node?.dataset?.aDynamicImage || "{}"))[0] || node?.currentSrc || node?.src || ""; } catch { platformImage = node?.currentSrc || node?.src || ""; }
  } else if (isFlipkart) {
    const node = document.querySelector("img.DByuf4, img._396cs4, [data-testid='product-image'] img");
    platformImage = node?.currentSrc || node?.src || "";
  }
  const platformPrice = isAmazon ? firstText("#corePriceDisplay_desktop_feature_div .a-price .a-offscreen", ".reinventPricePriceToPayMargin .a-offscreen", "#priceblock_dealprice", "#priceblock_ourprice") : isFlipkart ? firstText(".Nx9bqj", "._30jeq3") : "";
  const isVideoPage = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/i.test(location.hostname)
    || /^video/i.test(meta('meta[property="og:type"]'));
  const isArticlePage = /article|news/i.test(meta('meta[property="og:type"]'))
    || !!document.querySelector('article, [itemtype*="Article"], meta[property="article:published_time"]');
  const isMarketplaceProduct = /(^|\.)(amazon\.|flipkart\.)/i.test(location.hostname)
    && (/\/dp\//i.test(location.pathname) || /\/gp\/product\//i.test(location.pathname) || /\/p\//i.test(location.pathname));
  const offers = array(product.offers || {}).filter(Boolean);
  const offer = offers.find(item => item.availability?.toLowerCase?.().includes("instock")) || offers[0] || {};
  const imageValue = array(product.image || {})[0];
  const structuredImage = typeof imageValue === "string" ? imageValue : imageValue?.url;
  const priceSelectors = [
    '[itemprop="price"]', '[data-product-price]', '[data-price]',
    '.price-item--sale', '.price__current', '.product-price', '.sale-price', '.price'
  ];
  let visiblePrice = "";
  for (const selector of priceSelectors) {
    const element = [...document.querySelectorAll(selector)].find(node => {
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && clean(node.textContent);
    });
    if (element) {
      visiblePrice = clean(element.textContent).replace(/\s+/g, " ");
      break;
    }
  }
  const pageText = clean(document.body?.innerText).replace(/\s+/g, " ");
  const visibleMoney = pageText.match(/(?:₹|Rs\.?|INR)\s*[0-9][0-9,.]*/i)?.[0]
    || pageText.match(/(?:\$|€|£)\s*[0-9][0-9,.]*/)?.[0]
    || "";
  const amount = clean(offer.price || offer.lowPrice || meta(
    'meta[property="product:price:amount"]', 'meta[itemprop="price"]'
  ));
  const currency = clean(offer.priceCurrency || meta(
    'meta[property="product:price:currency"]', 'meta[itemprop="priceCurrency"]'
  ));
  const price = platformPrice.match(/(?:₹|Rs\.?|INR|\$|€|£)?\s*[0-9][0-9,.]*/i)?.[0] || visiblePrice.match(/(?:₹|Rs\.?|INR|\$|€|£)?\s*[0-9][0-9,.]*/i)?.[0]
    || visibleMoney || [currency, amount].filter(Boolean).join(" ");
  let title = platformTitle || clean(product.name) || meta('meta[property="og:title"]', 'meta[name="twitter:title"]') || clean(document.title);
  const site = meta('meta[property="og:site_name"]') || location.hostname.replace(/^www\./, "");
  const candidates = [];
  document.querySelectorAll("img").forEach(node => {
    const area = Math.max(1, (node.naturalWidth || node.width || 1) * (node.naturalHeight || node.height || 1));
    [node.dataset.iurl, node.dataset.src, node.dataset.original, node.currentSrc, node.src].forEach((value, index) => {
      if (!value || !/^https?:/i.test(value)) return;
      const penalty = /googlelogo|gstatic\.com\/images\/branding|favicon|logo/i.test(value) ? 1000000000 : 0;
      candidates.push({ url: absolute(value), score: area + (5 - index) * 1000000 - penalty, node });
    });
  });
  candidates.sort((left, right) => right.score - left.score);
  const bestImage = candidates[0];
  if (!product.name && !meta('meta[property="og:title"]', 'meta[name="twitter:title"]') && clean(bestImage?.node?.alt)) {
    title = clean(bestImage.node.alt);
  }
  let image = absolute(platformImage || structuredImage || meta(
    'meta[property="og:image:secure_url"]', 'meta[property="og:image"]',
    'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]'
  ) || bestImage?.url);
  if (isVideoPage && !image) {
    const videoID = location.hostname.includes("youtu.be") ? location.pathname.split("/").filter(Boolean)[0]
      : new URL(location.href).searchParams.get("v") || location.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1];
    if (videoID) image = `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`;
  }
  const imageLink = bestImage?.node?.closest("a[href]")?.href;
  const visitLink = [...document.querySelectorAll("a[href]")].find(anchor => /^(visit|shop|buy|view product)$/i.test(clean(anchor.textContent)))?.href;
  const currentProductPage = (isAmazon && (/\/dp\//i.test(location.pathname) || /\/gp\/product\//i.test(location.pathname))) || (isFlipkart && /\/p\//i.test(location.pathname));
  const url = absolute(currentProductPage ? location.href : (visitLink || imageLink || document.querySelector('link[rel="canonical"]')?.href || location.href));

  browser.runtime.onMessage.addListener(message => {
    if (message?.type !== "RECALL_CAPTURE") return;
    return Promise.resolve({
      url,
      image,
      title,
      text: clean(window.getSelection()?.toString()).slice(0, 6000),
      price: isVideoPage ? "" : clean(price).slice(0, 100),
      site,
      type: isVideoPage ? "Video" : products.length || amount || visiblePrice || isMarketplaceProduct ? "Product" : isArticlePage ? "Article" : "Web image"
    });
  });
})();
