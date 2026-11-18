using System;
using System.IO;
using System.Threading.Tasks;

namespace Recall.Windows.Services;

public class OcrService
{
    private static OcrService? _instance;
    public static OcrService Instance => _instance ??= new OcrService();

    private global::Windows.Media.Ocr.OcrEngine? _ocrEngine;

    public OcrService()
    {
        try
        {
            _ocrEngine = global::Windows.Media.Ocr.OcrEngine.TryCreateFromUserProfileLanguages() 
                         ?? global::Windows.Media.Ocr.OcrEngine.TryCreateFromLanguage(new global::Windows.Globalization.Language("en-US"));
        }
        catch
        {
            _ocrEngine = null;
        }
    }

    /// <summary>
    /// Performs on-device Windows Media OCR on any supported image file.
    /// </summary>
    public async Task<string> ExtractTextAsync(string imagePath)
    {
        if (_ocrEngine == null || !File.Exists(imagePath)) return string.Empty;

        try
        {
            var storageFile = await global::Windows.Storage.StorageFile.GetFileFromPathAsync(imagePath);
            using var stream = await storageFile.OpenAsync(global::Windows.Storage.FileAccessMode.Read);
            var decoder = await global::Windows.Graphics.Imaging.BitmapDecoder.CreateAsync(stream);
            var softwareBitmap = await decoder.GetSoftwareBitmapAsync();

            var ocrResult = await _ocrEngine.RecognizeAsync(softwareBitmap);
            return ocrResult.Text ?? string.Empty;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[OCR Error] {ex.Message}");
            return string.Empty;
        }
    }
}
