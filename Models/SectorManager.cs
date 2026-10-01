namespace InvoicesErp.Models;

public class SectorManager
{
    public int SectorManagerId { get; set; }

    public string FullName { get; set; } = "";

    public string? Email { get; set; }

    public string? Phone { get; set; }

    public int SectorId { get; set; }

    public Sector Sector { get; set; } = null!;

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}