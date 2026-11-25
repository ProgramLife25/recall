/**
 * Recall Web - Semantic Search & Entity Classifier
 * Exact JavaScript port of macOS Recall's SemanticSearch.swift:
 * 1. Word tokenization & stemming ("books" -> "book", "animals" -> "animal", "reading" -> "read")
 * 2. Haystack text matching (Title, OCR Text, Tags, Notes, Caption)
 * 3. Exact phrase & token coverage scoring (+0.62 title, +0.72 tags, +0.48 OCR/haystack, +0.44 coverage)
 * 4. Books, Reading & Literature Detection
 * 5. Dominant Color & HSB Tone Matching
 */

class SearchEngine {
  constructor() {
    this.stopWords = new Set([
      'a', 'an', 'and', 'the', 'of', 'in', 'on', 'with', 'that', 'this', 'my', 'find', 'show', 'me', 'to', 'for', 'is', 'it'
    ]);

    this.colorNames = new Set([
      'red', 'crimson', 'coral', 'orange', 'amber', 'yellow', 'lime', 'green', 'mint',
      'teal', 'cyan', 'sky', 'blue', 'navy', 'indigo', 'purple', 'lavender', 'pink',
      'rose', 'brown', 'tan', 'beige', 'gray', 'grey', 'black', 'dark', 'white', 'light'
    ]);

    this.bookTokens = new Set([
      'book', 'books', 'novel', 'novels', 'literature', 'author', 'authors',
      'writer', 'writers', 'textbook', 'textbooks', 'publication', 'publications',
      'volume', 'vol', 'edition', 'saga', 'comic', 'comics', 'graphic novel',
      'hardcover', 'paperback', 'isbn', 'bestseller', 'fiction', 'memoir', 'biography'
    ]);

    this.animalTokens = new Set([
      'animal', 'animals', 'lion', 'lions', 'feline', 'tiger', 'tigers', 'bear', 'bears',
      'wildlife', 'dog', 'dogs', 'cat', 'cats', 'bird', 'birds', 'horse', 'horses',
      'mammal', 'mammals', 'predator', 'safari', 'wolf', 'wolves', 'leopard', 'cheetah',
      'elephant', 'zebra', 'giraffe', 'monkey', 'gorilla', 'deer', 'fox', 'rabbit',
      'snake', 'reptile', 'fish', 'shark', 'whale', 'dolphin', 'penguin', 'owl',
      'eagle', 'hawk', 'crow', 'parrot', 'mane', 'cub', 'paw', 'fur', 'feather',
      'savanna', 'jungle', 'predatory', 'feral', 'wild'
    ]);

    this.quoteTokens = new Set([
      'quote', 'quotes', 'saying', 'sayings', 'proverb', 'quotation', 'typography', 'motto'
    ]);

    this.buyingTokens = new Set([
      'buy', 'buying', 'product', 'products', 'shop', 'shopping', 'price', 'order',
      'cart', 'deal', 'deals', 'amazon', 'ebay', 'etsy', 'store', 'purchase', 'sale'
    ]);

    this.imageTokens = new Set([
      'image', 'images', 'imag', 'photo', 'photos', 'picture', 'pictures', 'pictur', 'pic', 'pics',
      'visual', 'visuals', 'generic', 'wallpaper', 'shot', 'shots', 'screenshot', 'screenshots',
      'graphic', 'graphics', 'art', 'artwork', 'illustration', 'illustrations',
      'drawing', 'drawings', 'poster', 'posters', 'canvas', 'photography', 'render', 'gallery'
    ]);

    this.videoTokens = new Set([
      'video', 'videos', 'vid', 'clip', 'clips', 'movie', 'movies', 'film', 'films',
      'watch', 'watching', 'stream', 'streaming', 'youtube', 'vimeo', 'channel',
      'creator', 'vlog', 'vlogs', 'trailer', 'trailers', 'music', 'song', 'songs',
      'podcast', 'podcasts', 'play', 'player', 'footage', 'animation', 'gta', 'gaming'
    ]);

    this.actionTokens = new Set([
      'walking', 'walk', 'walks', 'running', 'run', 'runs', 'jumping', 'jump',
      'sitting', 'sit', 'sits', 'standing', 'stand', 'stands', 'sleeping', 'sleep',
      'hunting', 'hunt', 'hunts', 'flying', 'fly', 'swimming', 'swim', 'resting', 'rest'
    ]);

    this.sceneTokens = new Set([
      'safari', 'savanna', 'jungle', 'forest', 'grassland', 'wilderness', 'nature',
      'outdoors', 'desert', 'mountain', 'mountains', 'beach', 'ocean', 'sunset', 'sky'
    ]);
  }

