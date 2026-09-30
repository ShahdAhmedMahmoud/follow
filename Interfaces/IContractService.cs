using InvoicesErp.DTOs;

namespace InvoicesErp.Interfaces;

public interface IContractService
{
    Task<object> ListAsync(string? projectId, int? page, int? pageSize, string? search, string? sortBy, string? sortDirection, CancellationToken ct);
    Task<ContractDto?> GetByIdAsync(string id, CancellationToken ct);
    Task<ContractDto> CreateAsync(ContractDto dto, CancellationToken ct);
    Task<(bool ok, string? error)> UpdateAsync(string id, ContractDto dto, CancellationToken ct);
    Task<bool> DeleteAsync(string id, CancellationToken ct);
}
