using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using InvoicesErp.Data;
using InvoicesErp.Models;
using InvoicesErp.DTOs;
using InvoicesErp.Auth;
using InvoicesErp.Common;

namespace InvoicesErp.Controllers;

[ApiController]
[Route("api/projects")]
public class ProjectsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    [RequirePermission(PermissionModules.Projects, PermissionActions.View)]
    public async Task<IActionResult> GetAll(
        [FromQuery] string? ownerId,
        [FromQuery] int? page,
        [FromQuery] int? pageSize,
        [FromQuery] string? search,
        [FromQuery] string? sortBy,
        [FromQuery] string? sortDirection,
        CancellationToken ct)
    {
        var q = db.Projects.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(ownerId))
            q = q.Where(x => x.OwnerId == ownerId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(x => x.Name.Contains(s) || (x.Status != null && x.Status.Contains(s)));
        }
        var desc = string.Equals(sortDirection, "desc", StringComparison.OrdinalIgnoreCase);
        q = (sortBy?.ToLowerInvariant()) switch
        {
            "status" => desc ? q.OrderByDescending(x => x.Status) : q.OrderBy(x => x.Status),
            "startdate" => desc ? q.OrderByDescending(x => x.StartDate) : q.OrderBy(x => x.StartDate),
            _ => desc ? q.OrderByDescending(x => x.Name) : q.OrderBy(x => x.Name)
        };
        var projected = q.Select(x => new ProjectDto(x.Id, x.OwnerId, x.Name, x.StartDate, x.Status, x.SectorId, x.SectorManagerId));
        if (page is null)
            return Ok(await projected.ToListAsync(ct));
        return Ok(await projected.ToPagedAsync(page.Value, pageSize ?? 25, ct));
    }

    [HttpGet("{id}")]
    [RequirePermission(PermissionModules.Projects, PermissionActions.View)]
    public async Task<ActionResult<ProjectDto>> GetById(string id, CancellationToken ct)
    {
        var x = await db.Projects.FindAsync([id], ct);
        return x is null
            ? NotFound()
            : Ok(new ProjectDto(x.Id, x.OwnerId, x.Name, x.StartDate, x.Status, x.SectorId, x.SectorManagerId));
    }

    /// <summary>
    /// Active sector managers for project assignment (frontend: GET /api/projects/sector-managers).
    /// </summary>
    [HttpGet("sector-managers")]
    [RequirePermission(PermissionModules.Projects, PermissionActions.View)]
    public async Task<IActionResult> GetSectorManagers(CancellationToken ct)
    {
        var list = await db.SectorManagers
            .AsNoTracking()
            .Where(m => m.IsActive)
            .Select(m => new
            {
                id = m.SectorManagerId.ToString(),
                sectorManagerId = m.SectorManagerId,
                fullName = m.FullName,
                displayName = m.FullName,
                sectorId = m.SectorId,
                sectorName = m.Sector.Name,
                isActive = m.IsActive
            })
            .OrderBy(m => m.fullName)
            .ToListAsync(ct);
        return Ok(list);
    }

    [HttpPost]
    [RequirePermission(PermissionModules.Projects, PermissionActions.Create)]
    public async Task<ActionResult<ProjectDto>> Post(ProjectDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.OwnerId))
            return BadRequest(new { success = false, message = "معرف المالك مطلوب" });

        if (!await db.Owners.AnyAsync(x => x.Id == dto.OwnerId, ct))
            return BadRequest(new { success = false, message = "المالك غير موجود" });

        var (ok, error, sectorId, sectorManagerId) = await ResolveSectorAssignmentAsync(dto.SectorId, dto.SectorManagerId, ct);
        if (!ok)
            return BadRequest(new { success = false, message = error });

        var x = new Project
        {
            Id = await GenerateIdAsync(),
            OwnerId = dto.OwnerId,
            Name = (dto.Name ?? "").Trim(),
            StartDate = dto.StartDate,
            Status = dto.Status,
            SectorId = sectorId,
            SectorManagerId = sectorManagerId
        };
        db.Add(x);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(GetById), new { id = x.Id },
            new ProjectDto(x.Id, x.OwnerId, x.Name, x.StartDate, x.Status, x.SectorId, x.SectorManagerId));
    }

    [HttpPut("{id}")]
    [RequirePermission(PermissionModules.Projects, PermissionActions.Edit)]
    public async Task<IActionResult> Put(string id, ProjectDto dto, CancellationToken ct)
    {
        var x = await db.Projects.FindAsync([id], ct);
        if (x is null) return NotFound();

        if (string.IsNullOrWhiteSpace(dto.OwnerId))
            return BadRequest(new { success = false, message = "معرف المالك مطلوب" });

        if (!await db.Owners.AnyAsync(o => o.Id == dto.OwnerId, ct))
            return BadRequest(new { success = false, message = "المالك غير موجود" });

        var (ok, error, sectorId, sectorManagerId) = await ResolveSectorAssignmentAsync(dto.SectorId, dto.SectorManagerId, ct);
        if (!ok)
            return BadRequest(new { success = false, message = error });

        x.OwnerId = dto.OwnerId;
        x.Name = (dto.Name ?? "").Trim();
        x.StartDate = dto.StartDate;
        x.Status = dto.Status;
        x.SectorId = sectorId;
        x.SectorManagerId = sectorManagerId;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("{id}")]
    [RequirePermission(PermissionModules.Projects, PermissionActions.Delete)]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var x = await db.Projects.FindAsync([id], ct);
        if (x is null) return NotFound();

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var contractIds = await db.Contracts.Where(c => c.ProjectId == id).Select(c => c.Id).ToListAsync(ct);
        if (contractIds.Count > 0)
        {
            var invoiceIds = await db.Invoices.Where(i => contractIds.Contains(i.ContractId)).Select(i => i.Id).ToListAsync(ct);
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
            await db.ExecPositions.Where(e => contractIds.Contains(e.ContractId)).ExecuteDeleteAsync(ct);
            await db.SocialInsuranceContracts.Where(s => contractIds.Contains(s.ContractId)).ExecuteDeleteAsync(ct);
            await db.Contracts.Where(c => contractIds.Contains(c.Id)).ExecuteDeleteAsync(ct);
        }

        db.Projects.Remove(x);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }

    /// <summary>
    /// Enforces Sector → SectorManager → Project consistency.
    /// </summary>
    private async Task<(bool ok, string? error, int? sectorId, int? sectorManagerId)> ResolveSectorAssignmentAsync(
        int? sectorId,
        int? sectorManagerId,
        CancellationToken ct)
    {
        if (sectorManagerId.HasValue)
        {
            var manager = await db.SectorManagers
                .AsNoTracking()
                .FirstOrDefaultAsync(m => m.SectorManagerId == sectorManagerId.Value, ct);

            if (manager is null)
                return (false, "مدير القطاع غير موجود", null, null);

            if (!manager.IsActive)
                return (false, "لا يمكن تعيين مدير قطاع غير نشط للمشروع", null, null);

            if (sectorId.HasValue && sectorId.Value != manager.SectorId)
            {
                return (false,
                    "مدير القطاع لا ينتمي إلى القطاع المحدد. يجب أن يكون المشروع ومدير القطاع ضمن نفس القطاع",
                    null, null);
            }

            var sectorExists = await db.Sectors.AnyAsync(s => s.SectorId == manager.SectorId, ct);
            if (!sectorExists)
                return (false, "القطاع المرتبط بمدير القطاع غير موجود", null, null);

            return (true, null, manager.SectorId, manager.SectorManagerId);
        }

        if (sectorId.HasValue)
        {
            var sector = await db.Sectors.AsNoTracking()
                .FirstOrDefaultAsync(s => s.SectorId == sectorId.Value, ct);
            if (sector is null)
                return (false, "القطاع غير موجود", null, null);

            return (true, null, sector.SectorId, null);
        }

        return (true, null, null, null);
    }

    private async Task<string> GenerateIdAsync()
    {
        var max = await db.Projects.Select(p => p.Id).Where(id => id.StartsWith("P-")).ToListAsync();
        var next = max.Select(id => int.TryParse(id.AsSpan(2), out var n) ? n : 0).DefaultIfEmpty(99).Max() + 1;
        return $"P-{next}";
    }
}
