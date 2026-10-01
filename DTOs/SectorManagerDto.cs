namespace InvoicesErp.DTOs;

public class SectorManagerDto
{
    public int SectorManagerId { get; set; }

    public string FullName { get; set; } = "";

    public string? Email { get; set; }

    public string? Phone { get; set; }

    public int SectorId { get; set; }

    public string SectorName { get; set; } = "";

    public bool IsActive { get; set; }
}