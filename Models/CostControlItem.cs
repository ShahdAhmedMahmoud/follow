namespace InvoicesErp.Models;

public class CostControlItem
{
    public string Id { get; set; } = "";
    public string CostControlId { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Code { get; set; }
    /// <summary>INDIRECT or DIRECT</summary>
    public string CostType { get; set; } = "INDIRECT";
    public int DisplayOrder { get; set; }
    public CostControl CostControl { get; set; } = null!;
    public ICollection<CostControlSubItem> SubItems { get; set; } = new List<CostControlSubItem>();
}

/// <summary>
/// Sub item under a main cost group. StudyValue and ActualCost are user input;
/// percentages/budgets/remaining are calculated from Contract + Progress.
/// </summary>
