namespace InvoicesErp.Models;

public class CostControlSubItem
{
    public string Id { get; set; } = "";
    public string CostControlItemId { get; set; } = "";
    public string Description { get; set; } = "";
    public decimal StudyValue { get; set; }
    public decimal ActualCost { get; set; }
    public int DisplayOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public CostControlItem CostControlItem { get; set; } = null!;
}
