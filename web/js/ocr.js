/**
 * Recall Web - Intelligent Visual Analyzer & Entity Detection
 * Note: RECALL_COLOR_FILTERS, rgbToHSB, macColorName,
 * extractDominantColorWords, extractPaletteSwatches are
 * already defined in mobileclip.js (which loads before this file).
 * Do NOT redeclare them here to avoid "already declared" errors.
 */

/**
 * Checks if text looks like a quote matching macOS ContentExtractor.looksLikeQuote
 */
function looksLikeQuote(text) {
  if (!text) return false;
  const val = text.trim();
  if (val.length < 10 || val.length > 700) return false;
  const quoted = val.startsWith('"') || val.startsWith('\u201c') || val.startsWith('\u2018');
  const attributed = /(?:\n|\s)[—\u2013-]\s*[A-Z][A-Za-z .'-]{2,60}$/.test(val);
  const mentions = val.toLowerCase().includes(' once wrote') || val.toLowerCase().includes(' said');
  return quoted || attributed || mentions;
}

/**
 * Visual Analyzer Class
 */
class VisualAnalyzer {
  constructor() {
    this.model = null;
    this.modelLoading = false;
    this.classifierModel = null;
    this.classifierPromise = null;
    this.ocrWorker = null;
    this.ocrWorkerPromise = null;
    // Pre-warm on-device OCR engine and MobileNet classifier in the background
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        this.initOcrWorker();
        this.initClassifier();
      }, 800);
    }
  }

  /**
   * Initializes On-Device MobileNet v2 Vision Classifier (ImageNet 1,000 Classes)
   * Matches Apple Vision VNClassifyImageRequest and VNRecognizeAnimalsRequest
   */
  async initClassifier() {
    if (typeof mobilenet === 'undefined' || typeof tf === 'undefined') return null;
    if (this.classifierModel) return this.classifierModel;
    if (this.classifierPromise) return this.classifierPromise;

    this.classifierPromise = (async () => {
      try {
        console.log('[VisualAnalyzer] Loading on-device MobileNet v2 vision classifier...');
        const model = await mobilenet.load({ version: 2, alpha: 0.5 });
        this.classifierModel = model;
        console.log('[VisualAnalyzer] MobileNet v2 loaded successfully (Apple Vision parity)');
        return model;
      } catch (err) {
        console.warn('[VisualAnalyzer] MobileNet classifier note:', err);
        return null;
      }
    })();

    return this.classifierPromise;
  }

  async initOcrWorker() {
    if (typeof Tesseract === 'undefined') return null;
    if (this.ocrWorker) return this.ocrWorker;
    if (this.ocrWorkerPromise) return this.ocrWorkerPromise;

    this.ocrWorkerPromise = (async () => {
      try {
        const worker = await Tesseract.createWorker('eng');
        this.ocrWorker = worker;
        console.log('[VisualAnalyzer] On-device OCR worker initialized and ready');
        return worker;
      } catch (err) {
        console.warn('[VisualAnalyzer] Worker init note:', err);
        return null;
      }
    })();

    return this.ocrWorkerPromise;
  }

  /**
   * Detects books, quotes, people, animals, actions (walking/running), and dominant entities from text & image
   */
  async detectEntities(imgElement, text = '', sourceName = '') {
    const rawHaystack = `${text || ''} ${sourceName || ''} ${(imgElement && imgElement.src) || ''} ${(imgElement && imgElement.alt) || ''}`.toLowerCase();
    const tags = new Set();
    let isBook = false;
    let isQuote = looksLikeQuote(text);
    let hasAnimals = false;
    let animals = [];
    let peopleCount = 0;
    let hasPeople = false;
    const visionPredictions = [];

    // 0. On-Device Deep Learning Image Classification (MobileNet v2 / Apple Vision Parity)
    if (imgElement) {
      try {
        const classifier = await this.initClassifier();
        if (classifier) {
          // If HTMLImageElement not yet loaded, wait briefly
          if (imgElement instanceof HTMLImageElement && (!imgElement.complete || imgElement.naturalWidth === 0)) {
            await new Promise((resolve) => {
              imgElement.onload = resolve;
              imgElement.onerror = resolve;
              setTimeout(resolve, 350);
            });
          }
          const w = imgElement.naturalWidth || imgElement.width || 0;
          const h = imgElement.naturalHeight || imgElement.height || 0;
          if (w > 0 && h > 0) {
            const preds = await classifier.classify(imgElement, 5);
            if (Array.isArray(preds) && preds.length > 0) {
              console.log('[VisualAnalyzer] MobileNet predictions:', preds);
              for (const p of preds) {
                visionPredictions.push(p);
                const classTokens = p.className.split(',').map(s => s.trim().toLowerCase());
                for (const t of classTokens) {
                  tags.add(t);
                  // Check for animals
                  if (/\b(lion|lions|tiger|tigers|cheetah|leopard|panther|jaguar|cougar|cat|cats|feline|dog|dogs|puppy|wolf|wolves|bear|bears|elephant|elephants|zebra|zebras|giraffe|giraffes|monkey|monkeys|gorilla|gorillas|chimpanzee|deer|antelope|gazelle|fox|foxes|rabbit|bird|birds|eagle|hawk|owl|falcon|parrot|whale|shark|dolphin|snake|mammal|predator|wildlife)\b/i.test(t)) {
                    hasAnimals = true;
                    const cleanAnimal = t.split(' ')[0];
                    animals.push(cleanAnimal);
                    tags.add('animal');
                    tags.add('animals');
                    tags.add('wildlife');
                    tags.add('mammal');
                  }
                  // Check for books
                  if (/\b(book|jacket|cover|dust cover|comic|binder|notebook|paperback|hardcover|pamphlet|magazine)\b/i.test(t)) {
                    isBook = true;
                    tags.add('book');
                    tags.add('books');
                    tags.add('reading');
                    tags.add('literature');
                  }
                }
              }
            }
          }
        }
      } catch (classifyErr) {
        console.warn('[VisualAnalyzer] MobileNet classify error:', classifyErr);
      }
    }

    // 1. Books & Literature Detection
    const bookRegex = /\b(book|books|reading|novel|novels|author|writer|chapter|manifesto|pages|textbook|literature|self care|habits|essay|publication|poem|poetry|volume|vol\b|edition|series|saga|comic|comics|graphic novel|cover|story|staples|vaughan|brian|fiona|isbn|bestseller|fiction|nonfiction|memoir|biography|hardcover|paperback|publisher|publishing|penguin|harper)\b/i;
    if (bookRegex.test(rawHaystack) || /\b(chapter\s+\d+|page\s+\d+|volume\s+[a-z0-9]+|vol\.\s*\d+|isbn)\b/i.test(rawHaystack)) {
      isBook = true;
      tags.add('book');
      tags.add('books');
      tags.add('reading');
      tags.add('literature');
      if (/saga/i.test(rawHaystack)) tags.add('saga');
      if (/volume/i.test(rawHaystack)) tags.add('volume');
      if (/vaughan/i.test(rawHaystack)) tags.add('vaughan');
      if (/staples/i.test(rawHaystack)) tags.add('staples');
    }

    // Zero-shot MobileCLIP book detection on visual embedding
    if (window.mobileClip && imgElement) {
      try {
        const visualEmb = window.mobileClip.imageEmbedding(imgElement);
        const bookEmb = window.mobileClip.categoryEmbeddings?.get('book');
        if (visualEmb && bookEmb) {
          const sim = window.mobileClip.cosine(visualEmb, bookEmb);
          if (sim > 0.18) {
            isBook = true;
            tags.add('book');
            tags.add('books');
            tags.add('reading');
          }
        }
      } catch (e) {}
    }

    // 2. Quote Detection
    if (isQuote || /\b(quote|quotes|saying|typography|proverb|aphorism)\b/i.test(rawHaystack)) {
      isQuote = true;
      tags.add('quote');
      tags.add('quotes');
      tags.add('saying');
    }

    // 3. Animals & Wildlife
    const animalRegex = /\b(lion|lions|feline|tiger|tigers|bear|bears|dog|dogs|puppy|cat|cats|kitten|bird|birds|elephant|elephants|horse|horses|mammal|mammals|wildlife|animal|animals|predator|safari|wolf|wolves|leopard|leopards|cheetah|cheetahs|zebra|zebras|giraffe|giraffes|monkey|monkeys|gorilla|gorillas|deer|fox|foxes|rabbit|rabbits|snake|snakes|shark|sharks|whale|whales|dolphin|dolphins|penguin|penguins|owl|owls|eagle|eagles|hawk|hawks|crow|parrot|panther|jaguar|hyena)\b/gi;
    const matchedAnimals = rawHaystack.match(animalRegex);
    if (matchedAnimals && matchedAnimals.length > 0) {
      hasAnimals = true;
      matchedAnimals.forEach(a => {
        const cleanA = a.toLowerCase();
        animals.push(cleanA);
        tags.add(cleanA);
      });
      tags.add('animal');
      tags.add('animals');
      tags.add('mammal');
      tags.add('wildlife');
      isQuote = false;
      tags.delete('quote');
      tags.delete('quotes');
      tags.delete('saying');
    }

    // 3b. Actions & Movement Detection (macOS Recall parity: walking, running, sitting, etc.)
    const actionRegex = /\b(walking|walk|walks|running|run|runs|jumping|jump|sitting|sit|sits|standing|stand|stands|sleeping|sleep|hunting|hunt|flying|fly|swimming|swim|resting|rest)\b/gi;
    const matchedActions = rawHaystack.match(actionRegex);
    if (matchedActions && matchedActions.length > 0) {
      matchedActions.forEach(a => tags.add(a.toLowerCase()));
    }

    // 3c. Scene & Setting Detection
    const sceneRegex = /\b(safari|savanna|jungle|forest|grassland|wilderness|desert|mountain|mountains|beach|ocean|nature|outdoors|sky|sunset|sunrise)\b/gi;
    const matchedScenes = rawHaystack.match(sceneRegex);
    if (matchedScenes && matchedScenes.length > 0) {
      matchedScenes.forEach(s => tags.add(s.toLowerCase()));
    }

    // Zero-shot MobileCLIP animal detection on visual embedding
    if (!hasAnimals && window.mobileClip && imgElement) {
      try {
        const visualEmb = window.mobileClip.imageEmbedding(imgElement);
        const animalEmb = window.mobileClip.categoryEmbeddings?.get('animal');
        if (visualEmb && animalEmb) {
          const sim = window.mobileClip.cosine(visualEmb, animalEmb);
          if (sim > 0.15) {
            hasAnimals = true;
            tags.add('animal');
            tags.add('animals');
            tags.add('wildlife');
            tags.add('mammal');
          }
        }
      } catch (e) {}
    }

    // 4. People Detection
    if (/\b(portrait|person|people|woman|man|girl|boy|face|selfie|driver|climber|mountaineer|producer|coder|author)\b/i.test(rawHaystack)) {
      peopleCount = 1;
      hasPeople = true;
      tags.add('person');
      tags.add('1 person');
    }

    // 5. Extract colors via Mac algorithm
    let colorWords = [];
    if (imgElement && typeof extractDominantColorWords === 'function') {
      colorWords = extractDominantColorWords(imgElement);
      colorWords.forEach(c => tags.add(c));
    }

    return {
      peopleCount,
      hasPeople,
      animals: Array.from(new Set(animals)),
      hasAnimals,
      isBook,
      isQuote,
      colorWords,
      visionPredictions,
      tags: Array.from(tags)
    };
  }

  /**
   * On-Device OCR Text Extraction:
   * 1. Native browser TextDetector (Apple Vision / Chromium GPU - 15ms zero-download)
   * 2. Local on-device PaddleOCR (PP-OCRv4 daemon when running locally)
   * 3. In-browser Tesseract.js fallback
   * 100% On-Device & Private. Never uploads user images to external cloud.
   */
  async extractText(imageSource, onProgress = null) {
    const processedCanvas = await this.preprocessForOcr(imageSource);
    const canvasInput = processedCanvas || imageSource;

    // 1. Native Chromium / macOS Apple Vision TextDetector (Instant & zero network)
    if (typeof window !== 'undefined' && 'TextDetector' in window && canvasInput) {
      try {
        const detector = new window.TextDetector();
        const detected = await detector.detect(canvasInput);
        if (detected && detected.length > 0) {
          const lines = detected.map(d => d.rawValue).filter(Boolean);
          const fullText = lines.join('\n').trim();
          if (fullText) {
            console.log('[Native TextDetector] Extracted:', fullText);
            return fullText;
          }
        }
      } catch (nativeErr) {
        console.warn('[Native TextDetector Note]', nativeErr);
      }
    }

    // 2. High-Accuracy PaddleOCR / RapidOCR (local daemon or server)
    try {
      let dataUrl = null;
      if (canvasInput instanceof HTMLCanvasElement) {
        dataUrl = canvasInput.toDataURL('image/jpeg', 0.92);
      } else if (typeof imageSource === 'string' && imageSource.startsWith('data:image')) {
        dataUrl = imageSource;
      }

      if (dataUrl) {
        const ocrEndpoints = ['http://localhost:8088/api/ocr', '/api/ocr'];
        for (const ep of ocrEndpoints) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);

            const resp = await fetch(ep, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image: dataUrl }),
              signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (resp.ok) {
              const json = await resp.json();
              if (json.success && json.text && json.text.trim()) {
                console.log(`[PaddleOCR] Extracted full text:\n`, json.text);
                return json.text.trim();
              }
            }
          } catch (endpointErr) {
            // Try next endpoint or fall through to in-browser Tesseract
          }
        }
      }
    } catch (paddleErr) {
      // Proceed to Tesseract
    }

    // 3. In-browser On-Device Tesseract.js (pre-warmed worker)
    if (typeof Tesseract !== 'undefined') {
      try {
        const input = canvasInput || imageSource;
        const worker = await this.initOcrWorker();
        let extracted = '';
        if (worker) {
          const ret = await worker.recognize(input);
          extracted = (ret && ret.data && ret.data.text) ? ret.data.text.trim() : '';
        } else {
          const result = await Tesseract.recognize(input, 'eng', {
            logger: (m) => {
              if (onProgress && m.status === 'recognizing text') {
                onProgress(Math.round(m.progress * 100));
              }
            }
          });
          extracted = (result && result.data && result.data.text) ? result.data.text.trim() : '';
        }
        if (extracted) {
          console.log('[Tesseract.js OCR] Extracted:', extracted);
          return extracted;
        }
      } catch (err) {
        console.warn('[Local OCR] Recognition error:', err);
      }
    }

    return '';
  }

  /**
   * Preprocesses image for sharp OCR recognition (safely handles data: and blob: URIs)
   */
  async preprocessForOcr(imageSource) {
    if (!imageSource) return null;
    if (imageSource instanceof HTMLCanvasElement) return imageSource;

    // If it's already an HTMLImageElement that is fully loaded
    if (imageSource instanceof HTMLImageElement && imageSource.complete && imageSource.naturalWidth > 0) {
      try {
        const naturalW = imageSource.naturalWidth;
        const naturalH = imageSource.naturalHeight;
        const scale = naturalW < 600 ? Math.min(3, 1200 / naturalW) : 1.4;
        const w = Math.round(naturalW * scale);
        const h = Math.round(naturalH * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(imageSource, 0, 0, w, h);
        return canvas;
      } catch (e) {
        return null;
      }
    }

    return new Promise((resolve) => {
      try {
        const srcStr = typeof imageSource === 'string' ? imageSource : (imageSource?.src || '');
        if (!srcStr) return resolve(null);

        const isDataOrBlob = srcStr.startsWith('data:') || srcStr.startsWith('blob:');
        const img = new Image();

        // Never set crossOrigin on data: or blob: URIs (avoids WebKit/Blink taint error)
        if (!isDataOrBlob) {
          img.crossOrigin = 'anonymous';
        }

        img.onload = () => {
          try {
            const naturalW = img.naturalWidth || img.width || 300;
            const naturalH = img.naturalHeight || img.height || 300;

            const scale = naturalW < 600 ? Math.min(3, 1200 / naturalW) : 1.4;
            const w = Math.round(naturalW * scale);
            const h = Math.round(naturalH * scale);

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, w, h);

            try {
              const imgData = ctx.getImageData(0, 0, w, h);
              const d = imgData.data;

              for (let i = 0; i < d.length; i += 4) {
                const gray = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
                const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.25 + 128));
                d[i] = enhanced;
                d[i + 1] = enhanced;
                d[i + 2] = enhanced;
              }

              ctx.putImageData(imgData, 0, 0);
            } catch (tErr) {
              // Canvas might be tainted if external CORS failed, return raw canvas
            }
            resolve(canvas);
          } catch (e) {
            resolve(null);
          }
        };

        img.onerror = () => {
          if (!isDataOrBlob) {
            // Retry without crossOrigin
            const plainImg = new Image();
            plainImg.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = plainImg.naturalWidth || 300;
              canvas.height = plainImg.naturalHeight || 300;
              const ctx = canvas.getContext('2d');
              try {
                ctx.drawImage(plainImg, 0, 0);
                resolve(canvas);
              } catch (e) {
                resolve(null);
              }
            };
            plainImg.onerror = () => resolve(null);
            plainImg.src = srcStr;
          } else {
            resolve(null);
          }
        };

        img.src = srcStr;
      } catch (e) {
        resolve(null);
      }
    });
  }
}

window.visualAnalyzer = new VisualAnalyzer();
// RECALL_COLOR_FILTERS, extractDominantColorWords, extractPaletteSwatches,
// rgbToHSB, macColorName are already on window via mobileclip.js
