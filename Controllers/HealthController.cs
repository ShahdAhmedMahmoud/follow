using InvoicesErp.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace InvoicesErp.Controllers;

[ApiController]
[Route("api/health")]
public class HealthController(AppDbContext db, IConfiguration config) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var dbOk = false;
        string? dbError = null;
        try
        {
            dbOk = await db.Database.CanConnectAsync(ct);
        }
        catch (Exception ex)
        {
            dbError = ex.GetType().Name;
        }

        var payload = new
        {
            status = dbOk ? "Healthy" : "Degraded",
            utc = DateTime.UtcNow,
            environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Unknown",
            database = new { connected = dbOk, error = dbError },
            version = typeof(HealthController).Assembly.GetName().Version?.ToString()
        };

        return dbOk ? Ok(payload) : StatusCode(StatusCodes.Status503ServiceUnavailable, payload);
    }
}
