namespace InvoicesErp.Models;

public class Project
{
    public string Id { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string Name { get; set; } = "";
    public DateOnly? StartDate { get; set; }
    public string? Status { get; set; }
    public Owner Owner { get; set; } = null!;
    public ICollection<Contract> Contracts { get; set; } = new List<Contract>();
}
