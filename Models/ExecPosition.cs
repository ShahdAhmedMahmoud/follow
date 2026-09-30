namespace InvoicesErp.Models;

public class ExecPosition
{
    public string Id { get; set; } = "";
    public string ContractId { get; set; } = "";
    public int VersionNumber { get; set; }
    public DateOnly? Date { get; set; }
    public string? User { get; set; }
    public decimal WorkVolume { get; set; }
    public decimal VariationOrders { get; set; }
    public decimal Materials { get; set; }
    public decimal Claims { get; set; }
    public decimal Vat { get; set; }
    public decimal TotalAmount { get; set; }
    public Contract Contract { get; set; } = null!;
}
