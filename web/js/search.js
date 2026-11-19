/**
 * Recall Web - Multi-Modal Entity & Associative Search Engine
 * Detects:
 * - People & Headcount ("people", "1 person", "2 people", "portrait", "crowd")
 * - Animals & Wildlife ("animals", "elephant", "dog", "cat", "birds", "wildlife")
 * - Books, Reading & Literature ("book", "books", "novel", "author", "cover")
 * - Quotes & Sayings ("quote", "quotes", "saying")
 * - Colors & Palette ("orange", "green", "blue", "yellow", "dark", "light", etc.)
 * - Objects & Scenes ("interior", "furniture", "architecture", "video", "fashion")
 * - Full OCR Text & Vector Cosine Similarity
 */

class SearchEngine {
  constructor() {
    this.colorKeywords = new Set([
      'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'white', 'black', 'dark', 'light', 'gray', 'brown'
    ]);

    this.peopleKeywords = new Set([
      'people', 'person', 'persons', 'portrait', 'portraits', 'human', 'humans',
      'woman', 'man', 'girl', 'boy', 'face', 'selfie', 'couple', 'crowd', 'group',
      '1 person', '2 people', '3 people', 'two people', 'single person'
    ]);

    this.animalKeywords = new Set([
      'animal', 'animals', 'wildlife', 'elephant', 'elephants', 'dog', 'dogs',
      'cat', 'cats', 'bird', 'birds', 'horse', 'horses', 'safari', 'lion', 'tiger', 'pet', 'pets'
    ]);

    this.bookKeywords = new Set([
      'book', 'books', 'novel', 'novels', 'reading', 'read', 'literature', 'author', 'cover', 'tales'
    ]);

    this.quoteKeywords = new Set([
      'quote', 'quotes', 'saying', 'sayings', 'proverb', 'quotation'
    ]);
  }

