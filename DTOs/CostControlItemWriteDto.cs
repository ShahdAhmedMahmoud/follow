namespace InvoicesErp.DTOs;

public record CostControlItemWriteDto(
    string? Id,
    string? Name,
    string? Code,
    string? CostType,
    int DisplayOrder);
