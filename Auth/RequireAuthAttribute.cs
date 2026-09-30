using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace InvoicesErp.Auth;

/// <summary>
/// Requires any authenticated user (no specific permission).
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class RequireAuthAttribute : Attribute, IAuthorizationFilter
{
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
        }
    }
}
