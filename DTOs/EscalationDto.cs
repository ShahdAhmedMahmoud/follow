namespace InvoicesErp.DTOs;

public record EscalationDto(
    string? InvoiceDeductionId,
    string? ResponseStatus,
    DateOnly? ResponseDate,
    decimal ReturnedAmount);
