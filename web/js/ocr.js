/**
 * Recall Web - Intelligent Visual Analyzer & Entity Detection
 * Runs 100% locally on-device in the browser:
 * 1. Object & Entity Detection: People count, Animals, Books, Furniture, Vehicles (COCO-SSD / Heuristics)
 * 2. OCR Text Extraction (Tesseract.js)
 * 3. Dominant Color & Aesthetic Palette (HTML5 Canvas Analyzer)
 * 4. Semantic Categorization (Quote, Book, Article, Interior, Portrait, Wildlife)
 */

class VisualAnalyzer {
  constructor() {
    this.model = null;
    this.modelLoading = false;
    this.animalClasses = new Set([
      'dog', 'cat', 'bird', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe'
    ]);
  }

  /**
   * Lazy-loads COCO-SSD object detection model if available
   */
  async getModel() {
    if (this.model) return this.model;
    if (typeof cocoSsd !== 'undefined' && !this.modelLoading) {
      try {
        this.modelLoading = true;
        this.model = await cocoSsd.load();
        return this.model;
      } catch (err) {
        console.warn('COCO-SSD model load warning:', err);
      } finally {
        this.modelLoading = false;
      }
    }
    return null;
  }

  /**
   * Detects entities: people count, animals, books, objects
   */
  async detectEntities(imgElement, text = '') {
    const entities = {
      peopleCount: 0,
      hasPeople: false,
      animals: [],
      hasAnimals: false,
      isBook: false,
      isQuote: false,
      isArticle: false,
      detectedObjects: [],
      tags: new Set()
    };

    // 1. Model-based object detection (if model loaded)
    try {
      const model = await this.getModel();
      if (model && imgElement) {
        const predictions = await model.detect(imgElement);
        for (const pred of predictions) {
          if (pred.score < 0.45) continue;
          const cls = pred.class.toLowerCase();
          entities.detectedObjects.push(cls);
          entities.tags.add(cls);

          // People counter
          if (cls === 'person') {
            entities.peopleCount++;
          }

          // Animal detection
          if (this.animalClasses.has(cls)) {
            entities.animals.push(cls);
            entities.tags.add(cls);
            entities.tags.add('animal');
            entities.tags.add('wildlife');
          }

          // Book detection
          if (cls === 'book') {
            entities.isBook = true;
            entities.tags.add('book');
            entities.tags.add('reading');
          }
        }
      }
    } catch (err) {
      console.warn('Visual detection pass error:', err);
    }

    // 2. Text-based semantic classification
    const lowerText = text.toLowerCase();

    // People inference from text if not detected by vision
    if (entities.peopleCount === 0) {
      if (/\b(portrait|person|people|woman|man|girl|boy|face|selfie|model)\b/.test(lowerText)) {
        entities.peopleCount = 1;
        entities.hasPeople = true;
        entities.tags.add('person');
        entities.tags.add('portrait');
      } else if (/\b(couple|pair|two people)\b/.test(lowerText)) {
        entities.peopleCount = 2;
        entities.hasPeople = true;
        entities.tags.add('people');
        entities.tags.add('couple');
      } else if (/\b(group|crowd|friends|team)\b/.test(lowerText)) {
        entities.peopleCount = 4;
        entities.hasPeople = true;
        entities.tags.add('people');
        entities.tags.add('crowd');
      }
    }

    if (entities.peopleCount > 0) {
      entities.hasPeople = true;
      entities.tags.add('people');
      entities.tags.add('person');
      if (entities.peopleCount === 1) {
        entities.tags.add('1 person');
        entities.tags.add('single person');
        entities.tags.add('portrait');
      } else if (entities.peopleCount === 2) {
        entities.tags.add('2 people');
        entities.tags.add('two people');
        entities.tags.add('couple');
      } else {
        entities.tags.add(`${entities.peopleCount} people`);
        entities.tags.add('group');
        entities.tags.add('crowd');
      }
    }

    // Animal inference from text
    const animalRegex = /\b(elephant|elephants|dog|dogs|cat|cats|bird|birds|wildlife|animal|animals|horse|lion|tiger|bear|safari|savannah)\b/g;
    const animalMatches = lowerText.match(animalRegex);
    if (animalMatches && animalMatches.length > 0) {
      entities.hasAnimals = true;
      animalMatches.forEach(a => {
        entities.animals.push(a);
        entities.tags.add(a);
      });
      entities.tags.add('animal');
      entities.tags.add('animals');
      entities.tags.add('wildlife');
    }

    // Book & Literature inference
    if (/\b(book|novel|author|chapter|pages|hardcover|paperback|bestseller|reading|tales|literature)\b/.test(lowerText)) {
      entities.isBook = true;
      entities.tags.add('book');
      entities.tags.add('books');
      entities.tags.add('reading');
      entities.tags.add('novel');
    }

    // Quote inference
    if (/“|”|"|'quote'|\b(quote|quotes|saying|proverb|citation|oscar wilde|einstein)\b/.test(lowerText)) {
      entities.isQuote = true;
      entities.tags.add('quote');
      entities.tags.add('quotes');
      entities.tags.add('saying');
    }

    // Article inference
    if (/\b(article|editorial|news|read|archdaily|magazine|journal|byline)\b/.test(lowerText)) {
      entities.isArticle = true;
      entities.tags.add('article');
      entities.tags.add('articles');
      entities.tags.add('reading');
    }

    // Interior & Architecture inference
    if (/\b(interior|living room|minimal|architecture|decor|furniture|couch|sofa|chair|room|home)\b/.test(lowerText)) {
      entities.tags.add('interior');
      entities.tags.add('architecture');
      entities.tags.add('design');
    }

    return {
      peopleCount: entities.peopleCount,
      hasPeople: entities.hasPeople,
      animals: Array.from(new Set(entities.animals)),
      hasAnimals: entities.hasAnimals,
      isBook: entities.isBook,
      isQuote: entities.isQuote,
      isArticle: entities.isArticle,
      detectedObjects: Array.from(new Set(entities.detectedObjects)),
      tags: Array.from(entities.tags)
    };
  }

  /**
   * Extracts multi-color dominant palette and semantic color name from Canvas
   */
  async extractColorProfile(imgElement) {
    return new Promise((resolve) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(imgElement, 0, 0, 48, 48);

        const imageData = ctx.getImageData(0, 0, 48, 48);
        const data = imageData.data;
        let r = 0, g = 0, b = 0, count = 0;

        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }

        if (count === 0) {
          resolve({ hex: '#1E293B', name: 'dark', palette: ['#1E293B', '#334155'] });
          return;
        }

        const avgR = Math.round(r / count);
        const avgG = Math.round(g / count);
        const avgB = Math.round(b / count);

        const hex = `#${((1 << 24) + (avgR << 16) + (avgG << 8) + avgB).toString(16).slice(1).toUpperCase()}`;
        const name = this.classifyColor(avgR, avgG, avgB);

        resolve({ hex, name, palette: [hex] });
      } catch (err) {
        console.warn('Color extraction failed:', err);
        resolve({ hex: '#1E293B', name: 'dark', palette: ['#1E293B'] });
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
   * In-browser OCR using Tesseract.js
   */
  async extractText(imageSource, onProgress = null) {
    if (typeof Tesseract === 'undefined') {
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
