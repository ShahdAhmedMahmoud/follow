using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using InvoicesErp.Data;
using InvoicesErp.Models;
using InvoicesErp.DTOs;
using InvoicesErp.Auth;
using InvoicesErp.Interfaces;

namespace InvoicesErp.Controllers;

[ApiController]
[Route("api/cost-control")]
public class CostControlController(AppDbContext db, InvoicesErp.Interfaces.ICostControlCalculator calc) : ControllerBase
{
    // أسماء البنود الرئيسية الافتراضية (من ورقة معادلات مراقبة التكاليف)
    private static readonly (string Name, string Code, string CostType, int Order)[] DefaultMainItems =
    [
        ("Sponser Ship", "IND-1", "INDIRECT", 1),
        ("Inv.Deduction", "IND-2", "INDIRECT", 2),
        ("VAT ", "IND-3", "INDIRECT", 3),
        ("InDirect Cost", "IND-4", "INDIRECT", 4),
        ("Direct Cost", "DIR-1", "DIRECT", 5),
    ];

    private static readonly HashSet<string> DefaultMainItemCodes = new(StringComparer.OrdinalIgnoreCase)
    {
        "IND-1", "IND-2", "IND-3", "IND-4", "DIR-1"
    };

    private static bool IsDefaultMainItem(CostControlItem item) =>
        !string.IsNullOrWhiteSpace(item.Code) && DefaultMainItemCodes.Contains(item.Code.Trim());

    // ---------- helpers ----------

    private static decimal SafeDiv(decimal num, decimal den) =>
        den == 0 ? 0 : num / den;

    /// <summary>
    /// قيمة العقد المعدل من موديول العقود (لا تُدخل يدويًا في Cost Control):
    /// الأساس = ModifiedAmount إن وُجد وإلا Amount، ثم + VO + Claims + VAT
    /// </summary>
 private static decimal GetRevisedContractValue(Contract c)
    => c.ModifiedAmount + c.VoAmount + c.ClaimsAmount + c.VatAmount;

    private async Task<(decimal progressAmount, decimal progressPct)> GetProgressAsync(string contractId, decimal revisedValue, CancellationToken ct)
    {
        var latest = await db.ExecPositions.AsNoTracking()
            .Where(e => e.ContractId == contractId)
            .OrderByDescending(e => e.VersionNumber)
            .ThenByDescending(e => e.Date)
            .FirstOrDefaultAsync(ct);

        var amount = latest?.TotalAmount ?? 0m;
        if (amount < 0) amount = 0;
        var pct = revisedValue > 0 ? Math.Min(100m, SafeDiv(amount, revisedValue) * 100m) : 0m;
        return (amount, pct);
    }

    private static CostControlSummaryDto BuildSummary(
        decimal original, decimal revised, decimal progressAmount, decimal progressPct,
        List<CostControlItemDto> items)
    {
        decimal SumBy(string type, Func<CostControlItemDto, decimal> sel) =>
            items.Where(i => string.Equals(i.CostType, type, StringComparison.OrdinalIgnoreCase)).Sum(sel);

        var indBudget = SumBy("INDIRECT", i => i.TotalBudget);
        var dirBudget = SumBy("DIRECT", i => i.TotalBudget);
        var totalBudget = indBudget + dirBudget;
        var actualInd = SumBy("INDIRECT", i => i.TotalActualCost);
        var actualDir = SumBy("DIRECT", i => i.TotalActualCost);
        var totalActual = actualInd + actualDir;
        var ctcInd = SumBy("INDIRECT", i => i.TotalRemaining);
        var ctcDir = SumBy("DIRECT", i => i.TotalRemaining);
        var totalCtc = ctcInd + ctcDir;
        var eacInd = actualInd + ctcInd;
        var eacDir = actualDir + ctcDir;
        var totalEac = eacInd + eacDir;
        var profit = revised - totalEac;
        var remainingContract = revised - progressAmount;

        return new CostControlSummaryDto(
            Math.Round(original, 2), Math.Round(revised, 2),
            Math.Round(progressAmount, 2), Math.Round(progressPct, 4),
            Math.Round(remainingContract, 2),
            Math.Round(indBudget, 2), Math.Round(dirBudget, 2), Math.Round(totalBudget, 2),
            Math.Round(actualInd, 2), Math.Round(actualDir, 2), Math.Round(totalActual, 2),
            Math.Round(ctcInd, 2), Math.Round(ctcDir, 2), Math.Round(totalCtc, 2),
            Math.Round(eacInd, 2), Math.Round(eacDir, 2), Math.Round(totalEac, 2),
            Math.Round(profit, 2));
    }

