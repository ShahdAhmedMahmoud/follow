namespace InvoicesErp.DTOs;

public record CostControlDto(
    string? Id,
    string? ContractId,
    string? ProjectId,
    string? ContractName,
    string? ProjectName,
    decimal OriginalContractValue,
    decimal RevisedContractValue,
    decimal ProgressAmount,
    decimal ProgressPercentage,
    List<CostControlItemDto>? Items,
    CostControlSummaryDto? Summary,
    DateTime? CreatedAt,
    DateTime? UpdatedAt);
