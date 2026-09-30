using System.Text.RegularExpressions;
using InvoicesErp.Auth;
using InvoicesErp.Services;
using InvoicesErp.Common;
using Microsoft.AspNetCore.Mvc;

namespace InvoicesErp.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(InvoicesErp.Interfaces.IAuthService auth, InvoicesErp.Interfaces.IUserStore users) : ControllerBase
{
    private static readonly Regex EmailRx = new(
        @"^[^@\s]+@[^@\s]+\.[^@\s]+$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    // Simple in-memory login rate limit: max 10 attempts / 15 minutes per username+IP
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (int Count, DateTime WindowStart)> LoginAttempts = new();
    private const int MaxLoginAttempts = 10;
    private static readonly TimeSpan LoginWindow = TimeSpan.FromMinutes(15);

    private static bool IsLoginRateLimited(string key)
    {
        var now = DateTime.UtcNow;
        var entry = LoginAttempts.AddOrUpdate(
            key,
            _ => (1, now),
            (_, prev) =>
            {
                if (now - prev.WindowStart > LoginWindow) return (1, now);
                return (prev.Count + 1, prev.WindowStart);
            });
        return entry.Count > MaxLoginAttempts;
    }

    private static void ClearLoginAttempts(string key) => LoginAttempts.TryRemove(key, out _);

    [HttpPost("login")]
    public ActionResult<LoginResponse> Login([FromBody] LoginRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new { success = false, message = "اسم المستخدم وكلمة المرور مطلوبان." });

        var userKey = (req.Username ?? "").Trim().ToLowerInvariant();
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var rateKey = userKey + "|" + ip;
        if (IsLoginRateLimited(rateKey))
            return StatusCode(StatusCodes.Status429TooManyRequests, new { success = false, message = "تم تجاوز عدد محاولات الدخول. حاول بعد 15 دقيقة." });

        var result = auth.Login(req.Username.Trim(), req.Password);
        if (result is null)
            return Unauthorized(new { success = false, message = "اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب غير نشط." });

        ClearLoginAttempts(rateKey);
        return Ok(result);
    }

    [HttpGet("me")]
    [RequireAuth]
    public ActionResult<LoginResponse> Me()
    {
        var user = (AppUser)HttpContext.Items["AppUser"]!;
        return Ok(new LoginResponse
        {
            Token = "",
            UserId = user.Id,
            Username = user.Username,
            DisplayName = user.DisplayName,
            Role = user.Role,
            Email = user.Email,
            Status = user.Status,
            Permissions = user.Permissions.ToDictionary(kv => kv.Key, kv => kv.Value.ToList()),
            CreatedAt = user.CreatedAt
        });
    }

    [HttpGet("roles")]
    [RequireAuth]
    public ActionResult<object> Roles()
    {
        return Ok(new[]
        {
            new { id = "Admin", name = "مدير النظام", description = "صلاحيات كاملة" },
            new { id = "User", name = "مستخدم", description = "صلاحيات قابلة للتخصيص" },
            new { id = "Viewer", name = "عرض فقط", description = "عرض البيانات فقط بدون تعديل" }
        });
    }

    [HttpGet("users")]
    [RequirePermission(PermissionModules.Accounts, PermissionActions.View)]
    public IActionResult ListUsers(
        [FromQuery] int? page,
        [FromQuery] int? pageSize,
        [FromQuery] string? search)
    {
        IEnumerable<UserDto> list = users.GetAll().Select(ToDto);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            list = list.Where(u =>
                (u.Username?.Contains(s, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (u.DisplayName?.Contains(s, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (u.Email?.Contains(s, StringComparison.OrdinalIgnoreCase) ?? false));
        }
        var material = list.OrderBy(u => u.Username).ToList();
        if (page is null)
            return Ok(material);
        var pageNum = page.Value < 1 ? 1 : page.Value;
        var size = pageSize is null or < 1 ? 25 : (pageSize > 100 ? 100 : pageSize.Value);
        var total = material.Count;
        var items = material.Skip((pageNum - 1) * size).Take(size).ToList();
        return Ok(PagedResult<UserDto>.Create(items, pageNum, size, total));
    }

    /// <summary>Client should clear token; endpoint exists for explicit logout auditing/future revoke.</summary>
    [HttpPost("logout")]
    [RequireAuth]
    public IActionResult Logout()
    {
        return Ok(new { success = true, message = "تم تسجيل الخروج. امسح التوكن من المتصفح." });
    }

    [HttpPost("users")]
    [RequirePermission(PermissionModules.Accounts, PermissionActions.Manage)]
    public ActionResult<UserDto> CreateUser([FromBody] CreateUserRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Username))
            return BadRequest(new { success = false, message = "يرجى إدخال اسم المستخدم." });
        if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 4)
            return BadRequest(new { success = false, message = "كلمة المرور مطلوبة ويجب ألا تقل عن 4 أحرف." });
        if (string.IsNullOrWhiteSpace(req.Email) || !EmailRx.IsMatch(req.Email.Trim()))
            return BadRequest(new { success = false, message = "يرجى إدخال بريد إلكتروني صحيح." });

        var username = req.Username.Trim();
        var email = req.Email.Trim();

        if (users.FindByUsername(username) is not null)
            return Conflict(new { success = false, message = "اسم المستخدم موجود بالفعل." });

        if (users.GetAll().Any(u =>
                !string.IsNullOrEmpty(u.Email)
                && string.Equals(u.Email, email, StringComparison.OrdinalIgnoreCase)))
            return Conflict(new { success = false, message = "هذا البريد الإلكتروني مستخدم بالفعل." });

        var role = string.IsNullOrWhiteSpace(req.Role) ? "User" : req.Role.Trim();
        var permissions = req.Permissions is { Count: > 0 }
            ? req.Permissions
            : PermissionsForRole(role);

        var user = new AppUser
        {
            Id = "u-" + Guid.NewGuid().ToString("N"),
            Username = username,
            Password = AuthService.HashPassword(req.Password),
            DisplayName = string.IsNullOrWhiteSpace(req.DisplayName) ? username : req.DisplayName.Trim(),
            Email = email,
            Role = role,
            Status = "Active",
            Permissions = permissions,
            CreatedAt = DateTime.UtcNow.ToString("yyyy-MM-dd")
        };
        try
        {
            users.Add(user);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { success = false, message = ex.Message });
        }

