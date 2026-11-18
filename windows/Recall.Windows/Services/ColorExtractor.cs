using System;
using System.IO;
using System.Threading.Tasks;
using Windows.Graphics.Imaging;
using Windows.Storage;

namespace Recall.Windows.Services;

public record ColorProfile(string Hex, string SemanticName);

public class ColorExtractor
{
    public static async Task<ColorProfile> ExtractDominantColorAsync(string imagePath)
    {
        if (!File.Exists(imagePath)) return new ColorProfile("#333333", "dark");

        try
        {
            var storageFile = await StorageFile.GetFileFromPathAsync(imagePath);
            using var stream = await storageFile.OpenAsync(FileAccessMode.Read);
            var decoder = await BitmapDecoder.CreateAsync(stream);

            // Downsample to 32x32 for instantaneous palette extraction
            var transform = new BitmapTransform { ScaledWidth = 32, ScaledHeight = 32 };
            var pixelData = await decoder.GetPixelDataAsync(
                BitmapPixelFormat.Bgra8,
                BitmapAlphaMode.Premultiplied,
                transform,
                ExifOrientationMode.RespectExifOrientation,
                ColorManagementMode.ColorManageToSRgb);

            var pixels = pixelData.DetachPixelData();
            long totalR = 0, totalG = 0, totalB = 0;
            int count = 0;

            for (int i = 0; i < pixels.Length; i += 4)
            {
                byte b = pixels[i];
                byte g = pixels[i + 1];
                byte r = pixels[i + 2];
                byte a = pixels[i + 3];

                if (a < 128) continue; // Skip transparent pixels

                totalR += r;
                totalG += g;
                totalB += b;
                count++;
            }

            if (count == 0) return new ColorProfile("#111111", "dark");

            int avgR = (int)(totalR / count);
            int avgG = (int)(totalG / count);
            int avgB = (int)(totalB / count);

            string hex = $"#{avgR:X2}{avgG:X2}{avgB:X2}";
            string name = ClassifyColor(avgR, avgG, avgB);

            return new ColorProfile(hex, name);
        }
        catch
        {
            return new ColorProfile("#222222", "dark");
        }
    }

    private static string ClassifyColor(int r, int g, int b)
    {
        int brightness = (r * 299 + g * 587 + b * 114) / 1000;
        if (brightness < 45) return "dark";
        if (brightness > 220) return "white";

        int max = Math.Max(r, Math.Max(g, b));
        int min = Math.Min(r, Math.Min(g, b));
        int delta = max - min;

        if (delta < 25) return brightness > 128 ? "gray" : "dark";

        if (max == r && g < 100 && b < 100) return "red";
        if (max == g && r < 140 && b < 140) return "green";
        if (max == b && r < 120 && g < 150) return "blue";
        if (r > 180 && g > 150 && b < 80) return "yellow";
        if (r > 180 && g > 80 && b < 50) return "orange";
        if (r > 120 && b > 120 && g < 100) return "purple";

        return brightness > 128 ? "light" : "dark";
    }
}
