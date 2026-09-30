namespace InvoicesErp.DTOs;

public record CostControlSummaryDto(
    decimal OriginalContractValue,
    decimal RevisedContractValue,
    decimal ProgressAmount,
    decimal ProgressPercentage,
    decimal RemainingContractValue,
    decimal TotalIndirectBudget,
    decimal TotalDirectBudget,
    decimal TotalBudget,
    decimal ActualIndirect,
    decimal ActualDirect,
    decimal TotalActualCost,
    decimal CtcIndirect,
    decimal CtcDirect,
    decimal TotalCtc,
    decimal EacIndirect,
    decimal EacDirect,
    decimal TotalEac,
    decimal Profit);
