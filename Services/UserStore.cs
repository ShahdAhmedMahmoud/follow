using System.Text.Json;
using InvoicesErp.Auth;
using InvoicesErp.Data;
using InvoicesErp.Models;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace InvoicesErp.Services;

/// <summary>
/// Database-backed user store. All users are persisted in SQL Server table AppUsers.
/// No JSON file, no in-memory array, no localStorage as source of truth.
/// </summary>
public class UserStore : InvoicesErp.Interfaces.IUserStore
{
    private readonly AppDbContext _db;
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    public UserStore(AppDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// Ensures AppUsers table exists and seeds the default admin if the table is empty.
    /// Safe to call on every startup.
    /// </summary>
    public static async Task EnsureSchemaAndSeedAsync(AppDbContext db)
    {
        // Create table if missing (does not alter other existing schema).
        await db.Database.ExecuteSqlRawAsync("""
            IF OBJECT_ID(N'dbo.AppUsers', N'U') IS NULL
            BEGIN
                CREATE TABLE dbo.AppUsers (
                    Id              NVARCHAR(64)  NOT NULL CONSTRAINT PK_AppUsers PRIMARY KEY,
                    Username        NVARCHAR(100) NOT NULL,
                    PasswordHash    NVARCHAR(500) NOT NULL,
                    DisplayName     NVARCHAR(200) NOT NULL,
                    Email           NVARCHAR(250) NULL,
                    Role            NVARCHAR(50)  NOT NULL,
                    Status          NVARCHAR(20)  NOT NULL,
                    PermissionsJson NVARCHAR(MAX) NOT NULL,
                    CreatedAt       DATETIME2     NOT NULL,
                    UpdatedAt       DATETIME2     NOT NULL
                );
                CREATE UNIQUE INDEX IX_AppUsers_Username ON dbo.AppUsers (Username);
                CREATE UNIQUE INDEX IX_AppUsers_Email ON dbo.AppUsers (Email)
                    WHERE Email IS NOT NULL AND Email <> N'';
            END
            """);

        if (await db.AppUsers.AnyAsync())
            return;

        var adminPerms = PermissionModules.All.ToDictionary(
            m => m,
            _ => new List<string>
            {
                PermissionActions.View, PermissionActions.Create, PermissionActions.Edit,
                PermissionActions.Delete, PermissionActions.Export, PermissionActions.Manage, PermissionActions.Approve
            });

        var now = DateTime.UtcNow;
        db.AppUsers.Add(new AppUserRecord
        {
            Id = "u-admin",
            Username = "admin",
            PasswordHash = AuthService.HashPassword("ChangeMe!ERP-2026"),
            DisplayName = "مدير النظام",
            Email = "admin@erp.local",
            Role = "Admin",
            Status = "Active",
            PermissionsJson = JsonSerializer.Serialize(adminPerms, JsonOpts),
            CreatedAt = now,
            UpdatedAt = now
        });
        await db.SaveChangesAsync();
    }

    public IReadOnlyList<AppUser> GetAll()
    {
        return _db.AppUsers
            .AsNoTracking()
            .OrderBy(u => u.CreatedAt)
            .ToList()
            .Select(ToAppUser)
            .ToList();
    }

    public AppUser? FindByUsername(string username)
    {
        if (string.IsNullOrWhiteSpace(username)) return null;
        var row = _db.AppUsers
            .AsNoTracking()
            .FirstOrDefault(u => u.Username.ToLower() == username.Trim().ToLower());
        return row is null ? null : ToAppUser(row);
    }

    public AppUser? FindById(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return null;
        var row = _db.AppUsers.AsNoTracking().FirstOrDefault(u => u.Id == id);
        return row is null ? null : ToAppUser(row);
    }

    public AppUser Add(AppUser user)
    {
        var now = DateTime.UtcNow;
        var row = new AppUserRecord
        {
            Id = string.IsNullOrWhiteSpace(user.Id) ? "u-" + Guid.NewGuid().ToString("N") : user.Id,
            Username = user.Username.Trim(),
            PasswordHash = user.Password,
            DisplayName = string.IsNullOrWhiteSpace(user.DisplayName) ? user.Username.Trim() : user.DisplayName.Trim(),
            Email = string.IsNullOrWhiteSpace(user.Email) ? null : user.Email.Trim(),
            Role = string.IsNullOrWhiteSpace(user.Role) ? "User" : user.Role.Trim(),
            Status = string.IsNullOrWhiteSpace(user.Status) ? "Active" : user.Status.Trim(),
            PermissionsJson = SerializePerms(user.Permissions),
            CreatedAt = ParseCreated(user.CreatedAt) ?? now,
            UpdatedAt = now
        };

        try
        {
            _db.AppUsers.Add(row);
            _db.SaveChanges();
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            throw new InvalidOperationException(UniqueMessage(ex), ex);
        }

        return ToAppUser(row);
    }

    public bool Update(AppUser user)
    {
        var row = _db.AppUsers.FirstOrDefault(u => u.Id == user.Id);
        if (row is null) return false;

        row.Username = user.Username.Trim();
        row.PasswordHash = user.Password;
        row.DisplayName = string.IsNullOrWhiteSpace(user.DisplayName) ? user.Username.Trim() : user.DisplayName.Trim();
        row.Email = string.IsNullOrWhiteSpace(user.Email) ? null : user.Email.Trim();
        row.Role = string.IsNullOrWhiteSpace(user.Role) ? "User" : user.Role.Trim();
        row.Status = string.IsNullOrWhiteSpace(user.Status) ? "Active" : user.Status.Trim();
        row.PermissionsJson = SerializePerms(user.Permissions);
        row.UpdatedAt = DateTime.UtcNow;

        try
        {
            _db.SaveChanges();
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            throw new InvalidOperationException(UniqueMessage(ex), ex);
        }

        return true;
    }

    public bool Delete(string id)
    {
        var row = _db.AppUsers.FirstOrDefault(u => u.Id == id);
        if (row is null) return false;
        _db.AppUsers.Remove(row);
        _db.SaveChanges();
        return true;
    }

    private static AppUser ToAppUser(AppUserRecord r) => new()
    {
        Id = r.Id,
        Username = r.Username,
        Password = r.PasswordHash,
        DisplayName = r.DisplayName,
        Email = r.Email,
        Role = r.Role,
        Status = r.Status,
        Permissions = DeserializePerms(r.PermissionsJson),
        CreatedAt = r.CreatedAt.ToString("yyyy-MM-dd")
    };

    private static string SerializePerms(Dictionary<string, List<string>>? perms) =>
        JsonSerializer.Serialize(perms ?? new Dictionary<string, List<string>>(), JsonOpts);

    private static Dictionary<string, List<string>> DeserializePerms(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new Dictionary<string, List<string>>();
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, List<string>>>(json, JsonOpts)
                   ?? new Dictionary<string, List<string>>();
        }
        catch
        {
            return new Dictionary<string, List<string>>();
        }
    }

    private static DateTime? ParseCreated(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        return DateTime.TryParse(s, out var d) ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : null;
    }

    private static bool IsUniqueViolation(DbUpdateException ex)
    {
        if (ex.InnerException is SqlException sql)
            return sql.Number is 2601 or 2627;
        var msg = ex.InnerException?.Message ?? ex.Message;
        return msg.Contains("unique", StringComparison.OrdinalIgnoreCase)
               || msg.Contains("duplicate", StringComparison.OrdinalIgnoreCase);
    }

    private static string UniqueMessage(DbUpdateException ex)
    {
        var msg = (ex.InnerException?.Message ?? ex.Message).ToLowerInvariant();
        if (msg.Contains("email"))
            return "هذا البريد الإلكتروني مستخدم بالفعل.";
        if (msg.Contains("username"))
            return "اسم المستخدم موجود بالفعل.";
        return "اسم المستخدم أو البريد الإلكتروني موجود بالفعل.";
    }
}