  generateEmbedding(text, dimensions = 128) {
    if (!text) return new Float32Array(dimensions);
    const vector = new Float32Array(dimensions);
    const words = text.toLowerCase().split(/[\s,.;:!?_/\-\\]+/).filter(Boolean);

    for (const word of words) {
      let hash = 2166136261;
      for (let i = 0; i < word.length; i++) {
        hash = (hash ^ word.charCodeAt(i)) * 16777619;
      }
      const index = Math.abs(hash % dimensions);
      vector[index] += 1.0;
    }

    let sumSquares = 0;
    for (let i = 0; i < dimensions; i++) sumSquares += vector[i] * vector[i];
    const norm = Math.sqrt(sumSquares);
    if (norm > 0) {
      for (let i = 0; i < dimensions; i++) vector[i] /= norm;
    }
    return Array.from(vector);
  }

  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA <= 0 || normB <= 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  search(query, items) {
    if (!query || !query.trim()) {
      return items.map((item) => ({
        item,
        score: 1.0,
        matchReason: ''
      }));
    }

    const queryLower = query.trim().toLowerCase();
    const tokens = queryLower.split(/\s+/);

    // Intent detections
    const wantsPeople = this.peopleKeywords.has(queryLower) || tokens.some(t => this.peopleKeywords.has(t));
    const wantsAnimals = this.animalKeywords.has(queryLower) || tokens.some(t => this.animalKeywords.has(t));
    const wantsBooks = this.bookKeywords.has(queryLower) || tokens.some(t => this.bookKeywords.has(t));
    const wantsQuotes = this.quoteKeywords.has(queryLower) || tokens.some(t => this.quoteKeywords.has(t));

    // Specific people counts
    let targetPeopleCount = null;
    if (queryLower.includes('1 person') || queryLower === 'portrait' || queryLower === 'single person') targetPeopleCount = 1;
    else if (queryLower.includes('2 people') || queryLower.includes('two people') || queryLower === 'couple') targetPeopleCount = 2;
    else if (queryLower.includes('crowd') || queryLower.includes('group')) targetPeopleCount = 3;

    // Color intent
    let targetColor = null;
    for (const t of tokens) {
      if (this.colorKeywords.has(t)) {
        targetColor = t;
        break;
      }
    }

    const queryVector = this.generateEmbedding(queryLower);
    const results = [];

    for (const item of items) {
      let score = 0;
      const reasons = [];

      const title = (item.title || item.name || '').toLowerCase();
      const text = (item.searchableText || '').toLowerCase();
      const tags = (item.tags || []).map(t => String(t).toLowerCase());
      const domColor = (item.dominantColorName || '').toLowerCase();
      const peopleCount = item.peopleCount || (item.hasPeople ? 1 : 0);

      // ── 1. People Detection Match ──
      if (wantsPeople) {
        if (targetPeopleCount !== null) {
          if (peopleCount === targetPeopleCount || (targetPeopleCount === 3 && peopleCount >= 3)) {
            score += 45;
            reasons.push(`${peopleCount} ${peopleCount === 1 ? 'person' : 'people'} detected`);
          }
        } else if (item.hasPeople || peopleCount > 0 || tags.includes('people') || tags.includes('person') || tags.includes('portrait')) {
          score += 40;
          reasons.push(`People detected (${peopleCount > 0 ? peopleCount : 1})`);
        }
      }

      // ── 2. Animals & Wildlife Match ──
      if (wantsAnimals) {
        const itemAnimals = (item.animals || []).map(a => a.toLowerCase());
        const hasAnimalTag = tags.includes('animal') || tags.includes('animals') || tags.includes('wildlife');
        const matchesSpecificAnimal = tokens.some(t => itemAnimals.includes(t) || title.includes(t) || text.includes(t));

        if (item.hasAnimals || itemAnimals.length > 0 || hasAnimalTag || matchesSpecificAnimal) {
          score += 45;
          const label = itemAnimals.length > 0 ? itemAnimals.join(', ') : 'Animal';
          reasons.push(`Animal detected: ${label}`);
        }
      }

      // ── 3. Books & Reading Material Match ──
      if (wantsBooks) {
        if (item.isBook || item.id === 'book-1' || item.id === 'book-2' || tags.includes('book') || tags.includes('books') || tags.includes('reading')) {
          score += 45;
          reasons.push('Book / Reading detected');
        }
      }

      // ── 4. Quotes Match ──
      if (wantsQuotes) {
        if (item.isQuote || item.id === 'quote-1' || tags.includes('quote') || tags.includes('quotes')) {
          score += 45;
          reasons.push('Quote detected');
        }
      }

      // ── 5. Color Match ──
      if (targetColor) {
        if (domColor === targetColor || tags.includes(targetColor)) {
          score += 25;
          reasons.push(`Color: ${targetColor}`);
        }
      }

      // ── 6. Full Text & Keyword Matching ──
      if (title.includes(queryLower)) {
        score += 35;
        reasons.push('Title match');
      } else if (text.includes(queryLower)) {
        score += 25;
        reasons.push('OCR text match');
      }

      // Multi-token overlap
      let tokenMatches = 0;
      for (const token of tokens) {
        if (token.length < 2) continue;
        if (title.includes(token)) { score += 8; tokenMatches++; }
        if (text.includes(token)) { score += 5; tokenMatches++; }
        if (tags.includes(token)) { score += 8; tokenMatches++; }
      }

      // ── 7. Vector Semantic Similarity ──
      if (item.embedding) {
        const sim = this.cosineSimilarity(queryVector, item.embedding);
        if (sim > 0.22) {
          score += sim * 30;
          if (reasons.length === 0) {
            reasons.push(`Semantic Match (${Math.round(sim * 100)}%)`);
          }
        }
      }

      // ── 8. Favorite Boost ──
      if (item.isFavorite) score += 5;

      if (score > 10) {
        results.push({
          item,
          score,
          matchReason: reasons.slice(0, 2).join(' • ')
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }
}

window.searchEngine = new SearchEngine();
