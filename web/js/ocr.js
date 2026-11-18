/**
 * Recall Web - In-Browser OCR & Visual Analysis
 * Client-Side OCR with Tesseract.js & Canvas Dominant Color Extraction
 */

class VisualAnalyzer {
  constructor() {
    this.ocrWorker = null;
    this.isInitializing = false;
  }

  /**
   * Extracts dominant color and semantic name from an image via Canvas
   */
  async extractColorProfile(imgElement) {
    return new Promise((resolve) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(imgElement, 0, 0, 32, 32);

        const imageData = ctx.getImageData(0, 0, 32, 32);
        const data = imageData.data;
        let r = 0, g = 0, b = 0, count = 0;

        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 128) continue; // Skip transparency
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }

        if (count === 0) {
          resolve({ hex: '#1E293B', name: 'dark' });
          return;
        }

        const avgR = Math.round(r / count);
        const avgG = Math.round(g / count);
        const avgB = Math.round(b / count);

        const hex = `#${((1 << 24) + (avgR << 16) + (avgG << 8) + avgB).toString(16).slice(1).toUpperCase()}`;
        const name = this.classifyColor(avgR, avgG, avgB);

        resolve({ hex, name });
      } catch (err) {
        console.warn('Color extraction failed, using fallback:', err);
        resolve({ hex: '#1E293B', name: 'dark' });
      }
    });
  }

  classifyColor(r, g, b) {
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    if (brightness < 45) return 'dark';
    if (brightness > 220) return 'white';

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    if (delta < 25) return brightness > 128 ? 'gray' : 'dark';

    if (max === r && g < 120 && b < 120) return 'red';
    if (max === g && r < 140 && b < 140) return 'green';
    if (max === b && r < 130 && g < 150) return 'blue';
    if (r > 170 && g > 150 && b < 90) return 'yellow';
    if (r > 180 && g > 80 && b < 60) return 'orange';
    if (r > 120 && b > 120 && g < 110) return 'purple';

    return brightness > 128 ? 'light' : 'dark';
  }

  /**
   * In-browser OCR using Tesseract.js (if available)
   */
  async extractText(imageSource, onProgress = null) {
    if (typeof Tesseract === 'undefined') {
      console.info('Tesseract.js not loaded. OCR skipped.');
      return '';
    }

    try {
      const result = await Tesseract.recognize(imageSource, 'eng', {
        logger: (m) => {
          if (onProgress && m.status === 'recognizing text') {
            onProgress(Math.round(m.progress * 100));
          }
        }
      });
      return result.data.text.trim();
    } catch (err) {
      console.warn('OCR error:', err);
      return '';
    }
  }
}

window.visualAnalyzer = new VisualAnalyzer();
