using System;
using System.IO;
using System.Numerics.Tensors;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace Recall.Windows.Services;

public class VectorEmbeddingService
{
    private static VectorEmbeddingService? _instance;
    public static VectorEmbeddingService Instance => _instance ??= new VectorEmbeddingService();

    private InferenceSession? _session;
    public bool IsGpuAccelerated { get; private set; }

    public VectorEmbeddingService()
    {
        InitializeSession();
    }

    private void InitializeSession()
    {
        try
        {
            var options = new SessionOptions();
            try
            {
                // Attempt to enable DirectML (Nvidia, AMD, Intel GPU acceleration)
                options.AppendExecutionProvider_DML(0);
                IsGpuAccelerated = true;
            }
            catch
            {
                IsGpuAccelerated = false;
            }

            var modelPath = Path.Combine(AppContext.BaseDirectory, "Assets", "Models", "text_encoder.onnx");
            if (File.Exists(modelPath))
            {
                _session = new InferenceSession(modelPath, options);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Embedding Init Error] {ex.Message}");
        }
    }

    public float[] GenerateTextEmbedding(string text)
    {
        // If ONNX model is present, run inference
        if (_session != null)
        {
            // Placeholder inference using ONNX session
            return new float[512];
        }

        // Lightweight deterministic semantic hash fallback for development without large model download
        return GenerateDeterministicVector(text, 128);
    }

    public static float CosineSimilarity(ReadOnlySpan<float> vecA, ReadOnlySpan<float> vecB)
    {
        if (vecA.Length != vecB.Length || vecA.Length == 0) return 0f;

        float dotProduct = 0f;
        float normA = 0f;
        float normB = 0f;

        for (int i = 0; i < vecA.Length; i++)
        {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        if (normA <= 0f || normB <= 0f) return 0f;
        return dotProduct / (MathF.Sqrt(normA) * MathF.Sqrt(normB));
    }

    private static float[] GenerateDeterministicVector(string text, int dimensions)
    {
        var vector = new float[dimensions];
        var words = text.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);

        foreach (var word in words)
        {
            uint hash = 2166136261;
            foreach (char c in word)
            {
                hash = (hash ^ c) * 16777619;
            }
            int index = (int)(hash % (uint)dimensions);
            vector[index] += 1.0f;
        }

        // Normalize vector
        float sumSquares = 0f;
        for (int i = 0; i < dimensions; i++) sumSquares += vector[i] * vector[i];
        float norm = MathF.Sqrt(sumSquares);
        if (norm > 0f)
        {
            for (int i = 0; i < dimensions; i++) vector[i] /= norm;
        }

        return vector;
    }
}
