namespace InvoicesErp.Models;

public class EscalationResponse
{
    public string Id { get; set; } = "";
    public string InvoiceDeductionId { get; set; } = "";
    public string ResponseStatus { get; set; } = "لم يتم الرد";
    public DateOnly? ResponseDate { get; set; }
    public decimal ReturnedAmount { get; set; }
    public InvoiceDeduction InvoiceDeduction { get; set; } = null!;
}
