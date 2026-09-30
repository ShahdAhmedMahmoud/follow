using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using InvoicesErp.Data;
using InvoicesErp.Auth;

namespace InvoicesErp.Controllers;

[ApiController, Route("api/reports")]
public class ReportsController(AppDbContext db) : ControllerBase
{
    [HttpGet("dashboard")]
    [RequirePermission(PermissionModules.Reports, PermissionActions.View)]
    public async Task<IActionResult> Dashboard(CancellationToken ct)
    {
        var invoices = await db.Invoices.AsNoTracking().ToListAsync(ct);
        return Ok(new
        {
            success = true,
            contracts = await db.Contracts.CountAsync(ct),
            projects = await db.Projects.CountAsync(ct),
            owners = await db.Owners.CountAsync(ct),
            invoices = invoices.Count,
            gross = invoices.Sum(x => x.WorkVolume + x.VariationOrders + x.Materials + x.Claims + x.Vat),
            paid = invoices.Sum(x => x.PaidAmount)
        });
    }
}
