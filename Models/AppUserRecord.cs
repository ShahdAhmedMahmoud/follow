namespace InvoicesErp.Models;

public class AppUserRecord
{
    public string Id { get; set; } = "";
    public string Username { get; set; } = "";
    /// <summary>PBKDF2 hash only — never plain text.</summary>
    public string PasswordHash { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? Email { get; set; }
    /// <summary>Admin | User | Viewer</summary>
    public string Role { get; set; } = "User";
    /// <summary>Active | Inactive</summary>
    public string Status { get; set; } = "Active";
    /// <summary>JSON: { "module": ["view","create",...] }</summary>
    public string PermissionsJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Contract Cost Control header — one per contract (Contract is source of truth for values/progress).
/// </summary>
