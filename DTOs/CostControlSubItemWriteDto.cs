namespace InvoicesErp.DTOs;

public record CostControlSubItemWriteDto(
    string? Id,
    string? Description,
    decimal StudyValue,
    decimal ActualCost,
    int DisplayOrder);