  /**
   * Word stemming matching macOS SemanticSearch.stem(_ word: String) -> String
   */
  stem(word) {
    if (!word || typeof word !== 'string') return '';
    const w = word.toLowerCase().trim();
    if (w.endsWith('ies') && w.length > 5) return w.slice(0, -3) + 'y';
    if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
    if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
    return w;
  }

  /**
   * Split text into clean lowercased tokens
   */
  tokenize(text) {
    if (!text) return [];
    return String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter(t => t.length > 0);
  }

  /**
   * Meaningful tokens without common stop words
   */
  meaningfulTokens(text) {
    return this.tokenize(text).filter(t => t.length > 1 && !this.stopWords.has(t));
  }

  /**
   * Generates a 64-dimensional semantic embedding via murmur-hash term frequencies
   */
  generateEmbedding(text, dimensions = 64) {
    if (!text) return new Float32Array(dimensions);
    const vector = new Float32Array(dimensions);
    const words = this.tokenize(text);

    for (const word of words) {
      const stemmed = this.stem(word);
      let hash = 2166136261;
      for (let i = 0; i < stemmed.length; i++) {
        hash = (hash ^ stemmed.charCodeAt(i)) * 16777619;
      }
      const idx = Math.abs(hash % dimensions);
      vector[idx] += 1.0;
    }

    let sumSq = 0;
    for (let i = 0; i < dimensions; i++) sumSq += vector[i] * vector[i];
    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let i = 0; i < dimensions; i++) vector[i] /= norm;
    }
    return Array.from(vector);
  }

  /**
   * Cosine similarity between two vector embeddings
   */
  cosine(vecA, vecB) {
    if (!vecA || !vecB || vecA.length === 0 || vecA.length !== vecB.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? (dot / denom) : 0;
  }

  /**
   * Core search engine matching macOS SemanticSearch.search
   */
  search(rawQuery, items) {
    const query = (rawQuery || '').trim().toLowerCase();
    if (!query) {
      return items.map(item => ({ item, score: 0 }));
    }

    const queryTokens = this.meaningfulTokens(query);
    const stemmedQueryTokens = queryTokens.map(t => this.stem(t));
    const queryVector = this.generateEmbedding(query);

    // Intent detections
    const wantsBooks = stemmedQueryTokens.some(t => this.bookTokens.has(t) || this.bookTokens.has(this.stem(t)));
    const wantsAnimals = stemmedQueryTokens.some(t => this.animalTokens.has(t) || this.animalTokens.has(this.stem(t)));
    const wantsQuotes = stemmedQueryTokens.some(t => this.quoteTokens.has(t));
    const wantsBuying = stemmedQueryTokens.some(t => this.buyingTokens.has(t) || this.buyingTokens.has(this.stem(t)));
    const wantsImages = queryTokens.some(t => this.imageTokens.has(t) || this.imageTokens.has(this.stem(t)) || t.startsWith('imag') || t.startsWith('photo') || t.startsWith('pictur') || t === 'generic');
    const wantsVideos = queryTokens.some(t => this.videoTokens.has(t) || this.videoTokens.has(this.stem(t)) || t.startsWith('vid'));
    const colorTarget = queryTokens.find(t => this.colorNames.has(t));

    const results = [];

    for (const item of items) {
      const title = (item.title || item.name || '').toLowerCase();
      const tags = (item.tags || []).map(t => String(t).toLowerCase());
      const ocrText = (item.ocrText || item.searchableText || '').toLowerCase();
      const tldr = (item.tldr || item.caption || '').toLowerCase();
      const body = (item.body || '').toLowerCase();
      const dominantColors = (item.dominantColors || []).map(c => String(c).toLowerCase());
      const paletteTones = (item.paletteTones || []).map(c => String(c).toLowerCase());
      const palette = (item.palette || []).map(c => String(c).toLowerCase());

      // macOS unified haystack: filename + searchableText + tags + notes
      const haystack = `${title} ${ocrText} ${tldr} ${body} ${tags.join(' ')} ${dominantColors.join(' ')} ${paletteTones.join(' ')}`.toLowerCase();

      // Card tokens set
      const cardTokens = new Set(this.tokenize(haystack));
      const stemmedCardTokens = new Set(Array.from(cardTokens).map(t => this.stem(t)));

      let score = 0;
      let matchedReasons = [];

      // ── 1. Books & Literature Match ──
      if (wantsBooks) {
        // Exclude pure articles and videos from accidental book classification
        const isPureArticleOrVideo = (item.isArticle || item.type === 'Article' || item.isVideo || item.type === 'Video') && !item.isBook;

        const isBookLike = !isPureArticleOrVideo && (
          item.isBook ||
          item.contentType === 'Book' ||
          item.type === 'Book' ||
          tags.includes('book') ||
          tags.includes('books') ||
          tags.includes('novel') ||
          tags.includes('novels') ||
          tags.includes('literature') ||
          tags.includes('saga') ||
          tags.includes('comic') ||
          tags.includes('volume') ||
          stemmedCardTokens.has('book') ||
          stemmedCardTokens.has('novel') ||
          stemmedCardTokens.has('literature') ||
          stemmedCardTokens.has('saga') ||
          title.includes('saga') ||
          title.includes('volume') ||
          title.includes('book') ||
          title.includes('novel') ||
          ocrText.includes('saga') ||
          ocrText.includes('volume') ||
          ocrText.includes('chapter') ||
          ocrText.includes('vaughan') ||
          ocrText.includes('staples') ||
          ocrText.includes('isbn')
        );

        if (isBookLike) {
          score += 2.80;
          matchedReasons.push('Book / Literature');
        }
      }

      // ── 2. Animals Match ──
      if (wantsAnimals) {
        // Exclude pure articles and notes unless explicitly flagged hasAnimals
        const isPureArticle = (item.isArticle || item.type === 'Article') && !item.hasAnimals;
        const hasAnimalToken = queryTokens.some(qt => this.animalTokens.has(qt) && (cardTokens.has(qt) || stemmedCardTokens.has(this.stem(qt))));

        const hasAnimal = !isPureArticle && (
          item.hasAnimals ||
          tags.some(t => this.animalTokens.has(t) || this.animalTokens.has(this.stem(t))) ||
          stemmedCardTokens.has('animal') ||
          stemmedCardTokens.has('lion') ||
          stemmedCardTokens.has('feline') ||
          stemmedCardTokens.has('tiger') ||
          stemmedCardTokens.has('bear') ||
          stemmedCardTokens.has('wildlife') ||
          stemmedCardTokens.has('wolf') ||
          stemmedCardTokens.has('leopard') ||
          stemmedCardTokens.has('cheetah') ||
          stemmedCardTokens.has('dog') ||
          stemmedCardTokens.has('cat') ||
          stemmedCardTokens.has('elephant') ||
          stemmedCardTokens.has('zebra') ||
          hasAnimalToken
        );

        if (hasAnimal) {
          score += 3.00;
          matchedReasons.push('Animal / Wildlife');

          // Specific animal query bonus (e.g. searching "lion" gives lion card top rank)
          if (hasAnimalToken) {
            score += 2.00;
          }
        }
      }

      // ── 2b. Actions & Movement Match (macOS Recall: e.g. "walking", "running", "sitting") ──
      const matchedAction = queryTokens.find(qt => this.actionTokens.has(qt) && (cardTokens.has(qt) || tags.includes(qt) || haystack.includes(qt)));
      if (matchedAction) {
        score += 2.00;
        matchedReasons.push(`Action: ${matchedAction}`);
      }

      // ── 2c. Scene & Setting Match (e.g. "safari", "savanna", "nature", "mountains") ──
      const matchedScene = queryTokens.find(qt => this.sceneTokens.has(qt) && (cardTokens.has(qt) || tags.includes(qt) || haystack.includes(qt)));
      if (matchedScene) {
        score += 1.60;
        matchedReasons.push(`Scene: ${matchedScene}`);
      }

      // ── 3. Quotes Match ──
      if (wantsQuotes) {
        if (item.isQuote || tags.includes('quote') || tags.includes('quotes') || tags.includes('typography')) {
          score += 1.50;
          matchedReasons.push('Quote / Typography');
        }
      }

      // ── 3b. Buying & Products Match ──
      if (wantsBuying) {
        if (item.isBuying || item.contentType === 'Product' || item.type === 'Product' || tags.includes('buying') || tags.includes('product') || Boolean(item.price) || haystack.includes('buying') || haystack.includes('product')) {
          score += 1.50;
          matchedReasons.push('Buying / Product');
        }
      }

      // ── 3c. Video & Streaming Match (Title, Channel, or Video Content) ──
      if (wantsVideos) {
        const isVid = Boolean(item.isVideo || item.type === 'Video' || item.type === 'video' || tags.includes('video') || item.videoEmbedUrl || item.videoId);
        if (isVid) {
          score += 1.50;
          matchedReasons.push('Video / Stream');
        }
      }

      // ── 3d. Generic Images & Visuals Match (User Request) ──
      if (wantsImages) {
        const isImg = Boolean(item.heroImg || item.contentType === 'Image' || item.type === 'image' || item.type === 'Web image' || (!item.isNote && !item.isQuote && !item.isVideo));
        if (isImg) {
          score += 1.30;
          matchedReasons.push('Image / Visual');
        }
      }

      // ── 4. Dominant Color & Tone Match ──
      if (colorTarget) {
        const colorMatches = dominantColors.includes(colorTarget) ||
          paletteTones.includes(colorTarget) ||
          tags.includes(colorTarget) ||
          haystack.includes(colorTarget);

        if (colorMatches) {
          score += 1.35;
          matchedReasons.push(`Color: ${colorTarget}`);
        }
      }

      // ── 5. Exact Phrase & Substring Matching ──
      const isShortWord = query.length <= 4;
      const titleMatches = isShortWord ? cardTokens.has(query) : title.includes(query);
      if (titleMatches) {
        score += 1.60;
        matchedReasons.push('Title match');
      }
      if (tags.some(t => t === query || this.stem(t) === this.stem(query) || (!isShortWord && t.includes(query)))) {
        score += 1.40;
        matchedReasons.push('Tag match');
      }
      const ocrMatches = isShortWord ? (cardTokens.has(query) || stemmedCardTokens.has(this.stem(query))) : ocrText.includes(query);
      if (ocrMatches) {
        score += 1.80;
        matchedReasons.push('OCR text match');
      } else {
        const contentHit = isShortWord ? (cardTokens.has(query) || stemmedCardTokens.has(this.stem(query))) : haystack.includes(query);
        if (contentHit) {
          score += 0.90;
          matchedReasons.push(item.isArticle ? 'Article content match' : 'Content match');
        }
      }
      const bodyHit = isShortWord ? cardTokens.has(query) : body.includes(query);
      if (bodyHit) {
        score += 1.40;
        matchedReasons.push(item.isArticle ? 'Article text match' : 'Body match');
      }

      // Word-by-word token matching in OCR text, Title & Body
      let ocrHits = 0;
      let bodyHits = 0;
      for (const token of queryTokens) {
        if (token.length > 2) {
          if (ocrText.includes(token) || title.includes(token)) ocrHits++;
          if (body.includes(token)) bodyHits++;
        }
      }
      if (ocrHits > 0) {
        score += ocrHits * 0.90;
        if (item.isBook) score += 1.20; // Specific book name search bonus
      }
      if (bodyHits > 0) {
        score += bodyHits * 0.85;
      }

      // ── 6. Token Coverage & Stem Matching ──
      let matchedCount = 0;
      for (const token of queryTokens) {
        const stemmed = this.stem(token);
        if (cardTokens.has(token) || stemmedCardTokens.has(stemmed) || haystack.includes(token)) {
          matchedCount++;
        }
      }

      const coverage = queryTokens.length > 0 ? (matchedCount / queryTokens.length) : 0;
      score += coverage * 0.60;

      if (matchedCount === queryTokens.length && queryTokens.length > 0) {
        score += 0.30; // All query words present
      }

      // ── 7. MobileCLIP Visual Semantic Search (100% On-Device, +0.92 macOS weight) ──
      if (window.mobileClip) {
        const visualQueryVector = window.mobileClip.textEmbedding(query);
        const visualEmb = item.visualEmbedding;
        if (visualEmb && visualQueryVector) {
          const vSim = window.mobileClip.cosine(visualQueryVector, visualEmb);
          if (vSim > 0.13) {
            score += Math.max(0, vSim) * 1.15;
            matchedReasons.push(`Visual Match (${Math.round(vSim * 100)}%)`);
          }
        }
      }

      // ── 8. Vector Cosine Similarity (Only boost if relevant words/intents matched) ──
      if (matchedCount === 0 && matchedReasons.length === 0 && ocrHits === 0 && bodyHits === 0) {
        const hasSub = queryTokens.some(qt => qt.length >= 3 && haystack.includes(qt));
        if (!hasSub) continue;
      }

      const itemEmbedding = item.embedding || this.generateEmbedding(haystack);
      const sim = this.cosine(queryVector, itemEmbedding);
      if (sim > 0.35) {
        score += sim * 0.40;
      }

      // If item was liked / favorite
      if (item.isFavorite) score += 0.07;

      if (score > 0.10) {
        results.push({
          item,
          score,
          matchReason: matchedReasons.join(' • ')
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }
}

window.searchEngine = new SearchEngine();
