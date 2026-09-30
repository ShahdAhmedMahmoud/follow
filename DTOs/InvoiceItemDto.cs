namespace InvoicesErp.DTOs;

public record InvoiceItemDto(
    string? Id,
    string? Description,
    decimal Qty,
    decimal Rate,
    decimal Total,
    decimal CurrentTotal);
