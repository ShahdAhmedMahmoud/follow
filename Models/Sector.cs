namespace InvoicesErp.Models;

public class Sector
{
    public int SectorId { get; set; }

    public string Name { get; set; } = "";

    public string? Code { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public SectorManager? SectorManager { get; set; }

    public ICollection<Project> Projects { get; set; }
        = new List<Project>();
}