        return CreatedAtAction(nameof(ListUsers), ToDto(user));
    }

    [HttpPut("users/{id}")]
    [RequirePermission(PermissionModules.Accounts, PermissionActions.Manage)]
    public ActionResult<UserDto> UpdateUser(string id, [FromBody] UpdateUserRequest req)
    {
        var user = users.FindById(id);
        if (user is null) return NotFound(new { success = false, message = "المستخدم غير موجود." });

        if (req.DisplayName is not null) user.DisplayName = req.DisplayName.Trim();
        if (req.Email is not null)
        {
            var email = req.Email.Trim();
            if (!EmailRx.IsMatch(email))
                return BadRequest(new { success = false, message = "يرجى إدخال بريد إلكتروني صحيح." });
            if (users.GetAll().Any(u =>
                    u.Id != id
                    && !string.IsNullOrEmpty(u.Email)
                    && string.Equals(u.Email, email, StringComparison.OrdinalIgnoreCase)))
                return Conflict(new { success = false, message = "هذا البريد الإلكتروني مستخدم بالفعل." });
            user.Email = email;
        }
        if (req.Role is not null)
        {
            user.Role = req.Role.Trim();
            // When role changes and no explicit permissions sent, apply role defaults
            if (req.Permissions is null)
                user.Permissions = PermissionsForRole(user.Role);
        }
        if (req.Status is not null) user.Status = req.Status;
        if (!string.IsNullOrEmpty(req.Password))
        {
            if (req.Password.Length < 4)
                return BadRequest(new { success = false, message = "كلمة المرور يجب ألا تقل عن 4 أحرف." });
            user.Password = AuthService.HashPassword(req.Password);
        }
        if (req.Permissions is not null)
            user.Permissions = req.Permissions;

        try
        {
            users.Update(user);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { success = false, message = ex.Message });
        }

        return Ok(ToDto(user));
    }

    [HttpDelete("users/{id}")]
    [RequirePermission(PermissionModules.Accounts, PermissionActions.Manage)]
    public IActionResult DeleteUser(string id)
    {
        var user = users.FindById(id);
        if (user is null) return NotFound();

        // Built-in system admin must never be deleted
        if (string.Equals(user.Id, "u-admin", StringComparison.OrdinalIgnoreCase)
            || string.Equals(user.Username, "admin", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { success = false, message = "لا يمكن حذف حساب مدير النظام الأساسي." });

        // Prevent deleting the currently signed-in user
        if (HttpContext.Items["AppUser"] is AppUser me
            && string.Equals(me.Id, user.Id, StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { success = false, message = "لا يمكن حذف حسابك الحالي أثناء تسجيل الدخول." });

        // Keep at least one Admin in the system
        if (string.Equals(user.Role, "Admin", StringComparison.OrdinalIgnoreCase)
            && users.GetAll().Count(u =>
                string.Equals(u.Role, "Admin", StringComparison.OrdinalIgnoreCase)) <= 1)
            return BadRequest(new { success = false, message = "لا يمكن حذف آخر حساب مدير." });

        users.Delete(id);
        return NoContent();
    }

    private static UserDto ToDto(AppUser u) => new()
    {
        Id = u.Id,
        Username = u.Username,
        DisplayName = u.DisplayName,
        Email = u.Email,
        Role = u.Role,
        Status = u.Status,
        CreatedAt = u.CreatedAt,
        Permissions = u.Permissions.ToDictionary(kv => kv.Key, kv => kv.Value.ToList())
    };

    /// <summary>Default permission matrix by role.</summary>
    public static Dictionary<string, List<string>> PermissionsForRole(string role)
    {
        if (string.Equals(role, "Admin", StringComparison.OrdinalIgnoreCase)
            || string.Equals(role, "Administrator", StringComparison.OrdinalIgnoreCase))
        {
            return PermissionModules.All.ToDictionary(
                m => m,
                _ => new List<string>
                {
                    PermissionActions.View, PermissionActions.Create, PermissionActions.Edit,
                    PermissionActions.Delete, PermissionActions.Export, PermissionActions.Manage,
                    PermissionActions.Approve
                });
        }

        if (string.Equals(role, "Viewer", StringComparison.OrdinalIgnoreCase))
        {
            var d = new Dictionary<string, List<string>>();
            foreach (var m in PermissionModules.All)
            {
                d[m] = m is PermissionModules.Accounts or PermissionModules.ImportExport
                    ? []
                    : [PermissionActions.View];
            }
            return d;
        }

        // Default "User": view everything operational, no accounts/import manage
        var user = new Dictionary<string, List<string>>();
        foreach (var m in PermissionModules.All)
        {
            if (m is PermissionModules.Accounts)
                user[m] = [];
            else if (m is PermissionModules.ImportExport)
                user[m] = [PermissionActions.View, PermissionActions.Export];
            else
                user[m] =
                [
                    PermissionActions.View, PermissionActions.Create,
                    PermissionActions.Edit, PermissionActions.Delete
                ];
        }
        return user;
    }
}
