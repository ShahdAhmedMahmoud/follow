namespace InvoicesErp.DTOs;

public record ExecPositionDto(
    string? Id,
    string? ContractId,
    int VersionNumber,
    DateOnly? Date,
    string? User,
    decimal WorkVolume,
    decimal VariationOrders,
    decimal Materials,
    decimal Claims,
    decimal Vat,
    decimal TotalAmount);
