using InvoicesErp.DTOs;

namespace InvoicesErp.Interfaces;

public interface IInvoiceService
{
    Task<object> ListAsync(
        string? contractId, string? status, string? paymentStatus,
        DateOnly? from, DateOnly? to,
        int? page, int? pageSize, string? search, string? sortBy, string? sortDirection,
        CancellationToken ct);

    Task<InvoiceDto?> GetByIdAsync(string id, CancellationToken ct);
    Task<(InvoiceDto? dto, string? error)> CreateAsync(InvoiceDto dto, CancellationToken ct);
    Task<(bool ok, string? error)> UpdateAsync(string id, InvoiceDto dto, CancellationToken ct);
    Task<bool> DeleteAsync(string id, CancellationToken ct);
    Task<bool> ApproveAsync(string id, CancellationToken ct);
}
