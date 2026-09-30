using InvoicesErp.Common;
using InvoicesErp.Data;
using InvoicesErp.DTOs;
using InvoicesErp.Interfaces;
using InvoicesErp.Models;
using Microsoft.EntityFrameworkCore;

namespace InvoicesErp.Services;

public sealed class OwnerService(AppDbContext db) : IOwnerService
{
    public async Task<object> ListAsync(int? page, int? pageSize, string? search, string? sortBy, string? sortDirection, CancellationToken ct)
    {
        var q = db.Owners.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(x => x.Name.Contains(s) || (x.Phone != null && x.Phone.Contains(s)) || (x.Email != null && x.Email.Contains(s)));
        }
        var desc = string.Equals(sortDirection, "desc", StringComparison.OrdinalIgnoreCase);
        q = (sortBy?.ToLowerInvariant()) switch
        {
            "email" => desc ? q.OrderByDescending(x => x.Email) : q.OrderBy(x => x.Email),
            "phone" => desc ? q.OrderByDescending(x => x.Phone) : q.OrderBy(x => x.Phone),
            _ => desc ? q.OrderByDescending(x => x.Name) : q.OrderBy(x => x.Name)
        };
        var projected = q.Select(x => new OwnerDto(x.Id, x.Name, x.Phone, x.Email));
        if (page is null)
            return await projected.ToListAsync(ct);
        return await projected.ToPagedAsync(page.Value, pageSize ?? 25, ct);
    }

    public async Task<OwnerDto?> GetByIdAsync(string id, CancellationToken ct)
    {
        var x = await db.Owners.AsNoTracking().FirstOrDefaultAsync(o => o.Id == id, ct);
        return x is null ? null : new OwnerDto(x.Id, x.Name, x.Phone, x.Email);
    }

    public async Task<OwnerDto> CreateAsync(OwnerDto dto, CancellationToken ct)
    {
        var x = new Owner
        {
            Id = await GenerateOwnerIdAsync(ct),
            Name = (dto.Name ?? "").Trim(),
            Phone = dto.Phone,
            Email = dto.Email
        };
        db.Owners.Add(x);
        await db.SaveChangesAsync(ct);
        return new OwnerDto(x.Id, x.Name, x.Phone, x.Email);
    }

    public async Task<bool> UpdateAsync(string id, OwnerDto dto, CancellationToken ct)
    {
        var x = await db.Owners.FindAsync([id], ct);
        if (x is null) return false;
        x.Name = (dto.Name ?? "").Trim();
        x.Phone = dto.Phone;
        x.Email = dto.Email;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> DeleteAsync(string id, CancellationToken ct)
    {
        var x = await db.Owners.FindAsync([id], ct);
        if (x is null) return false;

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var projectIds = await db.Projects.Where(p => p.OwnerId == id).Select(p => p.Id).ToListAsync(ct);
        if (projectIds.Count > 0)
        {
            var contractIds = await db.Contracts.Where(c => projectIds.Contains(c.ProjectId)).Select(c => c.Id).ToListAsync(ct);
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
            await db.Projects.Where(p => projectIds.Contains(p.Id)).ExecuteDeleteAsync(ct);
        }

        db.Owners.Remove(x);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return true;
    }

    private async Task<string> GenerateOwnerIdAsync(CancellationToken ct)
    {
        var max = await db.Owners.AsNoTracking()
            .Select(o => o.Id)
            .Where(id => id.StartsWith("O-"))
            .ToListAsync(ct);
        var next = max
            .Select(id => int.TryParse(id.AsSpan(2), out var n) ? n : 0)
            .DefaultIfEmpty(99)
            .Max() + 1;
        return $"O-{next}";
    }
}
