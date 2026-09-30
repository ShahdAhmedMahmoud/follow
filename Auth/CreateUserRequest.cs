namespace InvoicesErp.Auth;

public class CreateUserRequest
{
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? Email { get; set; }
    public string Role { get; set; } = "User";
    public Dictionary<string, List<string>>? Permissions { get; set; }
}
