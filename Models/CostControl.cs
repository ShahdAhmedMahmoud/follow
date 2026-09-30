namespace InvoicesErp.Models;

public class CostControl
{
    public string Id { get; set; } = "";
    public string ContractId { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public Contract Contract { get; set; } = null!;
    public ICollection<CostControlItem> Items { get; set; } = new List<CostControlItem>();
}

/// <summary>
/// Main cost group (e.g. Indirect 1–4, Direct 5). CostType = INDIRECT | DIRECT.
/// </summary>
