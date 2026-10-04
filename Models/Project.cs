namespace InvoicesErp.Models;

public class Project
{
    public string Id { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string Name { get; set; } = "";
    public DateOnly? StartDate { get; set; }
    public string? Status { get; set; }
    public Owner Owner { get; set; } = null!;

    /// <summary>Sector this project belongs to (derived from SectorManager when assigned).</summary>
    public int? SectorId { get; set; }
    public Sector? Sector { get; set; }

    /// <summary>Sector manager responsible for this project; must belong to the same Sector.</summary>
    public int? SectorManagerId { get; set; }
    public SectorManager? SectorManager { get; set; }

    public ICollection<Contract> Contracts { get; set; } = new List<Contract>();
}
