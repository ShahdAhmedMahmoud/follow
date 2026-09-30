namespace InvoicesErp.Models;

public class Owner
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public ICollection<Project> Projects { get; set; } = new List<Project>();
}
