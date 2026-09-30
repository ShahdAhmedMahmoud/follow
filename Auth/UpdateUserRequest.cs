namespace InvoicesErp.Auth;

public class UpdateUserRequest
{
    public string? DisplayName { get; set; }
    public string? Email { get; set; }
    public string? Role { get; set; }
    public string? Status { get; set; }
    public string? Password { get; set; }
    public Dictionary<string, List<string>>? Permissions { get; set; }
}
