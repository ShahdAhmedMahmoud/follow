namespace InvoicesErp.DTOs;

public record ProjectDto(
    string? Id,
    string? OwnerId,
    string? Name,
  SectorManagerDto? SectorManager,
    DateOnly? StartDate,
    string? Status);
