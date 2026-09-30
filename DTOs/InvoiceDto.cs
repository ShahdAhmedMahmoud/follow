namespace InvoicesErp.DTOs;

public record InvoiceDto(
    string? Id,
    string? ContractId,
    string? Number,
    DateOnly? Date,
    DateOnly? DueDate,
    string? Status,
    string? PaymentStatus,
    decimal PaidAmount,
    DateOnly? PaymentDate,
    decimal WorkVolume,
    decimal VariationOrders,
    decimal Materials,
    decimal Claims,
    decimal Vat,
    List<InvoiceItemDto>? Items,
    List<InvoiceDeductionDto>? Deductions);
