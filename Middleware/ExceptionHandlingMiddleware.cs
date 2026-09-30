using System.Net; using System.Text.Json;
namespace InvoicesErp.Middleware;
public sealed class ExceptionHandlingMiddleware(RequestDelegate next,ILogger<ExceptionHandlingMiddleware> logger)
{
 public async Task Invoke(HttpContext context){try{await next(context);}catch(Exception ex){logger.LogError(ex,"Unhandled exception");context.Response.StatusCode=(int)HttpStatusCode.InternalServerError;context.Response.ContentType="application/json";await context.Response.WriteAsync(JsonSerializer.Serialize(new{success=false,message="حدث خطأ غير متوقع",errors=Array.Empty<string>()}));}}
}
