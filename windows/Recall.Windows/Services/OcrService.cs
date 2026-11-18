using System;
using System.IO;
using System.Threading.Tasks;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;

namespace Recall.Windows.Services;

public class OcrService
{
    private static OcrService? _instance;
    public static OcrService Instance => _instance ??= new OcrService();

    private OcrEngine? _ocrEngine;

    public OcrService()
    {
        try
        {
            // Initializes using the user's primary language profile, fallback to English
            _ocrEngine = OcrEngine.TryCreateFromUserProfileLanguages() 
                         ?? OcrEngine.TryCreateFromLanguage(new Windows.Globalization.Language("en-US"));
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
            var storageFile = await StorageFile.GetFileFromPathAsync(imagePath);
            using var stream = await storageFile.OpenAsync(FileAccessMode.Read);
            var decoder = await BitmapDecoder.CreateAsync(stream);
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
