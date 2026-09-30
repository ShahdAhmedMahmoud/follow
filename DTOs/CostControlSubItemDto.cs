namespace InvoicesErp.DTOs;

public record CostControlSubItemDto(
    string? Id,
    string? CostControlItemId,
    string? Description,
    decimal StudyValue,
    decimal ActualCost,
    int DisplayOrder,
    // Calculated (read-only from API perspective)
    decimal StudyPercentage,
    decimal BudgetToDate,
    decimal TotalBudget,
    decimal Remaining);
