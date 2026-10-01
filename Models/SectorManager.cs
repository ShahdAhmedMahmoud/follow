namespace InvoicesErp.Models;

public class SectorManager
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Sector { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Notes { get; set; }
    public string Status { get; set; } = "Active";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Project> Projects { get; set; } = new List<Project>();
}
