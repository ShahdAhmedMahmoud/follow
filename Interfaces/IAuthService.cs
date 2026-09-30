using InvoicesErp.Auth;

namespace InvoicesErp.Interfaces;

public interface IAuthService
{
    LoginResponse? Login(string username, string password);
    AppUser? ValidateToken(string token);
    bool HasPermission(AppUser user, string module, string action);
}
