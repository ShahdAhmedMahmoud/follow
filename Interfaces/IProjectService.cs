using InvoicesErp.DTOs;

namespace InvoicesErp.Interfaces;

public interface IProjectService
{
    Task<object> ListAsync(string? ownerId, int? page, int? pageSize, string? search, string? sortBy, string? sortDirection, CancellationToken ct);
    Task<ProjectDto?> GetByIdAsync(string id, CancellationToken ct);
    Task<ProjectDto> CreateAsync(ProjectDto dto, CancellationToken ct);
    Task<bool> UpdateAsync(string id, ProjectDto dto, CancellationToken ct);
    Task<bool> DeleteAsync(string id, CancellationToken ct);
}
