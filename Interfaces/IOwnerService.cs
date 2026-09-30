using InvoicesErp.Common;
using InvoicesErp.DTOs;

namespace InvoicesErp.Interfaces;

public interface IOwnerService
{
    Task<object> ListAsync(int? page, int? pageSize, string? search, string? sortBy, string? sortDirection, CancellationToken ct);
    Task<OwnerDto?> GetByIdAsync(string id, CancellationToken ct);
    Task<OwnerDto> CreateAsync(OwnerDto dto, CancellationToken ct);
    Task<bool> UpdateAsync(string id, OwnerDto dto, CancellationToken ct);
    Task<bool> DeleteAsync(string id, CancellationToken ct);
}
