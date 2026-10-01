using InvoicesErp.Data;
using InvoicesErp.Interfaces;
using InvoicesErp.Middleware;
using InvoicesErp.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// MVC + API Controllers (same controllers serve /api/*)
builder.Services
    .AddControllersWithViews()
    .ConfigureApiBehaviorOptions(options =>
    {
        // لا تجعل ASP.NET يرجع 400 تلقائيًا قبل وصول الطلب للـ Controller.
        options.SuppressModelStateInvalidFilter = true;
    });

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("DefaultConnection")
    ));

// SOLID: depend on abstractions (DIP)
builder.Services.AddSingleton<InvoicesErp.Interfaces.IIdGenerator, InvoicesErp.Services.GuidIdGenerator>();
builder.Services.AddScoped<InvoicesErp.Interfaces.IAuthService, InvoicesErp.Services.AuthService>();
builder.Services.AddScoped<InvoicesErp.Interfaces.IUserStore, InvoicesErp.Services.UserStore>();
builder.Services.AddScoped<InvoicesErp.Interfaces.IBootstrapService, InvoicesErp.Services.BootstrapService>();
builder.Services.AddScoped<InvoicesErp.Interfaces.IOwnerService, InvoicesErp.Services.OwnerService>();
builder.Services.AddScoped<InvoicesErp.Interfaces.ICostControlCalculator, InvoicesErp.Services.Calculations.CostControlCalculator>();
// Concrete still available for any legacy resolution
builder.Services.AddScoped<InvoicesErp.Services.BootstrapService>();
builder.Services.AddScoped<InvoicesErp.Services.UserStore>();
builder.Services.AddScoped<InvoicesErp.Services.AuthService>();
builder.Services.AddScoped<ISectorService, SectorService>();
builder.Services.AddScoped<ISectorManagerService, SectorManagerService>();


