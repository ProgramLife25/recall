using System;

namespace Recall.Windows.Models;

public class SearchResult
{
    public required IndexedItem Item { get; set; }

    public double Score { get; set; }

    public string MatchReason { get; set; } = string.Empty;

    public string ThumbnailUri => !string.IsNullOrEmpty(Item?.Path) ? new Uri(Item.Path).AbsoluteUri : string.Empty;
}
