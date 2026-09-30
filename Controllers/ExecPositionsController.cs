using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using InvoicesErp.Data;
using InvoicesErp.Models;
using InvoicesErp.DTOs;
using InvoicesErp.Auth;

namespace InvoicesErp.Controllers;

[ApiController]
[Route("api/execution-positions")]
public class ExecPositionsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    [RequirePermission(PermissionModules.ExecPosition, PermissionActions.View)]
    public async Task<ActionResult<IEnumerable<ExecPositionDto>>> Get(
        [FromQuery] string? contractId, CancellationToken ct)
    {
        var q = db.ExecPositions.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(contractId)) q = q.Where(x => x.ContractId == contractId);
        return Ok(await q.OrderByDescending(x => x.Date).ThenByDescending(x => x.VersionNumber)
            .Select(x => new ExecPositionDto(x.Id, x.ContractId, x.VersionNumber, x.Date, x.User, x.WorkVolume, x.VariationOrders, x.Materials, x.Claims, x.Vat, x.TotalAmount))
            .ToListAsync(ct));
    }

    [HttpGet("{id}")]
    [RequirePermission(PermissionModules.ExecPosition, PermissionActions.View)]
    public async Task<ActionResult<ExecPositionDto>> GetById(string id, CancellationToken ct)
    {
        var x = await db.ExecPositions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return x is null ? NotFound() : Ok(new ExecPositionDto(x.Id, x.ContractId, x.VersionNumber, x.Date, x.User, x.WorkVolume, x.VariationOrders, x.Materials, x.Claims, x.Vat, x.TotalAmount));
    }

    [HttpPost]
    [RequirePermission(PermissionModules.ExecPosition, PermissionActions.Create)]
    public async Task<ActionResult<ExecPositionDto>> Post(ExecPositionDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.ContractId))
            return BadRequest(new { success = false, message = "العقد مطلوب" });
        if (!dto.Date.HasValue)
            return BadRequest(new { success = false, message = "تاريخ الموقف التنفيذي مطلوب" });
        if (!await db.Contracts.AnyAsync(x => x.Id == dto.ContractId, ct))
            return BadRequest(new { success = false, message = "العقد غير موجود" });

        var x = new ExecPosition
        {
            Id = string.IsNullOrWhiteSpace(dto.Id) ? await GenerateIdAsync() : dto.Id,
            ContractId = dto.ContractId, VersionNumber = dto.VersionNumber, Date = dto.Date.Value,
            User = ResolveActorName(dto.User),
            WorkVolume = dto.WorkVolume, VariationOrders = dto.VariationOrders,
            Materials = dto.Materials, Claims = dto.Claims, Vat = dto.Vat, TotalAmount = dto.TotalAmount
        };
        db.ExecPositions.Add(x);
        await db.SaveChangesAsync(ct);
        await SyncContractDynamicAmountsAsync(x.ContractId, ct);
        return CreatedAtAction(nameof(GetById), new { id = x.Id },
            new ExecPositionDto(x.Id, x.ContractId, x.VersionNumber, x.Date, x.User, x.WorkVolume, x.VariationOrders, x.Materials, x.Claims, x.Vat, x.TotalAmount));
    }

    [HttpPut("{id}")]
    [RequirePermission(PermissionModules.ExecPosition, PermissionActions.Edit)]
    public async Task<IActionResult> Put(string id, ExecPositionDto dto, CancellationToken ct)
    {
        var x = await db.ExecPositions.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (x is null) return NotFound();
        if (string.IsNullOrWhiteSpace(dto.ContractId))
            return BadRequest(new { success = false, message = "العقد مطلوب" });
        if (!dto.Date.HasValue)
            return BadRequest(new { success = false, message = "تاريخ الموقف التنفيذي مطلوب" });
        if (!await db.Contracts.AnyAsync(c => c.Id == dto.ContractId, ct))
            return BadRequest(new { success = false, message = "العقد غير موجود" });

        var previousContractId = x.ContractId;
        x.ContractId = dto.ContractId; x.VersionNumber = dto.VersionNumber; x.Date = dto.Date.Value;
        x.User = ResolveActorName(dto.User); x.WorkVolume = dto.WorkVolume; x.VariationOrders = dto.VariationOrders;
        x.Materials = dto.Materials; x.Claims = dto.Claims; x.Vat = dto.Vat; x.TotalAmount = dto.TotalAmount;
        await db.SaveChangesAsync(ct);
        await SyncContractDynamicAmountsAsync(x.ContractId, ct);
        if (!string.Equals(previousContractId, x.ContractId, StringComparison.Ordinal))
            await SyncContractDynamicAmountsAsync(previousContractId, ct);
        return NoContent();
    }

    [HttpDelete("{id}")]
    [RequirePermission(PermissionModules.ExecPosition, PermissionActions.Delete)]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var x = await db.ExecPositions.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (x is null) return NotFound();
        var contractId = x.ContractId;
        db.ExecPositions.Remove(x);
        await db.SaveChangesAsync(ct);
        await SyncContractDynamicAmountsAsync(contractId, ct);
        return NoContent();
    }


    /// <summary>
    /// Updates contract VO / Claims / VAT from the latest executive position of the same contract.
    /// ModifiedAmount (حصر البنود) is never overwritten — it remains manual.
    /// </summary>

    private string ResolveActorName(string? fromClient)
    {
        if (HttpContext.Items.TryGetValue("AppUser", out var obj) && obj is AppUser appUser)
        {
            if (!string.IsNullOrWhiteSpace(appUser.DisplayName))
                return appUser.DisplayName.Trim();
            if (!string.IsNullOrWhiteSpace(appUser.Username))
                return appUser.Username.Trim();
        }
        if (!string.IsNullOrWhiteSpace(fromClient))
            return fromClient.Trim();
        return "مستخدم";
    }

    private async Task SyncContractDynamicAmountsAsync(string? contractId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(contractId)) return;
        var contract = await db.Contracts.FirstOrDefaultAsync(c => c.Id == contractId, ct);
        if (contract is null) return;

        var latest = await db.ExecPositions.AsNoTracking()
            .Where(e => e.ContractId == contractId)
            .OrderByDescending(e => e.VersionNumber)
            .ThenByDescending(e => e.Date)
            .FirstOrDefaultAsync(ct);

        if (latest is null)
        {
            contract.VoAmount = 0;
            contract.ClaimsAmount = 0;
            contract.VatAmount = 0;
        }
        else
        {
            contract.VoAmount = latest.VariationOrders;
            contract.ClaimsAmount = latest.Claims;
            contract.VatAmount = latest.Vat;
        }
        await db.SaveChangesAsync(ct);
    }

    private async Task<string> GenerateIdAsync()
    {
        var max = await db.ExecPositions.Select(e => e.Id).Where(id => id.StartsWith("EP-")).ToListAsync();
        var next = max.Select(id => int.TryParse(id.AsSpan(3), out var n) ? n : 0).DefaultIfEmpty(99).Max() + 1;
        return $"EP-{next}";
    }
}
