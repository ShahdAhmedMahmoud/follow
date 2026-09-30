namespace InvoicesErp.Auth;

public static class PermissionModules
{
    public const string Dashboard = "dashboard";
    public const string Owners = "owners";
    public const string Projects = "projects";
    public const string Contracts = "contracts";
    public const string Invoices = "invoices";
    public const string ExecPosition = "execPosition";
    public const string Escalations = "escalations";
    public const string SocialInsurance = "socialInsurance";
    public const string Reports = "reports";
    public const string ImportExport = "importExport";
    public const string Accounts = "accounts";
    public const string CostControl = "costControl";

    public static readonly string[] All =
    [
        Dashboard, Owners, Projects, Contracts, Invoices,
        ExecPosition, Escalations, SocialInsurance, Reports,
        ImportExport, Accounts, CostControl
    ];
}
