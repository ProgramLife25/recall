(() => {
  "use strict";

  const saveBtn = document.getElementById("saveBtn");
  const title = document.getElementById("title");
  const details = document.getElementById("details");
  const preview = document.getElementById("preview");
  const statusText = document.getElementById("statusText");
  let captureData = null;

  async function init() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab.");

      chrome.tabs.sendMessage(tab.id, { type: "RECALL_CAPTURE" }, (response) => {
        if (!response || !response.image) {
          title.textContent = "No clipping found";
          details.textContent = "Could not find a saveable image on this page.";
          return;
        }

        captureData = response;
        title.textContent = response.title;
        details.textContent = [response.price, response.site].filter(Boolean).join(" • ");
        preview.src = response.image;
        preview.style.display = "block";
        saveBtn.disabled = false;
      });
    } catch (err) {
      title.textContent = "Error";
      details.textContent = err.message;
    }
  }

  saveBtn.addEventListener("click", () => {
    if (!captureData) return;

    // Send to Windows Recall native application via recall://save protocol
    const url = new URL("recall://save");
    for (const [key, value] of Object.entries(captureData)) {
      if (typeof value === "string" && value) {
        url.searchParams.set(key, value);
      }
    }

    window.location.href = url.href;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saved to Recall";
    statusText.textContent = "Opening Recall for Windows...";
  });

  init();
})();