// CORS — kept for optional separate frontend during transition; same-origin preferred
builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        var configuredOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>()
            ?? ["http://localhost:5173", "http://localhost:5180", "http://localhost:5174", "http://localhost:3000", "http://localhost:5000", "http://localhost:5080"];

        policy
            .WithOrigins(configuredOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseMiddleware<ExceptionHandlingMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
else
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

app.UseCors("Frontend");

app.UseStaticFiles();
app.UseRouting();

// Auth: parse Bearer token → HttpContext.Items["AppUser"]
app.UseMiddleware<AuthMiddleware>();

app.MapControllers();
app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

// Verify DB connectivity, ensure AppUsers table exists, seed admin if empty.
// Soft-fail in environments without SQL Server so the UI shell can still load.
try
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

    if (await db.Database.CanConnectAsync())
    {
        await UserStore.EnsureSchemaAndSeedAsync(db);

        // Add ModifiedAmount / VoAmount / ClaimsAmount / VatAmount to Contracts if missing (backward compatible).
        await db.Database.ExecuteSqlRawAsync("""
            IF COL_LENGTH('dbo.Contracts', 'ModifiedAmount') IS NULL
                ALTER TABLE dbo.Contracts ADD ModifiedAmount DECIMAL(18,2) NOT NULL CONSTRAINT DF_Contracts_ModifiedAmount DEFAULT(0);
            IF COL_LENGTH('dbo.Contracts', 'VoAmount') IS NULL
                ALTER TABLE dbo.Contracts ADD VoAmount DECIMAL(18,2) NOT NULL CONSTRAINT DF_Contracts_VoAmount DEFAULT(0);
            IF COL_LENGTH('dbo.Contracts', 'ClaimsAmount') IS NULL
                ALTER TABLE dbo.Contracts ADD ClaimsAmount DECIMAL(18,2) NOT NULL CONSTRAINT DF_Contracts_ClaimsAmount DEFAULT(0);
            IF COL_LENGTH('dbo.Contracts', 'VatAmount') IS NULL
                ALTER TABLE dbo.Contracts ADD VatAmount DECIMAL(18,2) NOT NULL CONSTRAINT DF_Contracts_VatAmount DEFAULT(0);
            """);

        // Ensure Cost Control tables exist (backward compatible).
        await db.Database.ExecuteSqlRawAsync("""
            IF OBJECT_ID('dbo.CostControls', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.CostControls (
                    Id NVARCHAR(64) NOT NULL PRIMARY KEY,
                    ContractId NVARCHAR(64) NOT NULL,
                    CreatedAt DATETIME2 NOT NULL,
                    UpdatedAt DATETIME2 NOT NULL,
                    CONSTRAINT UQ_CostControls_ContractId UNIQUE (ContractId),
                    CONSTRAINT FK_CostControls_Contracts FOREIGN KEY (ContractId) REFERENCES dbo.Contracts(Id) ON DELETE CASCADE
                );
            END
            IF OBJECT_ID('dbo.CostControlItems', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.CostControlItems (
                    Id NVARCHAR(64) NOT NULL PRIMARY KEY,
                    CostControlId NVARCHAR(64) NOT NULL,
                    Name NVARCHAR(300) NOT NULL,
                    Code NVARCHAR(50) NULL,
                    CostType NVARCHAR(20) NOT NULL,
                    DisplayOrder INT NOT NULL,
                    CONSTRAINT FK_CostControlItems_CostControls FOREIGN KEY (CostControlId) REFERENCES dbo.CostControls(Id) ON DELETE CASCADE
                );
                CREATE INDEX IX_CostControlItems_CostControlId ON dbo.CostControlItems(CostControlId);
            END
            IF OBJECT_ID('dbo.CostControlSubItems', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.CostControlSubItems (
                    Id NVARCHAR(64) NOT NULL PRIMARY KEY,
                    CostControlItemId NVARCHAR(64) NOT NULL,
                    Description NVARCHAR(500) NOT NULL,
                    StudyValue DECIMAL(18,2) NOT NULL,
                    ActualCost DECIMAL(18,2) NOT NULL,
                    DisplayOrder INT NOT NULL,
                    CreatedAt DATETIME2 NOT NULL,
                    UpdatedAt DATETIME2 NOT NULL,
                    CONSTRAINT FK_CostControlSubItems_Items FOREIGN KEY (CostControlItemId) REFERENCES dbo.CostControlItems(Id) ON DELETE CASCADE
                );
                CREATE INDEX IX_CostControlSubItems_ItemId ON dbo.CostControlSubItems(CostControlItemId);
            END

            -- Performance indexes (idempotent)
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Invoices_Date' AND object_id = OBJECT_ID(N'dbo.Invoices'))
                CREATE INDEX IX_Invoices_Date ON dbo.Invoices(Date);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Invoices_Status' AND object_id = OBJECT_ID(N'dbo.Invoices'))
                CREATE INDEX IX_Invoices_Status ON dbo.Invoices(Status);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Invoices_PaymentStatus' AND object_id = OBJECT_ID(N'dbo.Invoices'))
                CREATE INDEX IX_Invoices_PaymentStatus ON dbo.Invoices(PaymentStatus);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Invoices_ContractId_Date' AND object_id = OBJECT_ID(N'dbo.Invoices'))
                CREATE INDEX IX_Invoices_ContractId_Date ON dbo.Invoices(ContractId, Date);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Projects_Name' AND object_id = OBJECT_ID(N'dbo.Projects'))
                CREATE INDEX IX_Projects_Name ON dbo.Projects(Name);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Contracts_Name' AND object_id = OBJECT_ID(N'dbo.Contracts'))
                CREATE INDEX IX_Contracts_Name ON dbo.Contracts(Name);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ExecPositions_ContractId_Version' AND object_id = OBJECT_ID(N'dbo.ExecPositions'))
                CREATE INDEX IX_ExecPositions_ContractId_Version ON dbo.ExecPositions(ContractId, VersionNumber);
            """);
    }
    else
    {
        app.Logger.LogWarning("Cannot connect to SQL Server. API data endpoints will fail until DefaultConnection is configured.");
    }
}
catch (Exception ex)
{
    app.Logger.LogWarning(ex, "Database initialization skipped. Configure DefaultConnection in appsettings.json.");
}

// Production safety: Auth signing key must not be empty or the well-known dev default.
if (app.Environment.IsProduction())
{
    var signKey = app.Configuration["Auth:SigningKey"] ?? "";
    if (string.IsNullOrWhiteSpace(signKey) ||
        signKey.Contains("Change-In-Production", StringComparison.OrdinalIgnoreCase) ||
        signKey.Contains("Dev-Signing-Key", StringComparison.OrdinalIgnoreCase))
    {
        throw new InvalidOperationException(
            "Auth:SigningKey must be set to a strong secret via environment/configuration in Production.");
    }
    var cs = app.Configuration.GetConnectionString("DefaultConnection");
    if (string.IsNullOrWhiteSpace(cs))
        throw new InvalidOperationException("ConnectionStrings:DefaultConnection must be configured in Production.");
}

app.Run();
