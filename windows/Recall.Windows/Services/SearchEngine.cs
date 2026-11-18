using System;
using System.Collections.Generic;
using System.Linq;
using Recall.Windows.Models;

namespace Recall.Windows.Services;

public class SearchEngine
{
    private static readonly HashSet<string> ColorKeywords = new(StringComparer.OrdinalIgnoreCase)
    {
        "red", "green", "blue", "yellow", "orange", "purple", "white", "black", "dark", "light", "gray"
    };

    /// <summary>
    /// Executes a hybrid associative search across vector similarity, OCR, exact tokens, colors, and recency.
    /// </summary>
    public static List<SearchResult> Search(string query, IEnumerable<IndexedItem> items)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return items.Select(x => new SearchResult { Item = x, Score = 1.0 }).ToList();
        }

        // 1. Parse natural query filters
        var tokens = query.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        string? typeFilter = null;
        bool? favoriteFilter = null;
        DateTime? afterDateFilter = null;
        var searchWords = new List<string>();
        string? targetColor = null;

        foreach (var token in tokens)
        {
            if (token.StartsWith("type:", StringComparison.OrdinalIgnoreCase))
            {
                typeFilter = token.Substring(5).ToLowerInvariant();
            }
            else if (token.Equals("liked:true", StringComparison.OrdinalIgnoreCase) || token.Equals("favorite:true", StringComparison.OrdinalIgnoreCase))
            {
                favoriteFilter = true;
            }
            else if (token.Equals("today", StringComparison.OrdinalIgnoreCase))
            {
                afterDateFilter = DateTime.Today;
            }
            else if (token.Equals("yesterday", StringComparison.OrdinalIgnoreCase))
            {
                afterDateFilter = DateTime.Today.AddDays(-1);
            }
            else if (token.Equals("last week", StringComparison.OrdinalIgnoreCase) || token.Equals("week", StringComparison.OrdinalIgnoreCase))
            {
                afterDateFilter = DateTime.Today.AddDays(-7);
            }
            else if (ColorKeywords.Contains(token))
            {
                targetColor = token.ToLowerInvariant();
                searchWords.Add(token);
            }
            else
            {
                searchWords.Add(token);
            }
        }

        var cleanQuery = string.Join(' ', searchWords);
        var queryVector = VectorEmbeddingService.Instance.GenerateTextEmbedding(cleanQuery);

        var results = new List<SearchResult>();

        foreach (var item in items)
        {
            // Apply hard filter constraints
            if (typeFilter != null && !item.ContentType.Equals(typeFilter, StringComparison.OrdinalIgnoreCase) && !item.Kind.Equals(typeFilter, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (favoriteFilter.HasValue && item.IsFavorite != favoriteFilter.Value)
            {
                continue;
            }

            if (afterDateFilter.HasValue && item.ModifiedAt < afterDateFilter.Value)
            {
                continue;
            }

            double score = 0.0;
            var reasons = new List<string>();

            // 1. Semantic Vector Similarity (Weight: 45%)
            if (item.Embedding != null && queryVector != null)
            {
                float sim = VectorEmbeddingService.CosineSimilarity(queryVector, item.Embedding);
                if (sim > 0.25f)
                {
                    score += sim * 45.0;
                    reasons.Add($"Semantic Match ({sim:P0})");
                }
            }

            // 2. Exact Title & Substring Matches (Weight: 30%)
            string text = item.SearchableText ?? "";
            string name = item.Name ?? "";

            if (name.Contains(cleanQuery, StringComparison.OrdinalIgnoreCase))
            {
                score += 30.0;
                reasons.Add("Title Match");
            }
            else if (text.Contains(cleanQuery, StringComparison.OrdinalIgnoreCase))
            {
                score += 20.0;
                reasons.Add("OCR Text Match");
            }

            // Token overlap
            foreach (var word in searchWords)
            {
                if (text.Contains(word, StringComparison.OrdinalIgnoreCase))
                {
                    score += 5.0;
                }
            }

            // 3. Dominant Color Match (Weight: 15%)
            if (targetColor != null && item.DominantColorName != null)
            {
                if (item.DominantColorName.Equals(targetColor, StringComparison.OrdinalIgnoreCase))
                {
                    score += 15.0;
                    reasons.Add($"Color: {targetColor}");
                }
            }

            // 4. Favorite Boost (Weight: 10%)
            if (item.IsFavorite)
            {
                score += 10.0;
            }

            // 5. Recency Boost (Up to 5%)
            var daysAgo = (DateTime.UtcNow - item.ModifiedAt).TotalDays;
            if (daysAgo < 7) score += 5.0;
            else if (daysAgo < 30) score += 2.0;

            if (score > 10.0 || string.IsNullOrWhiteSpace(cleanQuery))
            {
                results.Add(new SearchResult
                {
                    Item = item,
                    Score = score,
                    MatchReason = string.Join(" • ", reasons)
                });
            }
        }

        return results.OrderByDescending(x => x.Score).ToList();
    }
}
