(() => {
  "use strict";
  const save = document.querySelector("#save");
  const title = document.querySelector("#title");
  const details = document.querySelector("#details");
  const preview = document.querySelector("#preview");
  const status = document.querySelector("#status");
  let capture;

  const fail = message => {
    status.textContent = message;
    status.classList.add("error");
  };

  async function load() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("Open a web page first.");
      capture = await browser.tabs.sendMessage(tab.id, { type: "RECALL_CAPTURE" });
      if (!capture?.image) throw new Error("No saveable image was found on this page.");
      title.textContent = capture.title || "Saved web image";
      details.textContent = [capture.price, capture.site].filter(Boolean).join(" • ");
      preview.src = capture.image;
      preview.hidden = false;
      save.disabled = false;
      status.textContent = capture.price
        ? "The current page price and buying link will be saved."
        : "The image, source link, and page name will be saved.";
    } catch (error) {
      fail(error.message || "Recall could not read this page.");
    }
  }

  save.addEventListener("click", () => {
    if (!capture) return;
    const target = new URL("recall://save");
    for (const [key, value] of Object.entries(capture)) {
      if (typeof value === "string" && value) target.searchParams.set(key, value);
    }
    window.location.href = target.href;
    save.disabled = true;
    save.textContent = "Saved";
    status.textContent = "Recall is importing and analyzing this image locally.";
  });

  load();
})();
