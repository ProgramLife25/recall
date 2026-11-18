/**
 * Recall Web - Hybrid Associative Search Engine
 * Combines Vector Semantic Similarity, OCR Text, Exact Keywords, Colors, and Recency
 */

class SearchEngine {
  constructor() {
    this.colorKeywords = new Set([
      'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'white', 'black', 'dark', 'light', 'gray'
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

    // Unit normalize
    let sumSquares = 0;
    for (let i = 0; i < dimensions; i++) {
      sumSquares += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSquares);
    if (norm > 0) {
      for (let i = 0; i < dimensions; i++) {
        vector[i] /= norm;
      }
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
        reasons: []
      }));
    }

    const tokens = query.trim().split(/\s+/);
    let typeFilter = null;
    let favoriteFilter = null;
    let afterDate = null;
    let targetColor = null;
    const searchWords = [];

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (lower.startsWith('type:')) {
        typeFilter = lower.substring(5);
      } else if (lower === 'liked:true' || lower === 'favorite:true' || lower === 'fav:true') {
        favoriteFilter = true;
      } else if (lower === 'today') {
        afterDate = today;
      } else if (lower === 'yesterday') {
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        afterDate = y;
      } else if (lower === 'week' || lower === 'lastweek') {
        const w = new Date(today);
        w.setDate(w.getDate() - 7);
        afterDate = w;
      } else if (this.colorKeywords.has(lower)) {
        targetColor = lower;
        searchWords.push(lower);
      } else {
        searchWords.push(lower);
      }
    }

    const cleanQuery = searchWords.join(' ');
    const queryVector = this.generateEmbedding(cleanQuery);

    const results = [];

    for (const item of items) {
      // 1. Hard Filter Checks
      if (typeFilter) {
        const itemType = (item.contentType || '').toLowerCase();
        const itemKind = (item.kind || '').toLowerCase();
        if (itemType !== typeFilter && itemKind !== typeFilter) {
          continue;
        }
      }

      if (favoriteFilter !== null && item.isFavorite !== favoriteFilter) {
        continue;
      }

      if (afterDate) {
        const itemDate = new Date(item.modifiedAt);
        if (itemDate < afterDate) {
          continue;
        }
      }

      let score = 0;
      const reasons = [];

      // 2. Semantic Vector Similarity (Weight: 45%)
      if (cleanQuery && item.embedding) {
        const sim = this.cosineSimilarity(queryVector, item.embedding);
        if (sim > 0.22) {
          score += sim * 45;
          reasons.push(`Semantic Match (${Math.round(sim * 100)}%)`);
        }
      }

      // 3. Exact Title & Substring Matches (Weight: 30%)
      const name = (item.name || '').toLowerCase();
      const searchableText = (item.searchableText || '').toLowerCase();

      if (cleanQuery && name.includes(cleanQuery)) {
        score += 30;
        reasons.push('Title Match');
      } else if (cleanQuery && searchableText.includes(cleanQuery)) {
        score += 20;
        reasons.push('OCR Text Match');
      }

      // Token overlap
      for (const word of searchWords) {
        if (name.includes(word)) score += 6;
        if (searchableText.includes(word)) score += 4;
      }

      // 4. Color Match (Weight: 15%)
      if (targetColor && item.dominantColorName) {
        if (item.dominantColorName.toLowerCase() === targetColor) {
          score += 15;
          reasons.push(`Color: ${targetColor}`);
        }
      }

      // 5. Favorite Boost (Weight: 10%)
      if (item.isFavorite) {
        score += 10;
      }

      // 6. Recency Boost (Up to 5%)
      const daysAgo = (now - new Date(item.modifiedAt)) / (1000 * 60 * 60 * 24);
      if (daysAgo < 7) score += 5;
      else if (daysAgo < 30) score += 2;

      if (score > 8 || !cleanQuery) {
        results.push({
          item,
          score,
          matchReason: reasons.join(' • ')
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }
}

window.searchEngine = new SearchEngine();
