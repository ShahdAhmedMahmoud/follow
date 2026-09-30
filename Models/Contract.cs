namespace InvoicesErp.Models;

public class Contract
{
    public string Id { get; set; } = "";
    public string ProjectId { get; set; } = "";
    public string Name { get; set; } = "";
    public decimal Amount { get; set; }
    /// <summary>قيمة العقد المعدل / حصر البنود</summary>
    public decimal ModifiedAmount { get; set; }
    public decimal VoAmount { get; set; }
    public decimal ClaimsAmount { get; set; }
    public decimal VatAmount { get; set; }
    public int PaymentTerms { get; set; }
    public DateOnly? SignDate { get; set; }
    public string? Status { get; set; }
    public Project Project { get; set; } = null!;
    public ICollection<Invoice> Invoices { get; set; } = new List<Invoice>();
    public ICollection<ExecPosition> ExecPositions { get; set; } = new List<ExecPosition>();
    public CostControl? CostControl { get; set; }
    public SocialInsuranceContract? SocialInsurance { get; set; }
}

