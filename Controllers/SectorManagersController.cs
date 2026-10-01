using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using InvoicesErp.Data;
using InvoicesErp.Models;
using InvoicesErp.DTOs;
using InvoicesErp.Auth;
using InvoicesErp.Common;

namespace InvoicesErp.Controllers;

[ApiController]
[Route("api/sector-managers")]
public class SectorManagersController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    [RequirePermission(PermissionModules.Projects, PermissionActions.View)]
    public async Task<IActionResult> GetAll(
        [FromQuery] string? search,
        [FromQuery] string? status,
        CancellationToken ct)
    {
        var q = db.SectorManagers.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(status))
            q = q.Where(x => x.Status == status);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(x => x.Name.Contains(s) || (x.Sector != null && x.Sector.Contains(s)));
        }

        var list = await q
            .OrderBy(x => x.Name)
            .Select(x => new SectorManagerDto(
                x.Id,
                x.Name,
                x.Sector,
                x.Phone,
                x.Email,
                x.Notes,
                x.Status,
                x.Projects.Count))
            .ToListAsync(ct);

        return Ok(list);
    }

    [HttpGet("{id}")]
    [RequirePermission(PermissionModules.Projects, PermissionActions.View)]
    public async Task<ActionResult<SectorManagerDto>> GetById(string id, CancellationToken ct)
    {
        var x = await db.SectorManagers
            .AsNoTracking()
            .Include(m => m.Projects)
            .FirstOrDefaultAsync(m => m.Id == id, ct);

        if (x is null) return NotFound();

        return Ok(new SectorManagerDto(
            x.Id,
            x.Name,
            x.Sector,
            x.Phone,
            x.Email,
            x.Notes,
            x.Status,
            x.Projects.Count));
    }

    [HttpPost]
    [RequirePermission(PermissionModules.Projects, PermissionActions.Create)]
    public async Task<ActionResult<SectorManagerDto>> Post(SectorManagerDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Name))
            return BadRequest(new { success = false, message = "اسم مدير القطاع مطلوب" });

        var id = await GenerateIdAsync();
        var manager = new SectorManager
        {
            Id = id,
            Name = dto.Name.Trim(),
            Sector = dto.Sector?.Trim(),
            Phone = dto.Phone?.Trim(),
            Email = dto.Email?.Trim(),
            Notes = dto.Notes?.Trim(),
            Status = dto.Status ?? "Active",
            CreatedAt = DateTime.UtcNow
        };

        db.SectorManagers.Add(manager);
        await db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(GetById), new { id = manager.Id },
            new SectorManagerDto(manager.Id, manager.Name, manager.Sector, manager.Phone, manager.Email, manager.Notes, manager.Status, 0));
    }

    [HttpPut("{id}")]
    [RequirePermission(PermissionModules.Projects, PermissionActions.Edit)]
    public async Task<IActionResult> Put(string id, SectorManagerDto dto, CancellationToken ct)
    {
        var manager = await db.SectorManagers.FindAsync([id], ct);
        if (manager is null) return NotFound();

        manager.Name = dto.Name.Trim();
        manager.Sector = dto.Sector?.Trim();
        manager.Phone = dto.Phone?.Trim();
        manager.Email = dto.Email?.Trim();
        manager.Notes = dto.Notes?.Trim();
        manager.Status = dto.Status ?? manager.Status;

        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("{id}")]
    [RequirePermission(PermissionModules.Projects, PermissionActions.Delete)]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var manager = await db.SectorManagers.FindAsync([id], ct);
        if (manager is null) return NotFound();

        // Nullify foreign key in projects before deletion
        var projects = await db.Projects.Where(p => p.SectorManagerId == id).ToListAsync(ct);
        foreach (var p in projects)
        {
            p.SectorManagerId = null;
        }

        db.SectorManagers.Remove(manager);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task<string> GenerateIdAsync()
    {
        var max = await db.SectorManagers.Select(p => p.Id).Where(id => id.StartsWith("SM-")).ToListAsync();
        var next = max.Select(id => int.TryParse(id.AsSpan(3), out var n) ? n : 0).DefaultIfEmpty(0).Max() + 1;
        return $"SM-{next:D3}";
    }
}
