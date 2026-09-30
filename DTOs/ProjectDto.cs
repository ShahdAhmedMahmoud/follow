namespace InvoicesErp.DTOs;

public record ProjectDto(
    string? Id,
    string? OwnerId,
    string? Name,
    DateOnly? StartDate,
    string? Status);
