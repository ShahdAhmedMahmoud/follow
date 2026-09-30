namespace InvoicesErp.Models;

public class SocialInsurancePayment
{
    public string InvoiceId { get; set; } = "";
    public string ContractId { get; set; } = "";
    public decimal Amount { get; set; }
    public decimal PaidAmount { get; set; }
    public string Status { get; set; } = "غير مسدد";
    public DateOnly? PaymentDate { get; set; }
    public string? Reference { get; set; }
    public string? Notes { get; set; }
    public Invoice Invoice { get; set; } = null!;
    public Contract Contract { get; set; } = null!;
}
