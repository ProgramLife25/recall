using System;
using System.IO;
using System.Threading.Tasks;
using Recall.Windows.Models;

namespace Recall.Windows.Services;

public class FileIndexerService
{
    private static FileIndexerService? _instance;
    public static FileIndexerService Instance => _instance ??= new FileIndexerService();

    private readonly string _capturesFolder;

    public FileIndexerService()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        _capturesFolder = Path.Combine(localAppData, "Recall", "Captures");
        Directory.CreateDirectory(_capturesFolder);
    }

    /// <summary>
    /// Ingests a new file (dragged or saved) into Recall's private library.
    /// </summary>
    public async Task<IndexedItem> IngestFileAsync(string sourcePath, string? sourceUrl = null, string? sourceTitle = null, string? price = null)
    {
        var fileInfo = new FileInfo(sourcePath);
        if (!fileInfo.Exists) throw new FileNotFoundException("File not found", sourcePath);

        // Copy file into Recall's private local library
        string destinationName = $"{Path.GetFileNameWithoutExtension(fileInfo.Name)}-{Guid.NewGuid().ToString().Substring(0, 8)}{fileInfo.Extension}";
        string destinationPath = Path.Combine(_capturesFolder, destinationName);
        File.Copy(sourcePath, destinationPath, overwrite: true);

        string ext = fileInfo.Extension.ToLowerInvariant();
        string kind = ext.TrimStart('.').ToUpperInvariant();
        string contentType = (ext == ".pdf") ? "PDF" : (ext == ".md" || ext == ".txt") ? "Note" : "Image";

        // 1. Extract OCR text
        string ocrText = string.Empty;
        if (contentType == "Image")
        {
            ocrText = await OcrService.Instance.ExtractTextAsync(destinationPath);
        }
        else if (contentType == "Note")
        {
            ocrText = await File.ReadAllTextAsync(destinationPath);
        }

        // 2. Extract dominant color
        ColorProfile colorProfile = (contentType == "Image") 
            ? await ColorExtractor.ExtractDominantColorAsync(destinationPath)
            : new ColorProfile("#333333", "dark");

        // 3. Generate Vector Embeddings
        string combinedSearchableText = $"{fileInfo.Name} {sourceTitle ?? ""} {ocrText}";
        var embedding = VectorEmbeddingService.Instance.GenerateTextEmbedding(combinedSearchableText);

        var item = new IndexedItem
        {
            Path = destinationPath,
            Name = sourceTitle ?? fileInfo.Name,
            Kind = kind,
            ContentType = contentType,
            ModifiedAt = fileInfo.LastWriteTimeUtc,
            ByteSize = fileInfo.Length,
            SearchableText = ocrText,
            DominantColorHex = colorProfile.Hex,
            DominantColorName = colorProfile.SemanticName,
            SourceUrl = sourceUrl,
            SourceSite = sourceUrl != null && Uri.TryCreate(sourceUrl, UriKind.Absolute, out var uri) ? uri.Host : null,
            DetectedPrice = price,
            Embedding = embedding
        };

        await DatabaseService.Instance.UpsertItemAsync(item);
        return item;
    }

    /// <summary>
    /// Creates a quick Markdown note in Recall.
    /// </summary>
    public async Task<IndexedItem> CreateQuickNoteAsync(string title, string markdownContent)
    {
        string filename = $"Note-{DateTime.UtcNow:yyyyMMdd-HHmmss}.md";
        string filePath = Path.Combine(_capturesFolder, filename);

        string fullContent = $"# {title}\n\n{markdownContent}";
        await File.WriteAllTextAsync(filePath, fullContent);

        return await IngestFileAsync(filePath, sourceTitle: title);
    }
}
