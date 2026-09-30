namespace InvoicesErp.Models;

public class InvoiceItem
{
    public string Id { get; set; } = "";
    public string InvoiceId { get; set; } = "";
    public string Description { get; set; } = "";
    public decimal Qty { get; set; }
    public decimal Rate { get; set; }
    public decimal Total { get; set; }
    public decimal CurrentTotal { get; set; }
    public Invoice Invoice { get; set; } = null!;
}
