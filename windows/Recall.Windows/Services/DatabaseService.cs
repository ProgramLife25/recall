using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Recall.Windows.Models;
using SQLite;

namespace Recall.Windows.Services;

public class DatabaseService
{
    private static DatabaseService? _instance;
    public static DatabaseService Instance => _instance ??= new DatabaseService();

    private readonly SQLiteAsyncConnection _db;

    public DatabaseService()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var recallDir = Path.Combine(localAppData, "Recall");
        Directory.CreateDirectory(recallDir);

        var dbPath = Path.Combine(recallDir, "recall.db");
        _db = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadWrite | SQLiteOpenFlags.Create | SQLiteOpenFlags.SharedCache);
    }

    public async Task InitializeAsync()
    {
        await _db.CreateTableAsync<IndexedItem>();
    }

    public async Task<List<IndexedItem>> GetAllItemsAsync()
    {
        return await _db.Table<IndexedItem>().OrderByDescending(x => x.ModifiedAt).ToListAsync();
    }

    public async Task<List<IndexedItem>> GetFavoritesAsync()
    {
        return await _db.Table<IndexedItem>().Where(x => x.IsFavorite).OrderByDescending(x => x.ModifiedAt).ToListAsync();
    }

    public async Task<IndexedItem?> GetItemByPathAsync(string path)
    {
        return await _db.Table<IndexedItem>().Where(x => x.Path == path).FirstOrDefaultAsync();
    }

    public async Task UpsertItemAsync(IndexedItem item)
    {
        await _db.InsertOrReplaceAsync(item);
    }

    public async Task DeleteItemAsync(string id)
    {
        await _db.DeleteAsync<IndexedItem>(id);
    }

    public async Task ToggleFavoriteAsync(string id)
    {
        var item = await _db.Table<IndexedItem>().Where(x => x.Id == id).FirstOrDefaultAsync();
        if (item != null)
        {
            item.IsFavorite = !item.IsFavorite;
            await _db.UpdateAsync(item);
        }
    }
}
