using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using InvoicesErp.Data;
using InvoicesErp.Models;
using InvoicesErp.DTOs;
using InvoicesErp.Auth;
using InvoicesErp.Common;

namespace InvoicesErp.Controllers;

[ApiController]
[Route("api/contracts")]
public class ContractsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    [RequirePermission(PermissionModules.Contracts, PermissionActions.View)]
    public async Task<IActionResult> GetAll(
        [FromQuery] string? projectId,
        [FromQuery] int? page,
        [FromQuery] int? pageSize,
        [FromQuery] string? search,
        [FromQuery] string? sortBy,
        [FromQuery] string? sortDirection,
        CancellationToken ct)
    {
        var q = db.Contracts.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(projectId))
            q = q.Where(x => x.ProjectId == projectId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(x => x.Name.Contains(s) || (x.Status != null && x.Status.Contains(s)));
        }
        var desc = string.Equals(sortDirection, "desc", StringComparison.OrdinalIgnoreCase);
        q = (sortBy?.ToLowerInvariant()) switch
        {
            "amount" => desc ? q.OrderByDescending(x => x.Amount) : q.OrderBy(x => x.Amount),
            "status" => desc ? q.OrderByDescending(x => x.Status) : q.OrderBy(x => x.Status),
            "signdate" => desc ? q.OrderByDescending(x => x.SignDate) : q.OrderBy(x => x.SignDate),
            _ => desc ? q.OrderByDescending(x => x.Name) : q.OrderBy(x => x.Name)
        };
        var projected = q.Select(x => new ContractDto(x.Id, x.ProjectId, x.Name, x.Amount, x.ModifiedAmount, x.VoAmount, x.ClaimsAmount, x.VatAmount, x.PaymentTerms, x.SignDate, x.Status, x.ContractDuration, x.EndDate));
        if (page is null)
            return Ok(await projected.ToListAsync(ct));
        return Ok(await projected.ToPagedAsync(page.Value, pageSize ?? 25, ct));
    }

    [HttpGet("{id}")]
    [RequirePermission(PermissionModules.Contracts, PermissionActions.View)]
    public async Task<ActionResult<ContractDto>> GetById(string id, CancellationToken ct)
    {
        var x = await db.Contracts.FindAsync([id], ct);
        return x is null ? NotFound() : Ok(new ContractDto(x.Id, x.ProjectId, x.Name, x.Amount, x.ModifiedAmount, x.VoAmount, x.ClaimsAmount, x.VatAmount, x.PaymentTerms, x.SignDate, x.Status, x.ContractDuration, x.EndDate));
    }

    [HttpPost]
    [RequirePermission(PermissionModules.Contracts, PermissionActions.Create)]
    public async Task<ActionResult<ContractDto>> Post(ContractDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.ProjectId))
            return BadRequest(new { success = false, message = "معرف المشروع مطلوب" });

        if (!await db.Projects.AnyAsync(x => x.Id == dto.ProjectId, ct))
            return BadRequest(new { success = false, message = "المشروع غير موجود" });

        if (!dto.SignDate.HasValue)
            return BadRequest(new { success = false, message = "تاريخ بداية العقد (تاريخ التوقيع) مطلوب" });

        if (dto.ContractDuration <= 0)
            return BadRequest(new { success = false, message = "مدة العقد يجب أن تكون أكبر من صفر (بالأيام)" });

        // Backend calculates EndDate; client must not control it.
        // Rule: EndDate = StartDate (SignDate) + DurationDays
        var endDate = dto.SignDate.Value.AddDays(dto.ContractDuration);

        var x = new Contract
        {
            Id = await GenerateIdAsync(),
            ProjectId = dto.ProjectId,
            Name = (dto.Name ?? "").Trim(),
            Amount = dto.Amount,
            ModifiedAmount = dto.ModifiedAmount < 0 ? 0 : dto.ModifiedAmount,
            VoAmount = 0,
            ClaimsAmount = 0,
            VatAmount = 0,
            PaymentTerms = dto.PaymentTerms,
            SignDate = dto.SignDate,
            ContractDuration = dto.ContractDuration,
            EndDate = endDate,
            Status = dto.Status
        };
        db.Add(x);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(GetById), new { id = x.Id },
            new ContractDto(x.Id, x.ProjectId, x.Name, x.Amount, x.ModifiedAmount, x.VoAmount, x.ClaimsAmount, x.VatAmount, x.PaymentTerms, x.SignDate, x.Status, x.ContractDuration, x.EndDate));
    }

    [HttpPut("{id}")]
    [RequirePermission(PermissionModules.Contracts, PermissionActions.Edit)]
    public async Task<IActionResult> Put(string id, ContractDto dto, CancellationToken ct)
    {
        var x = await db.Contracts.FindAsync([id], ct);
        if (x is null) return NotFound();

        if (string.IsNullOrWhiteSpace(dto.ProjectId))
            return BadRequest(new { success = false, message = "معرف المشروع مطلوب" });

        if (!await db.Projects.AnyAsync(p => p.Id == dto.ProjectId, ct))
            return BadRequest(new { success = false, message = "المشروع غير موجود" });

        if (!dto.SignDate.HasValue)
            return BadRequest(new { success = false, message = "تاريخ بداية العقد (تاريخ التوقيع) مطلوب" });

        if (dto.ContractDuration <= 0)
            return BadRequest(new { success = false, message = "مدة العقد يجب أن تكون أكبر من صفر (بالأيام)" });

        // Recalculate EndDate whenever SignDate or DurationDays is updated.
        var endDate = dto.SignDate.Value.AddDays(dto.ContractDuration);

        x.ProjectId = dto.ProjectId;
        x.Name = (dto.Name ?? "").Trim();
        x.Amount = dto.Amount;
        // Manual field only — VO/Claims/Vat stay driven by exec position
        x.ModifiedAmount = dto.ModifiedAmount < 0 ? 0 : dto.ModifiedAmount;
        x.PaymentTerms = dto.PaymentTerms;
        x.SignDate = dto.SignDate;
        x.Status = dto.Status;
        x.ContractDuration = dto.ContractDuration;
        x.EndDate = endDate;

        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("{id}")]
    [RequirePermission(PermissionModules.Contracts, PermissionActions.Delete)]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var x = await db.Contracts.FindAsync([id], ct);
        if (x is null) return NotFound();

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var invoiceIds = await db.Invoices.Where(i => i.ContractId == id).Select(i => i.Id).ToListAsync(ct);
        if (invoiceIds.Count > 0)
        {
            var deductionIds = await db.InvoiceDeductions.Where(d => invoiceIds.Contains(d.InvoiceId)).Select(d => d.Id).ToListAsync(ct);
            if (deductionIds.Count > 0)
                await db.EscalationResponses.Where(e => deductionIds.Contains(e.InvoiceDeductionId)).ExecuteDeleteAsync(ct);
            await db.SocialInsurancePayments.Where(p => invoiceIds.Contains(p.InvoiceId)).ExecuteDeleteAsync(ct);
            await db.InvoiceDeductions.Where(d => invoiceIds.Contains(d.InvoiceId)).ExecuteDeleteAsync(ct);
            await db.InvoiceItems.Where(i => invoiceIds.Contains(i.InvoiceId)).ExecuteDeleteAsync(ct);
            await db.Invoices.Where(i => invoiceIds.Contains(i.Id)).ExecuteDeleteAsync(ct);
        }
        await db.ExecPositions.Where(e => e.ContractId == id).ExecuteDeleteAsync(ct);
        await db.SocialInsuranceContracts.Where(s => s.ContractId == id).ExecuteDeleteAsync(ct);
        var ccIds = await db.CostControls.Where(c => c.ContractId == id).Select(c => c.Id).ToListAsync(ct);
        if (ccIds.Count > 0)
        {
            var itemIds = await db.CostControlItems.Where(i => ccIds.Contains(i.CostControlId)).Select(i => i.Id).ToListAsync(ct);
            if (itemIds.Count > 0)
                await db.CostControlSubItems.Where(s => itemIds.Contains(s.CostControlItemId)).ExecuteDeleteAsync(ct);
            await db.CostControlItems.Where(i => ccIds.Contains(i.CostControlId)).ExecuteDeleteAsync(ct);
            await db.CostControls.Where(c => ccIds.Contains(c.Id)).ExecuteDeleteAsync(ct);
        }

        db.Contracts.Remove(x);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }

    private async Task<string> GenerateIdAsync()
    {
        var max = await db.Contracts.Select(c => c.Id).Where(id => id.StartsWith("C-")).ToListAsync();
        var next = max.Select(id => int.TryParse(id.AsSpan(2), out var n) ? n : 0).DefaultIfEmpty(99).Max() + 1;
        return $"C-{next}";
    }
}
