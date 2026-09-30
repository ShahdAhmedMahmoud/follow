namespace InvoicesErp.DTOs;

public record CostControlItemDto(
    string? Id,
    string? CostControlId,
    string? Name,
    string? Code,
    string? CostType,
    int DisplayOrder,
    List<CostControlSubItemDto>? SubItems,
    // Aggregates
    decimal TotalStudyValue,
    decimal TotalActualCost,
    decimal TotalBudget,
    decimal TotalBudgetToDate,
    decimal TotalRemaining);
