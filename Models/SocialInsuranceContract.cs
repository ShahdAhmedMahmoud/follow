namespace InvoicesErp.Models;

public class SocialInsuranceContract
{
    public string ContractId { get; set; } = "";
    public string TranslationStatus { get; set; } = "غير مطلوبة";
    public string BoqStatus { get; set; } = "غير مطلوبة";
    public string FileStatus { get; set; } = "غير مكتمل";
    public string? FileNumber { get; set; }
    public decimal FileRate { get; set; }
    public string ObjectionStatus { get; set; } = "لا يوجد";
    public DateOnly? ObjectionDate { get; set; }
    public DateOnly? OpeningDate { get; set; }
    public string? Notes { get; set; }
    public Contract Contract { get; set; } = null!;
}
