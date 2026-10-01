namespace InvoicesErp.DTOs;

public class BootstrapDto
{
    public List<OwnerDto>? Owners { get; set; } = [];
    public List<ProjectDto>? Projects { get; set; } = [];
    public List<ContractDto>? Contracts { get; set; } = [];
    public List<InvoiceDto>? Invoices { get; set; } = [];
    public List<ExecPositionDto>? ExecPositions { get; set; } = [];
    public List<SocialInsuranceContractDto>? SocialInsuranceContracts { get; set; } = [];
    public List<SocialInsurancePaymentDto>? SocialInsurancePayments { get; set; } = [];
    public List<EscalationDto>? Escalations { get; set; } = [];
    public List<DeductionLibraryDto>? DeductionLibrary { get; set; } = [];
    public List<SectorManagerDto>? SectorManagers { get; set; } = [];
}
// ===== Contract Cost Control DTOs =====
