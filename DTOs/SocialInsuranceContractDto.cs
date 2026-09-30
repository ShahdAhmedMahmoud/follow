namespace InvoicesErp.DTOs;

public record SocialInsuranceContractDto(
    string? ContractId,
    string? TranslationStatus,
    string? BoqStatus,
    string? FileStatus,
    string? FileNumber,
    decimal FileRate,
    string? ObjectionStatus,
    DateOnly? ObjectionDate,
    DateOnly? OpeningDate,
    string? Notes);
