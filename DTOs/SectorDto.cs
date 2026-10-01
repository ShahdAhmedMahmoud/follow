namespace InvoicesErp.DTOs;

public class SectorDto
{
    public int SectorId { get; set; }

    public string Name { get; set; } = "";

    public string? Code { get; set; }

    public bool IsActive { get; set; }

    public int? SectorManagerId { get; set; }

    public string? SectorManagerName { get; set; }

    public int ProjectsCount { get; set; }
}