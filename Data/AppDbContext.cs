using Microsoft.EntityFrameworkCore;
using InvoicesErp.Models;

namespace InvoicesErp.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Owner> Owners => Set<Owner>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Contract> Contracts => Set<Contract>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<InvoiceItem> InvoiceItems => Set<InvoiceItem>();
    public DbSet<InvoiceDeduction> InvoiceDeductions => Set<InvoiceDeduction>();
    public DbSet<ExecPosition> ExecPositions => Set<ExecPosition>();
    public DbSet<SocialInsuranceContract> SocialInsuranceContracts => Set<SocialInsuranceContract>();
    public DbSet<SocialInsurancePayment> SocialInsurancePayments => Set<SocialInsurancePayment>();
    public DbSet<EscalationResponse> EscalationResponses => Set<EscalationResponse>();
    public DbSet<DeductionLibraryItem> DeductionLibraryItems => Set<DeductionLibraryItem>();
    public DbSet<AppUserRecord> AppUsers => Set<AppUserRecord>();
    public DbSet<CostControl> CostControls => Set<CostControl>();
    public DbSet<CostControlItem> CostControlItems => Set<CostControlItem>();
    public DbSet<CostControlSubItem> CostControlSubItems => Set<CostControlSubItem>();
    public DbSet<SectorManager> SectorManagers => Set<SectorManager>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        const int IdLen = 64;

        // Dates without time
        b.Entity<Project>().Property(x => x.StartDate).HasColumnType("date");
        b.Entity<Contract>().Property(x => x.SignDate).HasColumnType("date");
        b.Entity<Invoice>().Property(x => x.Date).HasColumnType("date");
        b.Entity<Invoice>().Property(x => x.DueDate).HasColumnType("date");
        b.Entity<Invoice>().Property(x => x.PaymentDate).HasColumnType("date");
        b.Entity<ExecPosition>().Property(x => x.Date).HasColumnType("date");
        b.Entity<SocialInsuranceContract>().Property(x => x.ObjectionDate).HasColumnType("date");
        b.Entity<SocialInsuranceContract>().Property(x => x.OpeningDate).HasColumnType("date");
        b.Entity<SocialInsurancePayment>().Property(x => x.PaymentDate).HasColumnType("date");
        b.Entity<EscalationResponse>().Property(x => x.ResponseDate).HasColumnType("date");

        b.Entity<SectorManager>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.Name).HasMaxLength(250).IsRequired();
            e.Property(x => x.Sector).HasMaxLength(250);
            e.Property(x => x.Phone).HasMaxLength(50);
            e.Property(x => x.Email).HasMaxLength(150);
            e.Property(x => x.Notes).HasMaxLength(500);
            e.Property(x => x.Status).HasMaxLength(50);
            e.HasIndex(x => x.Name);
        });

        b.Entity<Owner>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.Name).HasMaxLength(250).IsRequired();
            e.HasIndex(x => x.Name);
        });

        b.Entity<Project>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.OwnerId).HasMaxLength(IdLen).IsRequired();
            e.Property(x => x.Name).HasMaxLength(300).IsRequired();
            e.Property(x => x.SectorManagerId).HasMaxLength(IdLen);
            e.HasOne(x => x.Owner).WithMany(x => x.Projects).HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.SectorManager).WithMany(x => x.Projects).HasForeignKey(x => x.SectorManagerId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => x.OwnerId);
            e.HasIndex(x => x.SectorManagerId);
        });

        b.Entity<Contract>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.ProjectId).HasMaxLength(IdLen).IsRequired();
            e.Property(x => x.Name).HasMaxLength(300).IsRequired();
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.Property(x => x.ModifiedAmount).HasPrecision(18, 2);
            e.Property(x => x.VoAmount).HasPrecision(18, 2);
            e.Property(x => x.ClaimsAmount).HasPrecision(18, 2);
            e.Property(x => x.VatAmount).HasPrecision(18, 2);
            e.HasOne(x => x.Project).WithMany(x => x.Contracts).HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.ProjectId);
        });

        b.Entity<Invoice>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.ContractId).HasMaxLength(IdLen).IsRequired();
            e.Property(x => x.Number).HasMaxLength(100).IsRequired();
            e.HasIndex(x => new { x.ContractId, x.Number }).IsUnique();
            foreach (var p in new[] { nameof(Invoice.WorkVolume), nameof(Invoice.VariationOrders), nameof(Invoice.Materials), nameof(Invoice.Claims), nameof(Invoice.Vat), nameof(Invoice.PaidAmount) })
                e.Property(p).HasPrecision(18, 2);
            e.HasOne(x => x.Contract).WithMany(x => x.Invoices).HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<InvoiceItem>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.InvoiceId).HasMaxLength(IdLen).IsRequired();
            foreach (var p in new[] { nameof(InvoiceItem.Qty), nameof(InvoiceItem.Rate), nameof(InvoiceItem.Total), nameof(InvoiceItem.CurrentTotal) })
                e.Property(p).HasPrecision(18, 2);
            e.HasOne(x => x.Invoice).WithMany(x => x.Items).HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => x.InvoiceId);
        });

        b.Entity<InvoiceDeduction>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.InvoiceId).HasMaxLength(IdLen).IsRequired();
            e.Property(x => x.Val).HasPrecision(18, 2);
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.HasOne(x => x.Invoice).WithMany(x => x.Deductions).HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => x.InvoiceId);
        });

        b.Entity<ExecPosition>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.ContractId).HasMaxLength(IdLen).IsRequired();
            e.Property(x => x.WorkVolume).HasPrecision(18, 2);
            e.Property(x => x.VariationOrders).HasPrecision(18, 2);
            e.Property(x => x.Materials).HasPrecision(18, 2);
            e.Property(x => x.Claims).HasPrecision(18, 2);
            e.Property(x => x.Vat).HasPrecision(18, 2);
            e.Property(x => x.TotalAmount).HasPrecision(18, 2);
            e.HasOne(x => x.Contract).WithMany(x => x.ExecPositions).HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.ContractId, x.VersionNumber }).IsUnique();
        });

        b.Entity<SocialInsuranceContract>(e =>
        {
            e.HasKey(x => x.ContractId);
            e.Property(x => x.ContractId).HasMaxLength(IdLen);
            e.Property(x => x.FileRate).HasPrecision(9, 2);
            e.HasOne(x => x.Contract).WithOne(x => x.SocialInsurance).HasForeignKey<SocialInsuranceContract>(x => x.ContractId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<SocialInsurancePayment>(e =>
        {
            e.HasKey(x => x.InvoiceId);
            e.Property(x => x.InvoiceId).HasMaxLength(IdLen);
            e.Property(x => x.ContractId).HasMaxLength(IdLen).IsRequired();
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.Property(x => x.PaidAmount).HasPrecision(18, 2);
            e.HasOne(x => x.Invoice).WithOne(x => x.SocialInsurancePayment).HasForeignKey<SocialInsurancePayment>(x => x.InvoiceId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Contract).WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<EscalationResponse>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.InvoiceDeductionId).HasMaxLength(IdLen).IsRequired();
            e.Property(x => x.ReturnedAmount).HasPrecision(18, 2);
            e.HasIndex(x => x.InvoiceDeductionId).IsUnique();
            e.HasOne(x => x.InvoiceDeduction).WithMany().HasForeignKey(x => x.InvoiceDeductionId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<DeductionLibraryItem>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.Name).HasMaxLength(250).IsRequired();
            e.HasIndex(x => x.Name).IsUnique();
        });

        b.Entity<AppUserRecord>(e =>
        {
            e.ToTable("AppUsers");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.Username).HasMaxLength(100).IsRequired();
            e.HasIndex(x => x.Username).IsUnique();
            e.Property(x => x.PasswordHash).HasMaxLength(500).IsRequired();
            e.Property(x => x.DisplayName).HasMaxLength(200).IsRequired();
            e.Property(x => x.Email).HasMaxLength(250);
            e.HasIndex(x => x.Email).IsUnique().HasFilter("[Email] IS NOT NULL AND [Email] <> ''");
            e.Property(x => x.Role).HasMaxLength(50).IsRequired();
            e.Property(x => x.Status).HasMaxLength(20).IsRequired();
            e.Property(x => x.PermissionsJson).HasColumnType("nvarchar(max)").IsRequired();
            e.Property(x => x.CreatedAt).IsRequired();
            e.Property(x => x.UpdatedAt).IsRequired();
        });

        b.Entity<CostControl>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.ContractId).HasMaxLength(IdLen).IsRequired();
            e.HasIndex(x => x.ContractId).IsUnique();
            e.HasOne(x => x.Contract).WithOne(x => x.CostControl).HasForeignKey<CostControl>(x => x.ContractId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<CostControlItem>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.CostControlId).HasMaxLength(IdLen).IsRequired();
            e.Property(x => x.Name).HasMaxLength(300).IsRequired();
            e.Property(x => x.Code).HasMaxLength(50);
            e.Property(x => x.CostType).HasMaxLength(20).IsRequired();
            e.HasIndex(x => x.CostControlId);
            e.HasOne(x => x.CostControl).WithMany(x => x.Items).HasForeignKey(x => x.CostControlId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<CostControlSubItem>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(IdLen);
            e.Property(x => x.CostControlItemId).HasMaxLength(IdLen).IsRequired();
            e.Property(x => x.Description).HasMaxLength(500).IsRequired();
            e.Property(x => x.StudyValue).HasPrecision(18, 2);
            e.Property(x => x.ActualCost).HasPrecision(18, 2);
            e.HasIndex(x => x.CostControlItemId);
            e.HasOne(x => x.CostControlItem).WithMany(x => x.SubItems).HasForeignKey(x => x.CostControlItemId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
