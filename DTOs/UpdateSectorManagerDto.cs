namespace InvoicesErp.DTOs;

public class UpdateSectorManagerDto
{
    public string FullName { get; set; } = "";

    public string? Email { get; set; }

    public string? Phone { get; set; }

    public int SectorId { get; set; }

    public bool IsActive { get; set; }
}