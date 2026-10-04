namespace InvoicesErp.DTOs;

public record ContractDto(
    string? Id,
    string? ProjectId,
    string? Name,
    decimal Amount,
    decimal ModifiedAmount,
    decimal VoAmount,
    decimal ClaimsAmount,
    decimal VatAmount,
    int PaymentTerms,
    DateOnly? SignDate,
    string? Status,
    int ContractDuration,
    DateOnly? EndDate); // <--- تأكد إنها موجودة هنا في النهاية (الباراميتر رقم 13)