    private async Task<CostControlDto?> BuildDtoAsync(CostControl cc, CancellationToken ct)
    {
        var contract = await db.Contracts.AsNoTracking()
            .Include(c => c.Project)
            .FirstOrDefaultAsync(c => c.Id == cc.ContractId, ct);
        if (contract is null) return null;

        var revised = GetRevisedContractValue(contract);
        var original = contract.Amount < 0 ? 0 : contract.Amount;
        var (progressAmount, progressPct) = await GetProgressAsync(contract.Id, revised, ct);

        var items = await db.CostControlItems.AsNoTracking()
            .Where(i => i.CostControlId == cc.Id)
            .Include(i => i.SubItems)
            .OrderBy(i => i.DisplayOrder)
            .ToListAsync(ct);

        var itemDtos = items.Select(i => calc.MapItem(i, original, revised, progressAmount, progressPct)).ToList();
        var summary = BuildSummary(original, revised, progressAmount, progressPct, itemDtos);

        return new CostControlDto(
            cc.Id, cc.ContractId, contract.ProjectId, contract.Name, contract.Project?.Name,
            original, revised, progressAmount, progressPct,
            itemDtos, summary, cc.CreatedAt, cc.UpdatedAt);
    }

    private async Task EnsureDefaultItemsAsync(CostControl cc, CancellationToken ct)
    {
        var existing = await db.CostControlItems
            .Where(i => i.CostControlId == cc.Id)
            .ToListAsync(ct);

        // مزامنة أسماء البنود الأساسية الخمسة إن وُجدت (بدون إنشاء نسخ مكررة)
        foreach (var d in DefaultMainItems)
        {
            var match = existing.FirstOrDefault(i =>
                string.Equals((i.Code ?? "").Trim(), d.Code, StringComparison.OrdinalIgnoreCase));
            if (match is not null)
            {
                if (!string.Equals(match.Name, d.Name, StringComparison.Ordinal))
                    match.Name = d.Name;
                if (match.DisplayOrder != d.Order)
                    match.DisplayOrder = d.Order;
                if (!string.Equals(match.CostType, d.CostType, StringComparison.OrdinalIgnoreCase))
                    match.CostType = d.CostType;
            }
        }

        // إنشاء البنود الناقصة فقط (لا نعيد إنشاء الموجود)
        var missing = DefaultMainItems
            .Where(d => !existing.Any(i =>
                string.Equals((i.Code ?? "").Trim(), d.Code, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        if (missing.Count == 0)
        {
            if (db.ChangeTracker.HasChanges())
                await db.SaveChangesAsync(ct);
            return;
        }

        // Allocate a contiguous unique id block so pending (unsaved) rows never collide on PK.
        var start = await PeekNextIdAsync("CCI-", ct);
        for (var i = 0; i < missing.Count; i++)
        {
            var d = missing[i];
            db.CostControlItems.Add(new CostControlItem
            {
                Id = $"CCI-{start + i}",
                CostControlId = cc.Id,
                Name = d.Name,
                Code = d.Code,
                CostType = d.CostType,
                DisplayOrder = d.Order
            });
        }
        await db.SaveChangesAsync(ct);
    }


    /// <summary>
    /// Next sequential id for prefix. Includes both committed DB rows and pending
    /// entities in the change tracker so bulk inserts (e.g. default main items)
    /// never reuse the same primary key.
    /// </summary>
    private async Task<string> NextIdAsync(string prefix, CancellationToken ct = default)
    {
        var next = await PeekNextIdAsync(prefix, ct);
        return $"{prefix}{next}";
    }

    private async Task<int> PeekNextIdAsync(string prefix, CancellationToken ct = default)
    {
        var all = new List<string>();
        if (prefix == "CC-")
            all = await db.CostControls.AsNoTracking().Select(x => x.Id).Where(id => id.StartsWith(prefix)).ToListAsync(ct);
        else if (prefix == "CCI-")
            all = await db.CostControlItems.AsNoTracking().Select(x => x.Id).Where(id => id.StartsWith(prefix)).ToListAsync(ct);
        else if (prefix == "CCS-")
            all = await db.CostControlSubItems.AsNoTracking().Select(x => x.Id).Where(id => id.StartsWith(prefix)).ToListAsync(ct);

        // Pending (Added) entities in the current DbContext that are not yet saved
        if (prefix == "CC-")
            all.AddRange(db.ChangeTracker.Entries<CostControl>()
                .Where(e => e.State == EntityState.Added)
                .Select(e => e.Entity.Id)
                .Where(id => id.StartsWith(prefix)));
        else if (prefix == "CCI-")
            all.AddRange(db.ChangeTracker.Entries<CostControlItem>()
                .Where(e => e.State == EntityState.Added)
                .Select(e => e.Entity.Id)
                .Where(id => id.StartsWith(prefix)));
        else if (prefix == "CCS-")
            all.AddRange(db.ChangeTracker.Entries<CostControlSubItem>()
                .Where(e => e.State == EntityState.Added)
                .Select(e => e.Entity.Id)
                .Where(id => id.StartsWith(prefix)));

        return all.Select(id => int.TryParse(id.AsSpan(prefix.Length), out var n) ? n : 0)
            .DefaultIfEmpty(99).Max() + 1;
    }

    // ---------- endpoints ----------

    [HttpGet]
    [RequirePermission(PermissionModules.CostControl, PermissionActions.View)]
    public async Task<ActionResult<CostControlDto>> GetByContract([FromQuery] string contractId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(contractId))
            return BadRequest(new { success = false, message = "العقد مطلوب" });

        var contract = await db.Contracts.AsNoTracking().FirstOrDefaultAsync(c => c.Id == contractId, ct);
        if (contract is null)
            return NotFound(new { success = false, message = "العقد غير موجود" });

        var cc = await db.CostControls.FirstOrDefaultAsync(x => x.ContractId == contractId, ct);
        if (cc is null)
        {
            // Auto-create empty cost control with default main items when first opened
            cc = new CostControl
            {
                Id = await NextIdAsync("CC-"),
                ContractId = contractId,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            db.CostControls.Add(cc);
            await db.SaveChangesAsync(ct);
            await EnsureDefaultItemsAsync(cc, ct);
        }
        else
        {
            await EnsureDefaultItemsAsync(cc, ct);
        }

        var dto = await BuildDtoAsync(cc, ct);
        return dto is null ? NotFound() : Ok(dto);
    }

    [HttpGet("{id}")]
    [RequirePermission(PermissionModules.CostControl, PermissionActions.View)]
    public async Task<ActionResult<CostControlDto>> GetById(string id, CancellationToken ct)
    {
        var cc = await db.CostControls.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (cc is null) return NotFound();
        var dto = await BuildDtoAsync(cc, ct);
        return dto is null ? NotFound() : Ok(dto);
    }

    [HttpGet("{id}/summary")]
    [RequirePermission(PermissionModules.CostControl, PermissionActions.View)]
    public async Task<ActionResult<CostControlSummaryDto>> GetSummary(string id, CancellationToken ct)
    {
        var cc = await db.CostControls.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (cc is null) return NotFound();
        var dto = await BuildDtoAsync(cc, ct);
        return dto?.Summary is null ? NotFound() : Ok(dto.Summary);
    }

    [HttpPost]
    [RequirePermission(PermissionModules.CostControl, PermissionActions.Create)]
    public async Task<ActionResult<CostControlDto>> Create(CostControlCreateDto body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.ContractId))
            return BadRequest(new { success = false, message = "العقد مطلوب" });
        if (!await db.Contracts.AnyAsync(c => c.Id == body.ContractId, ct))
            return BadRequest(new { success = false, message = "العقد غير موجود" });
        if (await db.CostControls.AnyAsync(x => x.ContractId == body.ContractId, ct))
            return Conflict(new { success = false, message = "يوجد بالفعل سجل Cost Control لهذا العقد" });

        var cc = new CostControl
        {
            Id = await NextIdAsync("CC-"),
            ContractId = body.ContractId.Trim(),
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        db.CostControls.Add(cc);
        await db.SaveChangesAsync(ct);
        await EnsureDefaultItemsAsync(cc, ct);

        var dto = await BuildDtoAsync(cc, ct);
        return CreatedAtAction(nameof(GetById), new { id = cc.Id }, dto);
    }

    [HttpDelete("{id}")]
    [RequirePermission(PermissionModules.CostControl, PermissionActions.Delete)]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var cc = await db.CostControls.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (cc is null) return NotFound();
        db.CostControls.Remove(cc);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ----- Main Items -----

    [HttpPost("{costControlId}/items")]
    [RequirePermission(PermissionModules.CostControl, PermissionActions.Create)]
    public async Task<ActionResult<CostControlItemDto>> AddMainItem(string costControlId, CostControlItemWriteDto body, CancellationToken ct)
    {
        var cc = await db.CostControls.FirstOrDefaultAsync(x => x.Id == costControlId, ct);
        if (cc is null) return NotFound();

        var name = (body.Name ?? "").Trim();
        if (string.IsNullOrWhiteSpace(name))
            return BadRequest(new { success = false, message = "اسم البند الرئيسي مطلوب" });

        var costType = string.IsNullOrWhiteSpace(body.CostType) ? "INDIRECT" : body.CostType.Trim().ToUpperInvariant();
        if (costType is not ("INDIRECT" or "DIRECT"))
            return BadRequest(new { success = false, message = "CostType يجب أن يكون INDIRECT أو DIRECT" });

        var maxOrder = await db.CostControlItems.Where(i => i.CostControlId == costControlId)
            .Select(i => (int?)i.DisplayOrder).MaxAsync(ct) ?? 0;

        // كود مخصص للمستخدم — لا يُسمح باستخدام أكواد البنود الأساسية
        var code = (body.Code ?? "").Trim();
        if (string.IsNullOrWhiteSpace(code))
            code = $"USR-{maxOrder + 1}";
        if (DefaultMainItemCodes.Contains(code))
            return BadRequest(new { success = false, message = "لا يمكن استخدام كود بند أساسي افتراضي لبند مضاف يدوياً" });

        var item = new CostControlItem
        {
            Id = await NextIdAsync("CCI-"),
            CostControlId = costControlId,
            Name = name,
            Code = code,
            CostType = costType,
            DisplayOrder = body.DisplayOrder > 0 ? body.DisplayOrder : maxOrder + 1
        };
        db.CostControlItems.Add(item);
        cc.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var contract = await db.Contracts.AsNoTracking().FirstAsync(c => c.Id == cc.ContractId, ct);
        var revised = GetRevisedContractValue(contract);
        var original = contract.Amount < 0 ? 0 : contract.Amount;
        var (_, progressPct) = await GetProgressAsync(cc.ContractId, revised, ct);
        var (progressAmount, progressPct2) = await GetProgressAsync(cc.ContractId, revised, ct);
        return Ok(calc.MapItem(item, original, revised, progressAmount, progressPct2));
    }

    [HttpPut("items/{itemId}")]
    [RequirePermission(PermissionModules.CostControl, PermissionActions.Edit)]
    public async Task<IActionResult> UpdateMainItem(string itemId, CostControlItemWriteDto body, CancellationToken ct)
    {
        var item = await db.CostControlItems.FirstOrDefaultAsync(x => x.Id == itemId, ct);
        if (item is null) return NotFound();

        if (!string.IsNullOrWhiteSpace(body.Name))
            item.Name = body.Name.Trim();
        if (body.Code is not null)
            item.Code = body.Code.Trim();
        if (!string.IsNullOrWhiteSpace(body.CostType))
        {
            var ctType = body.CostType.Trim().ToUpperInvariant();
            if (ctType is not ("INDIRECT" or "DIRECT"))
                return BadRequest(new { success = false, message = "CostType يجب أن يكون INDIRECT أو DIRECT" });
            item.CostType = ctType;
        }
        if (body.DisplayOrder > 0)
            item.DisplayOrder = body.DisplayOrder;

        var cc = await db.CostControls.FirstAsync(x => x.Id == item.CostControlId, ct);
        cc.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("items/{itemId}")]
    [RequirePermission(PermissionModules.CostControl, PermissionActions.Delete)]
    public async Task<IActionResult> DeleteMainItem(string itemId, CancellationToken ct)
    {
        var item = await db.CostControlItems
            .Include(i => i.SubItems)
            .FirstOrDefaultAsync(x => x.Id == itemId, ct);
        if (item is null) return NotFound();

        // حماية البنود الأساسية الخمسة من الحذف
        if (IsDefaultMainItem(item))
            return BadRequest(new { success = false, message = "لا يمكن حذف البنود الأساسية الافتراضية" });

        var ccId = item.CostControlId;
        // حذف البنود الفرعية المرتبطة أولاً لتجنب orphaned records
        if (item.SubItems is { Count: > 0 })
            db.CostControlSubItems.RemoveRange(item.SubItems);
        db.CostControlItems.Remove(item);
        var cc = await db.CostControls.FirstOrDefaultAsync(x => x.Id == ccId, ct);
        if (cc is not null) cc.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ----- Sub Items -----

    [HttpPost("items/{itemId}/sub-items")]
    [RequirePermission(PermissionModules.CostControl, PermissionActions.Create)]
    public async Task<ActionResult<CostControlSubItemDto>> AddSubItem(string itemId, CostControlSubItemWriteDto body, CancellationToken ct)
    {
        var item = await db.CostControlItems.Include(i => i.CostControl)
            .FirstOrDefaultAsync(x => x.Id == itemId, ct);
        if (item is null) return NotFound();

        var desc = (body.Description ?? "").Trim();
        if (string.IsNullOrWhiteSpace(desc))
            return BadRequest(new { success = false, message = "وصف البند مطلوب" });

        var study = body.StudyValue < 0 ? 0 : body.StudyValue;
        var actual = body.ActualCost < 0 ? 0 : body.ActualCost;

        var maxOrder = await db.CostControlSubItems.Where(s => s.CostControlItemId == itemId)
            .Select(s => (int?)s.DisplayOrder).MaxAsync(ct) ?? 0;

        var sub = new CostControlSubItem
        {
            Id = await NextIdAsync("CCS-"),
            CostControlItemId = itemId,
            Description = desc,
            StudyValue = study,
            ActualCost = actual,
            DisplayOrder = body.DisplayOrder > 0 ? body.DisplayOrder : maxOrder + 1,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        db.CostControlSubItems.Add(sub);
        item.CostControl.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var contract = await db.Contracts.AsNoTracking().FirstAsync(c => c.Id == item.CostControl.ContractId, ct);
        var revised = GetRevisedContractValue(contract);
        var original = contract.Amount < 0 ? 0 : contract.Amount;
        var (progressAmount, progressPct) = await GetProgressAsync(item.CostControl.ContractId, revised, ct);
        return Ok(calc.MapSubItem(sub, original, revised, progressAmount, progressPct));
    }

    [HttpPut("sub-items/{subItemId}")]
    [RequirePermission(PermissionModules.CostControl, PermissionActions.Edit)]
    public async Task<ActionResult<CostControlSubItemDto>> UpdateSubItem(string subItemId, CostControlSubItemWriteDto body, CancellationToken ct)
    {
        var sub = await db.CostControlSubItems
            .Include(s => s.CostControlItem).ThenInclude(i => i.CostControl)
            .FirstOrDefaultAsync(x => x.Id == subItemId, ct);
        if (sub is null) return NotFound();

        if (!string.IsNullOrWhiteSpace(body.Description))
            sub.Description = body.Description.Trim();
        if (body.StudyValue >= 0)
            sub.StudyValue = body.StudyValue;
        if (body.ActualCost >= 0)
            sub.ActualCost = body.ActualCost;
        if (body.DisplayOrder > 0)
            sub.DisplayOrder = body.DisplayOrder;
        sub.UpdatedAt = DateTime.UtcNow;
        sub.CostControlItem.CostControl.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var contract = await db.Contracts.AsNoTracking()
            .FirstAsync(c => c.Id == sub.CostControlItem.CostControl.ContractId, ct);
        var revised = GetRevisedContractValue(contract);
        var original = contract.Amount < 0 ? 0 : contract.Amount;
        var (progressAmount, progressPct) = await GetProgressAsync(sub.CostControlItem.CostControl.ContractId, revised, ct);
        return Ok(calc.MapSubItem(sub, original, revised, progressAmount, progressPct));
    }

    [HttpDelete("sub-items/{subItemId}")]
    [RequirePermission(PermissionModules.CostControl, PermissionActions.Delete)]
    public async Task<IActionResult> DeleteSubItem(string subItemId, CancellationToken ct)
    {
        var sub = await db.CostControlSubItems
            .Include(s => s.CostControlItem).ThenInclude(i => i.CostControl)
            .FirstOrDefaultAsync(x => x.Id == subItemId, ct);
        if (sub is null) return NotFound();
        sub.CostControlItem.CostControl.UpdatedAt = DateTime.UtcNow;
        db.CostControlSubItems.Remove(sub);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
}
