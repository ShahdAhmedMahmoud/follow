namespace InvoicesErp.Models;

public class InvoiceDeduction
{
    public string Id { get; set; } = "";
    public string InvoiceId { get; set; } = "";
    public string Description { get; set; } = "";
    public string? CalcType { get; set; }
    public decimal Val { get; set; }
    public decimal Amount { get; set; }
    public bool IsRefundable { get; set; }
    public string? CalcFromKeysJson { get; set; }
    public Invoice Invoice { get; set; } = null!;
}
