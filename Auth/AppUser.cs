namespace InvoicesErp.Auth;

public class AppUser
{
    public string Id { get; set; } = "";
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? Email { get; set; }
    public string Role { get; set; } = "User";
    public string Status { get; set; } = "Active";
    public Dictionary<string, List<string>> Permissions { get; set; } = new();
    public string? CreatedAt { get; set; }
}
