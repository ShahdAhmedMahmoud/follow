using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using InvoicesErp.Data;
using InvoicesErp.Models;
using InvoicesErp.DTOs;
using InvoicesErp.Auth;

namespace InvoicesErp.Controllers;

[ApiController, Route("api/escalations")]
public class EscalationsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    [RequirePermission(PermissionModules.Escalations, PermissionActions.View)]
    public async Task<ActionResult<IEnumerable<EscalationDto>>> Get(CancellationToken ct) =>
        Ok(await db.EscalationResponses.AsNoTracking()
            .Select(x => new EscalationDto(x.InvoiceDeductionId, x.ResponseStatus, x.ResponseDate, x.ReturnedAmount))
            .ToListAsync(ct));

    [HttpPut("{invoiceDeductionId}")]
    [RequirePermission(PermissionModules.Escalations, PermissionActions.Edit)]
    public async Task<IActionResult> Put(string invoiceDeductionId, EscalationDto d, CancellationToken ct)
    {
        var x = await db.EscalationResponses.FirstOrDefaultAsync(x => x.InvoiceDeductionId == invoiceDeductionId, ct);
        if (x is null)
        {
            x = new EscalationResponse { Id = await GenerateIdAsync(), InvoiceDeductionId = invoiceDeductionId };
            db.Add(x);
        }
        x.ResponseStatus = d.ResponseStatus;
        x.ResponseDate = d.ResponseDate;
        x.ReturnedAmount = d.ReturnedAmount;
        x.ReturnedAmount = d.ReturnedAmount;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task<string> GenerateIdAsync()
    {
        var max = await db.EscalationResponses.Select(e => e.Id).Where(id => id.StartsWith("ES-")).ToListAsync();
        var next = max.Select(id => int.TryParse(id.AsSpan(3), out var n) ? n : 0).DefaultIfEmpty(99).Max() + 1;
        return $"ES-{next}";
    }
}
