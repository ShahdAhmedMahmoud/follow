namespace InvoicesErp.DTOs;

public class CreateSectorManagerDto
{
    public string FullName { get; set; } = "";

    public string? Email { get; set; }

    public string? Phone { get; set; }

    public int SectorId { get; set; }
}