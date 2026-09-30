namespace InvoicesErp.Auth;

public class LoginResponse
{
    public string Token { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Username { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Role { get; set; } = "";
    public string? Email { get; set; }
    public string Status { get; set; } = "";
    public Dictionary<string, List<string>> Permissions { get; set; } = new();
    public string? CreatedAt { get; set; }
}
