(() => {
  "use strict";

  function extractPrice() {
    const priceSelectors = [
      '[data-test*="price"]',
      '[class*="price"]',
      '[id*="price"]',
      'span[class*="Price"]',
      '.a-price .a-offscreen',
      '.product-price'
    ];
    for (const selector of priceSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent) {
        const match = el.textContent.trim().match(/[\$₹€£]\s*[\d,]+(\.\d{2})?/);
        if (match) return match[0];
      }
    }
    return null;
  }

  function extractHeroImage() {
    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
    if (ogImage) return ogImage;

    const twitterImage = document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
    if (twitterImage) return twitterImage;

    const images = Array.from(document.querySelectorAll('img'))
      .filter(img => img.naturalWidth > 200 && img.naturalHeight > 200)
      .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));

    return images.length > 0 ? images[0].src : null;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "RECALL_CAPTURE") {
      const capture = {
        title: document.title || "Saved web clipping",
        url: window.location.href,
        site: window.location.hostname,
        image: extractHeroImage(),
        price: extractPrice()
      };
      sendResponse(capture);
    }
  });
})();
