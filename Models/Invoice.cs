namespace InvoicesErp.Models;

public class Invoice
{
    public string Id { get; set; } = "";
    public string ContractId { get; set; } = "";
    public string Number { get; set; } = "";
    public DateOnly? Date { get; set; }
    public DateOnly? DueDate { get; set; }
    public string? Status { get; set; }
    public string? PaymentStatus { get; set; }
    public decimal PaidAmount { get; set; }
    public DateOnly? PaymentDate { get; set; }
    public decimal WorkVolume { get; set; }
    public decimal VariationOrders { get; set; }
    public decimal Materials { get; set; }
    public decimal Claims { get; set; }
    public decimal Vat { get; set; }
    public Contract Contract { get; set; } = null!;
    public ICollection<InvoiceItem> Items { get; set; } = new List<InvoiceItem>();
    public ICollection<InvoiceDeduction> Deductions { get; set; } = new List<InvoiceDeduction>();
    public SocialInsurancePayment? SocialInsurancePayment { get; set; }
}
