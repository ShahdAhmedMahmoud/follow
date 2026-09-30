using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using InvoicesErp.Auth;

namespace InvoicesErp.Services;

public class AuthService : InvoicesErp.Interfaces.IAuthService
{
    private readonly InvoicesErp.Interfaces.IUserStore _users;
    private readonly byte[] _keyBytes;
    private readonly int _tokenHours;
    private const string HashPrefix = "pbkdf2$";

    public AuthService(InvoicesErp.Interfaces.IUserStore users, IConfiguration config)
    {
        _users = users;
        var key = config["Auth:SigningKey"]
            ?? "InvoicesERP-Dev-Signing-Key-Change-In-Production-2026!";
        _keyBytes = Encoding.UTF8.GetBytes(key);
        _tokenHours = int.TryParse(config["Auth:TokenHours"], out var h) ? h : 12;
    }

    public LoginResponse? Login(string username, string password)
    {
        var user = _users.FindByUsername(username);
        if (user is null) return null;
        if (!string.Equals(user.Status, "Active", StringComparison.OrdinalIgnoreCase)) return null;
        if (!VerifyPassword(password, user.Password)) return null;

        // Upgrade legacy plain-text passwords on successful login
        if (!IsHashed(user.Password))
        {
            user.Password = HashPassword(password);
            _users.Update(user);
        }

        var token = CreateToken(user);
        return new LoginResponse
        {
            Token = token,
            UserId = user.Id,
            Username = user.Username,
            DisplayName = user.DisplayName,
            Role = user.Role,
            Email = user.Email,
            Status = user.Status,
            Permissions = ClonePerms(user.Permissions)
        };
    }

    public AppUser? ValidateToken(string token)
    {
        try
        {
            var parts = token.Split('.');
            if (parts.Length != 2) return null;
            var payloadB64 = parts[0];
            var sigB64 = parts[1];
            var expected = Sign(payloadB64);
            if (!CryptographicOperations.FixedTimeEquals(
                    Convert.FromBase64String(sigB64),
                    Convert.FromBase64String(expected)))
                return null;

            var json = Encoding.UTF8.GetString(Convert.FromBase64String(payloadB64));
            var payload = JsonSerializer.Deserialize<TokenPayload>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
            if (payload is null) return null;
            if (payload.Exp < DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return null;

            var user = _users.FindById(payload.Uid);
            if (user is null || !string.Equals(user.Status, "Active", StringComparison.OrdinalIgnoreCase))
                return null;
            return user;
        }
        catch
        {
            return null;
        }
    }

    public bool HasPermission(AppUser user, string module, string action)
    {
        if (string.Equals(user.Role, "Admin", StringComparison.OrdinalIgnoreCase)
            || string.Equals(user.Role, "Administrator", StringComparison.OrdinalIgnoreCase))
            return true;
        if (!user.Permissions.TryGetValue(module, out var actions) || actions is null)
            return false;
        return actions.Any(a => string.Equals(a, action, StringComparison.OrdinalIgnoreCase));
    }

    public static string HashPassword(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password),
            salt,
            100_000,
            HashAlgorithmName.SHA256,
            32);
        return HashPrefix
               + Convert.ToBase64String(salt)
               + "$"
               + Convert.ToBase64String(hash);
    }

    public static bool VerifyPassword(string password, string stored)
    {
        if (string.IsNullOrEmpty(stored)) return false;
        if (!IsHashed(stored))
            return string.Equals(password, stored, StringComparison.Ordinal);

        var parts = stored.Split('$');
        if (parts.Length != 3) return false;
        var salt = Convert.FromBase64String(parts[1]);
        var expected = Convert.FromBase64String(parts[2]);
        var actual = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password),
            salt,
            100_000,
            HashAlgorithmName.SHA256,
            32);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    public static bool IsHashed(string stored) =>
        !string.IsNullOrEmpty(stored) && stored.StartsWith(HashPrefix, StringComparison.Ordinal);

    private string CreateToken(AppUser user)
    {
        var payload = new TokenPayload
        {
            Uid = user.Id,
            Username = user.Username,
            Role = user.Role,
            Exp = DateTimeOffset.UtcNow.AddHours(_tokenHours).ToUnixTimeSeconds()
        };
        var json = JsonSerializer.Serialize(payload);
        var payloadB64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
        var sig = Sign(payloadB64);
        return payloadB64 + "." + sig;
    }

    private string Sign(string payloadB64)
    {
        using var hmac = new HMACSHA256(_keyBytes);
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payloadB64));
        return Convert.ToBase64String(hash);
    }

    private static Dictionary<string, List<string>> ClonePerms(Dictionary<string, List<string>> src) =>
        src.ToDictionary(kv => kv.Key, kv => kv.Value.ToList());

    private class TokenPayload
    {
        public string Uid { get; set; } = "";
        public string Username { get; set; } = "";
        public string Role { get; set; } = "";
        public long Exp { get; set; }
    }
}
