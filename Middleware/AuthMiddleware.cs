using InvoicesErp.Services;

namespace InvoicesErp.Middleware;

/// <summary>
/// Reads Bearer token and attaches AppUser to HttpContext.Items["AppUser"].
/// </summary>
public class AuthMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, InvoicesErp.Interfaces.IAuthService auth)
    {
        var header = context.Request.Headers.Authorization.FirstOrDefault();
        if (!string.IsNullOrEmpty(header) && header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            var token = header["Bearer ".Length..].Trim();
            if (!string.IsNullOrEmpty(token))
            {
                var user = auth.ValidateToken(token);
                if (user is not null)
                    context.Items["AppUser"] = user;
            }
        }

        await next(context);
    }
}