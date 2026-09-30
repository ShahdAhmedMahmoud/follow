using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using InvoicesErp.Services;

namespace InvoicesErp.Auth;

/// <summary>
/// Enforces module/action permission on a controller action.
/// Admin role always passes.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
public sealed class RequirePermissionAttribute : Attribute, IAuthorizationFilter
{
    public string Module { get; }
    public string Action { get; }

    public RequirePermissionAttribute(string module, string action)
    {
        Module = module;
        Action = action;
    }

    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.Items["AppUser"] as AppUser;
        if (user is null)
        {
            context.Result = new JsonResult(new
            {
                success = false,
                message = "غير مصرح. يرجى تسجيل الدخول."
            })
            { StatusCode = StatusCodes.Status401Unauthorized };
            return;
        }

        var auth = context.HttpContext.RequestServices.GetRequiredService<InvoicesErp.Interfaces.IAuthService>();
        if (!auth.HasPermission(user, Module, Action))
        {
            context.Result = new JsonResult(new
            {
                success = false,
                message = "ليس لديك صلاحية لتنفيذ هذه العملية.",
                module = Module,
                action = Action
            })
            { StatusCode = StatusCodes.Status403Forbidden };
        }
    }
}
