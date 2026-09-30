namespace InvoicesErp.DTOs;

public record InvoiceDeductionDto(
    string? Id,
    string? Description,
    string? CalcType,
    decimal Val,
    decimal Amount,
    bool IsRefundable,
    string[]? CalcFromKeys);
