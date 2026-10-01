namespace InvoicesErp.DTOs;

public record SectorManagerDto(
    string? Id,
    string Name,
    string? Sector,
    string? Phone = null,
    string? Email = null,
    string? Notes = null,
    string Status = "Active",
    int ProjectsCount = 0);
