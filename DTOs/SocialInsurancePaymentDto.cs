namespace InvoicesErp.DTOs;

public record SocialInsurancePaymentDto(
    string? InvoiceId,
    string? ContractId,
    decimal Amount,
    decimal PaidAmount,
    string? Status,
    DateOnly? PaymentDate,
    string? Reference,
    string? Notes);
