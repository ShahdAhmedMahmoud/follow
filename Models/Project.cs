namespace InvoicesErp.Models;

public class Project
{
    public string Id { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string Name { get; set; } = "";
    public DateOnly? StartDate { get; set; }
    public string? Status { get; set; }
    /// <summary>Optional: user ID of the sector manager responsible for this project.</summary>
    public string? SectorManagerId { get; set; }
    public Owner Owner { get; set; } = null!;
    public SectorManager? SectorManager { get; set; }
    public ICollection<Contract> Contracts { get; set; } = new List<Contract>();
}
