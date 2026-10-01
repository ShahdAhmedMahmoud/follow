using System.Text.Json;
using InvoicesErp.Data;
using InvoicesErp.DTOs;
using InvoicesErp.Models;
using Microsoft.EntityFrameworkCore;

namespace InvoicesErp.Services;

public class BootstrapService(AppDbContext db) : InvoicesErp.Interfaces.IBootstrapService
{
    public async Task<BootstrapDto> GetAsync(CancellationToken ct)
    {
        return new BootstrapDto
        {
            Owners = await db.Owners
                .AsNoTracking()
                .Select(x => new OwnerDto(
                    x.Id,
                    x.Name,
                    x.Phone,
                    x.Email))
                .ToListAsync(ct),

            Projects = await db.Projects
                .AsNoTracking()
                .Select(x => new ProjectDto(
                    x.Id,
                    x.OwnerId,
                    x.Name,
                    x.StartDate,
                    x.Status,
                    x.SectorManagerId))
                .ToListAsync(ct),

            Contracts = await db.Contracts
                .AsNoTracking()
                .Select(x => new ContractDto(
                    x.Id,
                    x.ProjectId,
                    x.Name,
                    x.Amount,
                    x.ModifiedAmount,
                    x.VoAmount,
                    x.ClaimsAmount,
                    x.VatAmount,
                    x.PaymentTerms,
                    x.SignDate,
                    x.Status))
                .ToListAsync(ct),

            Invoices = await db.Invoices
                .AsNoTracking()
                .Include(x => x.Items)
                .Include(x => x.Deductions)
                .Select(x => new InvoiceDto(
                    x.Id,
                    x.ContractId,
                    x.Number,
                    x.Date,
                    x.DueDate,
                    x.Status,
                    x.PaymentStatus,
                    x.PaidAmount,
                    x.PaymentDate,
                    x.WorkVolume,
                    x.VariationOrders,
                    x.Materials,
                    x.Claims,
                    x.Vat,
                    x.Items
                        .Select(i => new InvoiceItemDto(
                            i.Id,
                            i.Description,
                            i.Qty,
                            i.Rate,
                            i.Total,
                            i.CurrentTotal))
                        .ToList(),
                    x.Deductions
                        .Select(d => new InvoiceDeductionDto(
                            d.Id,
                            d.Description,
                            d.CalcType,
                            d.Val,
                            d.Amount,
                            d.IsRefundable,
                            string.IsNullOrWhiteSpace(d.CalcFromKeysJson)
                                ? null
                                : JsonSerializer.Deserialize<string[]>(
                                    d.CalcFromKeysJson)!))
                        .ToList()
                ))
                .ToListAsync(ct),

            ExecPositions = await db.ExecPositions
                .AsNoTracking()
                .Select(x => new ExecPositionDto(
                    x.Id,
                    x.ContractId,
                    x.VersionNumber,
                    x.Date,
                    x.User,
                    x.WorkVolume,
                    x.VariationOrders,
                    x.Materials,
                    x.Claims,
                    x.Vat,
                    x.TotalAmount))
                .ToListAsync(ct),

            SocialInsuranceContracts = await db.SocialInsuranceContracts
                .AsNoTracking()
                .Select(x => new SocialInsuranceContractDto(
                    x.ContractId,
                    x.TranslationStatus,
                    x.BoqStatus,
                    x.FileStatus,
                    x.FileNumber,
                    x.FileRate,
                    x.ObjectionStatus,
                    x.ObjectionDate,
                    x.OpeningDate,
                    x.Notes))
                .ToListAsync(ct),

            SocialInsurancePayments = await db.SocialInsurancePayments
                .AsNoTracking()
                .Select(x => new SocialInsurancePaymentDto(
                    x.InvoiceId,
                    x.ContractId,
                    x.Amount,
                    x.PaidAmount,
                    x.Status,
                    x.PaymentDate,
                    x.Reference,
                    x.Notes))
                .ToListAsync(ct),

            Escalations = await db.EscalationResponses
                .AsNoTracking()
                .Select(x => new EscalationDto(
                    x.InvoiceDeductionId,
                    x.ResponseStatus,
                    x.ResponseDate,
                    x.ReturnedAmount))
                .ToListAsync(ct),

            DeductionLibrary = await db.DeductionLibraryItems
                .AsNoTracking()
                .Select(x => new DeductionLibraryDto(
                    x.Id,
                    x.Name))
                .ToListAsync(ct),

            SectorManagers = await db.SectorManagers
                .AsNoTracking()
                .Select(x => new SectorManagerDto(
                    x.Id,
                    x.Name,
                    x.Sector,
                    x.Phone,
                    x.Email,
                    x.Notes,
                    x.Status,
                    x.Projects.Count))
                .ToListAsync(ct)
        };
    }

    public async Task ReplaceAsync(
        BootstrapDto dto,
        CancellationToken ct)
    {
        if (dto is null)
        {
            throw new ArgumentException("Bootstrap payload is null.");
        }

        var owners = dto.Owners ?? [];
        var projects = dto.Projects ?? [];
        var contracts = dto.Contracts ?? [];
        var invoices = dto.Invoices ?? [];
        var execPositions = dto.ExecPositions ?? [];
        var socialInsuranceContracts =
            dto.SocialInsuranceContracts ?? [];
        var socialInsurancePayments =
            dto.SocialInsurancePayments ?? [];
        var escalations =
            dto.Escalations ?? [];
        var deductionLibrary =
            dto.DeductionLibrary ?? [];

        await using var tx =
            await db.Database.BeginTransactionAsync(ct);

        /*
         * =========================================================
         * DELETE EXISTING DATA
         * =========================================================
         *
         * Delete child records before parent records
         * to respect SQL Server foreign keys.
         */

        // Children first (Cost Control hierarchy included)
        db.CostControlSubItems.RemoveRange(db.CostControlSubItems);
        db.CostControlItems.RemoveRange(db.CostControlItems);
        db.CostControls.RemoveRange(db.CostControls);

        db.EscalationResponses.RemoveRange(db.EscalationResponses);
        db.SocialInsurancePayments.RemoveRange(db.SocialInsurancePayments);
        db.SocialInsuranceContracts.RemoveRange(db.SocialInsuranceContracts);
        db.ExecPositions.RemoveRange(db.ExecPositions);
        db.InvoiceDeductions.RemoveRange(db.InvoiceDeductions);
        db.InvoiceItems.RemoveRange(db.InvoiceItems);
        db.Invoices.RemoveRange(db.Invoices);
        db.Contracts.RemoveRange(db.Contracts);
        db.Projects.RemoveRange(db.Projects);
        db.Owners.RemoveRange(db.Owners);
        db.DeductionLibraryItems.RemoveRange(db.DeductionLibraryItems);

        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();

        /*
         * =========================================================
         * OWNERS
         * =========================================================
         */

        var validOwners = owners
            .Where(x =>
                !string.IsNullOrWhiteSpace(x.Id) &&
                !string.IsNullOrWhiteSpace(x.Name))
            .ToList();

        var generatedOwnerIds = new Dictionary<
            string,
            string>(
            StringComparer.OrdinalIgnoreCase);

        var replaceSeenOwners = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var owner in validOwners)
        {
            var id = NormalizeId(owner.Id!, generatedOwnerIds);
            if (!replaceSeenOwners.Add(id))
                continue;

            db.Owners.Add(
                new Owner
                {
                    Id = id,
                    Name = owner.Name!.Trim(),
                    Phone = owner.Phone,
                    Email = owner.Email
                });
        }

        var ownerIds = validOwners
            .Select(x => NormalizeId(
                x.Id,
                generatedOwnerIds))
            .ToHashSet();

        /*
         * =========================================================
         * PROJECTS
         * =========================================================
         */

        var validProjects = projects
            .Where(x =>
                !string.IsNullOrWhiteSpace(x.Id) &&
                !string.IsNullOrWhiteSpace(x.OwnerId) &&
                !string.IsNullOrWhiteSpace(x.Name) &&
                ownerIds.Contains(x.OwnerId))
            .ToList();

        var generatedProjectIds = new Dictionary<
            string,
            string>(
            StringComparer.OrdinalIgnoreCase);

        var replaceSeenProjects = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var project in validProjects)
        {
            var id = NormalizeId(project.Id!, generatedProjectIds);
            if (!replaceSeenProjects.Add(id))
                continue;

            db.Projects.Add(
                new Project
                {
                    Id = id,
                    OwnerId = project.OwnerId!,
                    Name = project.Name!.Trim(),
                    StartDate = project.StartDate,
                    Status = project.Status,
                    SectorManagerId = project.SectorManagerId
                });
        }

        var projectIds = validProjects
            .Select(x => NormalizeId(
                x.Id,
                generatedProjectIds))
            .ToHashSet();

        /*
         * =========================================================
         * CONTRACTS
         * =========================================================
         */

        var validContracts = contracts
            .Where(x =>
                !string.IsNullOrWhiteSpace(x.Id) &&
                !string.IsNullOrWhiteSpace(x.ProjectId) &&
                !string.IsNullOrWhiteSpace(x.Name) &&
                projectIds.Contains(x.ProjectId))
            .ToList();

        var generatedContractIds = new Dictionary<
            string,
            string>(
            StringComparer.OrdinalIgnoreCase);

        foreach (var contract in validContracts)
        {
            var id = NormalizeId(
                contract.Id,
                generatedContractIds);

            db.Contracts.Add(
                new Contract
                {
                    Id = id,
                    ProjectId = contract.ProjectId,
                    Name = contract.Name.Trim(),
                    Amount = contract.Amount,
                    ModifiedAmount = contract.ModifiedAmount < 0 ? 0 : contract.ModifiedAmount,
                    VoAmount = contract.VoAmount < 0 ? 0 : contract.VoAmount,
                    ClaimsAmount = contract.ClaimsAmount < 0 ? 0 : contract.ClaimsAmount,
                    VatAmount = contract.VatAmount < 0 ? 0 : contract.VatAmount,
                    PaymentTerms = contract.PaymentTerms,
                    SignDate = contract.SignDate,
                    Status = contract.Status
                });
        }

        var contractIds = validContracts
            .Select(x => NormalizeId(
                x.Id,
                generatedContractIds))
            .ToHashSet();

        /*
         * =========================================================
         * INVOICES
         * =========================================================
         */

        var validInvoices = invoices
            .Where(x =>
                !string.IsNullOrWhiteSpace(x.Id) &&
                !string.IsNullOrWhiteSpace(x.ContractId) &&
                !string.IsNullOrWhiteSpace(x.Number) &&
                x.Date.HasValue &&
                x.Date.Value != default &&
                contractIds.Contains(x.ContractId))
            .ToList();

        var generatedInvoiceIds = new Dictionary<
            string,
            string>(
            StringComparer.OrdinalIgnoreCase);

        foreach (var invoice in validInvoices)
        {
            var invoiceId = NormalizeId(
                invoice.Id,
                generatedInvoiceIds);

            var invoiceItems = (invoice.Items ?? [])
                .Where(item =>
                    !string.IsNullOrWhiteSpace(
                        item.Description))
                .Select(item =>
                    new InvoiceItem
                    {
                        Id = string.IsNullOrWhiteSpace(item.Id)
                            ? GenerateId()
                            : item.Id,
                        Description =
                            item.Description!.Trim(),
                        Qty = item.Qty,
                        Rate = item.Rate,
                        Total = item.Total,
                        CurrentTotal =
                            item.CurrentTotal
                    })
                .ToList();

            var invoiceDeductions =
                (invoice.Deductions ?? [])
                .Where(deduction =>
                    !string.IsNullOrWhiteSpace(
                        deduction.Description))
                .Select(deduction =>
                    new InvoiceDeduction
                    {
                        Id = string.IsNullOrWhiteSpace(
                                deduction.Id)
                            ? GenerateId()
                            : deduction.Id,

                        Description =
                            deduction.Description!.Trim(),

                        CalcType =
                            deduction.CalcType,

                        Val =
                            deduction.Val,

                        Amount =
                            deduction.Amount,

                        IsRefundable =
                            deduction.IsRefundable,

                        CalcFromKeysJson =
                            deduction.CalcFromKeys == null
                                ? null
                                : JsonSerializer.Serialize(
                                    deduction.CalcFromKeys)
                    })
                .ToList();

            // FIX: DateOnly? → DateTime
            var invoiceDate = invoice.Date ?? DateOnly.FromDateTime(DateTime.UtcNow);
            var invoiceDueDate = invoice.DueDate ?? invoiceDate;

            db.Invoices.Add(
                new Invoice
                {
                    Id = invoiceId,

                    ContractId =
                        invoice.ContractId,

                    Number =
                        invoice.Number!.Trim(),

                    Date =
                        invoiceDate,

                    DueDate =
                        invoiceDueDate,

                    Status =
                        invoice.Status,

                    PaymentStatus =
                        invoice.PaymentStatus,

                    PaidAmount =
                        invoice.PaidAmount,

                    PaymentDate =
                        invoice.PaymentDate,

                    WorkVolume =
                        invoice.WorkVolume,

                    VariationOrders =
                        invoice.VariationOrders,

                    Materials =
                        invoice.Materials,

                    Claims =
                        invoice.Claims,

                    Vat =
                        invoice.Vat,

                    Items =
                        invoiceItems,

                    Deductions =
                        invoiceDeductions
                });
        }

        var invoiceIds = validInvoices
            .Select(x => NormalizeId(
                x.Id,
                generatedInvoiceIds))
            .ToHashSet();

        /*
         * =========================================================
         * EXECUTION POSITIONS
         * =========================================================
         */

        var validExecPositions = execPositions
            .Where(x =>
                !string.IsNullOrWhiteSpace(x.ContractId) &&
                contractIds.Contains(x.ContractId) &&
                x.Date.HasValue &&
                x.Date.Value != default)
            .ToList();

        foreach (var position in validExecPositions)
        {
            // FIX: DateOnly? → DateTime
            var positionDate = position.Date ?? DateOnly.FromDateTime(DateTime.UtcNow);

            db.ExecPositions.Add(
                new ExecPosition
                {
                    Id = string.IsNullOrWhiteSpace(
                            position.Id)
                        ? GenerateId()
                        : position.Id,

                    ContractId =
                        position.ContractId,

                    VersionNumber =
                        position.VersionNumber,

                    Date =
                        positionDate,

                    User =
                        position.User,

                    WorkVolume =
                        position.WorkVolume,

                    VariationOrders =
                        position.VariationOrders,

                    Materials =
                        position.Materials,

                    Claims =
                        position.Claims,

                    Vat =
                        position.Vat,

                    TotalAmount =
                        position.TotalAmount
                });
        }

        /*
         * =========================================================
         * SOCIAL INSURANCE CONTRACTS
         * =========================================================
         */

        var validSocialContracts =
            socialInsuranceContracts
                .Where(x =>
                    !string.IsNullOrWhiteSpace(
                        x.ContractId) &&
                    contractIds.Contains(
                        x.ContractId))
                .ToList();

        foreach (var item in validSocialContracts)
        {
            db.SocialInsuranceContracts.Add(
                new SocialInsuranceContract
                {
                    ContractId =
                        item.ContractId,

                    TranslationStatus =
                        item.TranslationStatus,

                    BoqStatus =
                        item.BoqStatus,

                    FileStatus =
                        item.FileStatus,

                    FileNumber =
                        item.FileNumber,

                    FileRate =
                        item.FileRate,

                    ObjectionStatus =
                        item.ObjectionStatus,

                    ObjectionDate =
                        item.ObjectionDate,

                    OpeningDate =
                        item.OpeningDate,

                    Notes =
                        item.Notes
                });
        }

        /*
         * =========================================================
         * SOCIAL INSURANCE PAYMENTS
         * =========================================================
         */

        var validSocialPayments =
            socialInsurancePayments
                .Where(x =>
                    !string.IsNullOrWhiteSpace(
                        x.InvoiceId) &&
                    !string.IsNullOrWhiteSpace(
                        x.ContractId) &&
                    invoiceIds.Contains(
                        x.InvoiceId) &&
                    contractIds.Contains(
                        x.ContractId))
                .ToList();

        foreach (var payment in validSocialPayments)
        {
            db.SocialInsurancePayments.Add(
                new SocialInsurancePayment
                {
                    InvoiceId =
                        payment.InvoiceId,

                    ContractId =
                        payment.ContractId,

                    Amount =
                        payment.Amount,

                    PaidAmount =
                        payment.PaidAmount,

                    Status =
                        payment.Status,

                    PaymentDate =
                        payment.PaymentDate,

                    Reference =
                        payment.Reference,

                    Notes =
                        payment.Notes
                });
        }

        /*
         * =========================================================
         * ESCALATIONS
         * =========================================================
         */

        var validEscalations =
            escalations
                .Where(x =>
                    !string.IsNullOrWhiteSpace(
                        x.InvoiceDeductionId))
                .ToList();

        foreach (var escalation in validEscalations)
        {
            db.EscalationResponses.Add(
                new EscalationResponse
                {
                    Id = GenerateId(),

                    InvoiceDeductionId =
                        escalation.InvoiceDeductionId,

                    ResponseStatus =
                        escalation.ResponseStatus,

                    ResponseDate =
                        escalation.ResponseDate,

                    ReturnedAmount =
                        escalation.ReturnedAmount
                });
        }

        /*
         * =========================================================
         * DEDUCTION LIBRARY
         * =========================================================
         */

        var validDeductionLibrary =
            deductionLibrary
                .Where(x =>
                    !string.IsNullOrWhiteSpace(
                        x.Name))
                .ToList();

        foreach (var item in validDeductionLibrary)
        {
            db.DeductionLibraryItems.Add(
                new DeductionLibraryItem
                {
                    Id =
                        string.IsNullOrWhiteSpace(item.Id)
                            ? GenerateId()
                            : item.Id,

                    Name =
                        item.Name!.Trim()
                });
        }

        /*
         * =========================================================
         * SAVE
         * =========================================================
         */

        await db.SaveChangesAsync(ct);

        await tx.CommitAsync(ct);
    }

    public async Task UpsertAsync(
        BootstrapDto dto,
        CancellationToken ct)
    {
        if (dto is null)
            throw new ArgumentException("Bootstrap payload is null.");

        var owners = dto.Owners ?? [];
        var projects = dto.Projects ?? [];
        var contracts = dto.Contracts ?? [];
        var invoices = dto.Invoices ?? [];
        var execPositions = dto.ExecPositions ?? [];
        var socialInsuranceContracts =
            dto.SocialInsuranceContracts ?? [];
        var socialInsurancePayments =
            dto.SocialInsurancePayments ?? [];
        var escalations = dto.Escalations ?? [];
        var deductionLibrary =
            dto.DeductionLibrary ?? [];

        await using var tx =
            await db.Database.BeginTransactionAsync(ct);

        /*
         * =========================================================
         * LOAD EXISTING IDS
         * =========================================================
         */

        var existingOwnerIds = (await db.Owners
            .Select(x => x.Id).ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var existingProjectIds = (await db.Projects
            .Select(x => x.Id).ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var existingContractIds = (await db.Contracts
            .Select(x => x.Id).ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var existingInvoiceIds = (await db.Invoices
            .Select(x => x.Id).ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var existingExecPositionIds = (await db.ExecPositions
            .Select(x => x.Id).ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var existingSIPaymentIds = (await db.SocialInsurancePayments
            .Select(x => x.InvoiceId).ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var existingEscalationDeductionIds = (await db.EscalationResponses
            .Select(x => x.InvoiceDeductionId).ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var existingDeductionLibIds = (await db.DeductionLibraryItems
            .Select(x => x.Id).ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        /*
         * =========================================================
         * OWNERS — UPSERT
         * =========================================================
         */

        var validOwners = owners
            .Where(x =>
                !string.IsNullOrWhiteSpace(x.Id) &&
                !string.IsNullOrWhiteSpace(x.Name))
            .ToList();

        var generatedOwnerIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var seenOwnerIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var owner in validOwners)
        {
            var id = NormalizeId(owner.Id!, generatedOwnerIds);
            if (!seenOwnerIds.Add(id))
                continue; // duplicate in payload

            if (existingOwnerIds.Contains(id))
            {
                var existing = await db.Owners.FindAsync([id], ct);
                if (existing is not null)
                {
                    existing.Name = owner.Name!.Trim();
                    existing.Phone = owner.Phone;
                    existing.Email = owner.Email;
                }
            }
            else
            {
                db.Owners.Add(new Owner
                {
                    Id = id,
                    Name = owner.Name!.Trim(),
                    Phone = owner.Phone,
                    Email = owner.Email
                });
                existingOwnerIds.Add(id); // prevent later duplicate adds
            }
        }

        var ownerIds = validOwners
            .Select(x => NormalizeId(x.Id, generatedOwnerIds))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        /*
         * =========================================================
         * PROJECTS — UPSERT
         * =========================================================
         */

        var validProjects = projects
            .Where(x =>
                !string.IsNullOrWhiteSpace(x.Id) &&
                !string.IsNullOrWhiteSpace(x.OwnerId) &&
                !string.IsNullOrWhiteSpace(x.Name) &&
                (existingOwnerIds.Contains(x.OwnerId) || ownerIds.Contains(x.OwnerId)))
            .ToList();

        var generatedProjectIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var seenProjectIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var project in validProjects)
        {
            var id = NormalizeId(project.Id!, generatedProjectIds);
            if (!seenProjectIds.Add(id))
                continue;

            var ownerId = (project.OwnerId ?? "").Trim();
            if (existingProjectIds.Contains(id))
            {
                var existing = await db.Projects.FindAsync([id], ct);
                if (existing is not null)
                {
                    existing.OwnerId = ownerId;
                    existing.Name = project.Name!.Trim();
                    existing.StartDate = project.StartDate;
                    existing.Status = project.Status;
                    existing.SectorManagerId = project.SectorManagerId;
                }
            }
            else
            {
                db.Projects.Add(new Project
                {
                    Id = id,
                    OwnerId = ownerId,
                    Name = project.Name!.Trim(),
                    StartDate = project.StartDate,
                    Status = project.Status,
                    SectorManagerId = project.SectorManagerId
                });
                existingProjectIds.Add(id);
            }
        }

        var projectIds = validProjects
            .Select(x => NormalizeId(x.Id, generatedProjectIds))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        /*
         * =========================================================
         * CONTRACTS — UPSERT
         * =========================================================
         */

        // Build effective project IDs: existing + newly added in this upsert
        var effectiveProjectIds = new HashSet<string>(existingProjectIds, StringComparer.OrdinalIgnoreCase);
        foreach (var pid in projectIds) effectiveProjectIds.Add(pid);

        var validContracts = contracts
            .Where(x =>
                !string.IsNullOrWhiteSpace(x.Id) &&
                !string.IsNullOrWhiteSpace(x.ProjectId) &&
                !string.IsNullOrWhiteSpace(x.Name) &&
                effectiveProjectIds.Contains(x.ProjectId))
            .ToList();

        var generatedContractIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var contract in validContracts)
        {
            var id = NormalizeId(contract.Id, generatedContractIds);
            if (existingContractIds.Contains(id))
            {
                var existing = await db.Contracts.FindAsync([id], ct);
                if (existing is not null)
                {
                    existing.ProjectId = contract.ProjectId;
                    existing.Name = contract.Name.Trim();
                    existing.Amount = contract.Amount;
                    existing.ModifiedAmount = contract.ModifiedAmount < 0 ? 0 : contract.ModifiedAmount;
                    existing.VoAmount = contract.VoAmount < 0 ? 0 : contract.VoAmount;
                    existing.ClaimsAmount = contract.ClaimsAmount < 0 ? 0 : contract.ClaimsAmount;
                    existing.VatAmount = contract.VatAmount < 0 ? 0 : contract.VatAmount;
                    existing.PaymentTerms = contract.PaymentTerms;
                    existing.SignDate = contract.SignDate;
                    existing.Status = contract.Status;
                }
            }
            else
            {
                db.Contracts.Add(new Contract
                {
                    Id = id,
                    ProjectId = contract.ProjectId,
                    Name = contract.Name.Trim(),
                    Amount = contract.Amount,
                    ModifiedAmount = contract.ModifiedAmount < 0 ? 0 : contract.ModifiedAmount,
                    VoAmount = contract.VoAmount < 0 ? 0 : contract.VoAmount,
                    ClaimsAmount = contract.ClaimsAmount < 0 ? 0 : contract.ClaimsAmount,
                    VatAmount = contract.VatAmount < 0 ? 0 : contract.VatAmount,
                    PaymentTerms = contract.PaymentTerms,
                    SignDate = contract.SignDate,
                    Status = contract.Status
                });
            }
        }

        var contractIds = validContracts
            .Select(x => NormalizeId(x.Id, generatedContractIds))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        /*
         * =========================================================
         * INVOICES — UPSERT (with items & deductions)
         * =========================================================
         */

        // Build effective contract IDs: existing + newly added in this upsert
        var effectiveContractIds = new HashSet<string>(existingContractIds, StringComparer.OrdinalIgnoreCase);
        foreach (var cid in contractIds) effectiveContractIds.Add(cid);

        var validInvoices = invoices
            .Where(x =>
                !string.IsNullOrWhiteSpace(x.Id) &&
                !string.IsNullOrWhiteSpace(x.ContractId) &&
                !string.IsNullOrWhiteSpace(x.Number) &&
                effectiveContractIds.Contains(x.ContractId))
            .ToList();

        var generatedInvoiceIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var invoice in validInvoices)
        {
            var invoiceId = NormalizeId(invoice.Id, generatedInvoiceIds);
            var invoiceDate = invoice.Date ?? DateOnly.FromDateTime(DateTime.UtcNow);
            var invoiceDueDate = invoice.DueDate ?? invoiceDate;

            var invoiceItems = (invoice.Items ?? [])
                .Where(item => !string.IsNullOrWhiteSpace(item.Description))
                .Select(item => new InvoiceItem
                {
                    Id = string.IsNullOrWhiteSpace(item.Id) ? GenerateId() : item.Id,
                    Description = item.Description!.Trim(),
                    Qty = item.Qty,
                    Rate = item.Rate,
                    Total = item.Total,
                    CurrentTotal = item.CurrentTotal
                })
                .ToList();

            var invoiceDeductions = (invoice.Deductions ?? [])
                .Where(d => !string.IsNullOrWhiteSpace(d.Description))
                .Select(d => new InvoiceDeduction
                {
                    Id = string.IsNullOrWhiteSpace(d.Id) ? GenerateId() : d.Id,
                    Description = d.Description!.Trim(),
                    CalcType = d.CalcType,
                    Val = d.Val,
                    Amount = d.Amount,
                    IsRefundable = d.IsRefundable,
                    CalcFromKeysJson = d.CalcFromKeys == null
                        ? null
                        : System.Text.Json.JsonSerializer.Serialize(d.CalcFromKeys)
                })
                .ToList();

            if (existingInvoiceIds.Contains(invoiceId))
            {
                var existing = await db.Invoices
                    .Include(x => x.Items)
                    .Include(x => x.Deductions)
                    .FirstOrDefaultAsync(x => x.Id == invoiceId, ct);

                if (existing is not null)
                {
                    existing.ContractId = invoice.ContractId;
                    existing.Number = invoice.Number!.Trim();
                    existing.Date = invoiceDate;
                    existing.DueDate = invoiceDueDate;
                    existing.Status = invoice.Status;
                    existing.PaymentStatus = invoice.PaymentStatus;
                    existing.PaidAmount = invoice.PaidAmount;
                    existing.PaymentDate = invoice.PaymentDate;
                    existing.WorkVolume = invoice.WorkVolume;
                    existing.VariationOrders = invoice.VariationOrders;
                    existing.Materials = invoice.Materials;
                    existing.Claims = invoice.Claims;
                    existing.Vat = invoice.Vat;

                    // Replace items and deductions for this invoice
                    if (existing.Items.Any()) db.InvoiceItems.RemoveRange(existing.Items);
                    if (existing.Deductions.Any()) db.InvoiceDeductions.RemoveRange(existing.Deductions);
                    existing.Items = invoiceItems;
                    existing.Deductions = invoiceDeductions;
                }
            }
            else
            {
                db.Invoices.Add(new Invoice
                {
                    Id = invoiceId,
                    ContractId = invoice.ContractId,
                    Number = invoice.Number!.Trim(),
                    Date = invoiceDate,
                    DueDate = invoiceDueDate,
                    Status = invoice.Status,
                    PaymentStatus = invoice.PaymentStatus,
                    PaidAmount = invoice.PaidAmount,
                    PaymentDate = invoice.PaymentDate,
                    WorkVolume = invoice.WorkVolume,
                    VariationOrders = invoice.VariationOrders,
                    Materials = invoice.Materials,
                    Claims = invoice.Claims,
                    Vat = invoice.Vat,
                    Items = invoiceItems,
                    Deductions = invoiceDeductions
                });
            }
        }

        var invoiceIds = validInvoices
            .Select(x => NormalizeId(x.Id, generatedInvoiceIds))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        /*
         * =========================================================
         * EXECUTION POSITIONS — UPSERT
         * =========================================================
         */

        var validExecPositions = execPositions
            .Where(x =>
                !string.IsNullOrWhiteSpace(x.Id) &&
                !string.IsNullOrWhiteSpace(x.ContractId) &&
                effectiveContractIds.Contains(x.ContractId))
            .ToList();

        foreach (var position in validExecPositions)
        {
            var posId = position.Id!;
            if (existingExecPositionIds.Contains(posId))
            {
                var existing = await db.ExecPositions.FindAsync([posId], ct);
                if (existing is not null)
                {
                    existing.ContractId = position.ContractId;
                    existing.VersionNumber = position.VersionNumber;
                    existing.Date = position.Date ?? DateOnly.FromDateTime(DateTime.UtcNow);
                    existing.User = position.User;
                    existing.WorkVolume = position.WorkVolume;
                    existing.VariationOrders = position.VariationOrders;
                    existing.Materials = position.Materials;
                    existing.Claims = position.Claims;
                    existing.Vat = position.Vat;
                    existing.TotalAmount = position.TotalAmount;
                }
            }
            else
            {
                // Check unique constraint on (ContractId, VersionNumber)
                var duplicate = await db.ExecPositions
                    .FirstOrDefaultAsync(x => x.ContractId == position.ContractId && x.VersionNumber == position.VersionNumber, ct);
                if (duplicate is not null)
                {
                    // Update the existing record with this contract+version
                    duplicate.User = position.User;
                    duplicate.Date = position.Date ?? DateOnly.FromDateTime(DateTime.UtcNow);
                    duplicate.WorkVolume = position.WorkVolume;
                    duplicate.VariationOrders = position.VariationOrders;
                    duplicate.Materials = position.Materials;
                    duplicate.Claims = position.Claims;
                    duplicate.Vat = position.Vat;
                    duplicate.TotalAmount = position.TotalAmount;
                }
                else
                {
                    db.ExecPositions.Add(new ExecPosition
                    {
                        Id = posId,
                        ContractId = position.ContractId,
                        VersionNumber = position.VersionNumber,
                        Date = position.Date ?? DateOnly.FromDateTime(DateTime.UtcNow),
                        User = position.User,
                        WorkVolume = position.WorkVolume,
                        VariationOrders = position.VariationOrders,
                        Materials = position.Materials,
                        Claims = position.Claims,
                        Vat = position.Vat,
                        TotalAmount = position.TotalAmount
                    });
                }
            }
        }

        /*
         * =========================================================
         * SOCIAL INSURANCE CONTRACTS — UPSERT
         * =========================================================
         */

        var validSocialContracts = socialInsuranceContracts
            .Where(x => !string.IsNullOrWhiteSpace(x.ContractId) && effectiveContractIds.Contains(x.ContractId))
            .ToList();

        foreach (var item in validSocialContracts)
        {
            var existing = await db.SocialInsuranceContracts
                .FindAsync([item.ContractId!], ct);
            if (existing is not null)
            {
                existing.TranslationStatus = item.TranslationStatus;
                existing.BoqStatus = item.BoqStatus;
                existing.FileStatus = item.FileStatus;
                existing.FileNumber = item.FileNumber;
                existing.FileRate = item.FileRate;
                existing.ObjectionStatus = item.ObjectionStatus;
                existing.ObjectionDate = item.ObjectionDate;
                existing.OpeningDate = item.OpeningDate;
                existing.Notes = item.Notes;
            }
            else
            {
                db.SocialInsuranceContracts.Add(new SocialInsuranceContract
                {
                    ContractId = item.ContractId,
                    TranslationStatus = item.TranslationStatus,
                    BoqStatus = item.BoqStatus,
                    FileStatus = item.FileStatus,
                    FileNumber = item.FileNumber,
                    FileRate = item.FileRate,
                    ObjectionStatus = item.ObjectionStatus,
                    ObjectionDate = item.ObjectionDate,
                    OpeningDate = item.OpeningDate,
                    Notes = item.Notes
                });
            }
        }

        /*
         * =========================================================
         * SOCIAL INSURANCE PAYMENTS — UPSERT
         * =========================================================
         */

        // Build effective invoice IDs: existing + newly added in this upsert
        var effectiveInvoiceIds = new HashSet<string>(existingInvoiceIds, StringComparer.OrdinalIgnoreCase);
        foreach (var iid in invoiceIds) effectiveInvoiceIds.Add(iid);

        var validSocialPayments = socialInsurancePayments
            .Where(x =>
                !string.IsNullOrWhiteSpace(x.InvoiceId) &&
                !string.IsNullOrWhiteSpace(x.ContractId) &&
                effectiveInvoiceIds.Contains(x.InvoiceId) &&
                effectiveContractIds.Contains(x.ContractId))
            .ToList();

        foreach (var payment in validSocialPayments)
        {
            var invoiceKey = payment.InvoiceId!;
            if (existingSIPaymentIds.Contains(invoiceKey))
            {
                var existing = await db.SocialInsurancePayments
                    .FindAsync([invoiceKey], ct);
                if (existing is not null)
                {
                    existing.ContractId = payment.ContractId;
                    existing.Amount = payment.Amount;
                    existing.PaidAmount = payment.PaidAmount;
                    existing.Status = payment.Status;
                    existing.PaymentDate = payment.PaymentDate;
                    existing.Reference = payment.Reference;
                    existing.Notes = payment.Notes;
                }
            }
            else
            {
                db.SocialInsurancePayments.Add(new SocialInsurancePayment
                {
                    InvoiceId = payment.InvoiceId,
                    ContractId = payment.ContractId,
                    Amount = payment.Amount,
                    PaidAmount = payment.PaidAmount,
                    Status = payment.Status,
                    PaymentDate = payment.PaymentDate,
                    Reference = payment.Reference,
                    Notes = payment.Notes
                });
            }
        }

        /*
         * =========================================================
         * ESCALATIONS — UPSERT
         * =========================================================
         */

        var validEscalations = escalations
            .Where(x => !string.IsNullOrWhiteSpace(x.InvoiceDeductionId) &&
                         !string.IsNullOrWhiteSpace(x.ResponseStatus))
            .ToList();

        foreach (var escalation in validEscalations)
        {
            var dedId = escalation.InvoiceDeductionId!;
            if (existingEscalationDeductionIds.Contains(dedId))
            {
                var existing = await db.EscalationResponses
                    .FirstOrDefaultAsync(x => x.InvoiceDeductionId == dedId, ct);
                if (existing is not null)
                {
                    existing.ResponseStatus = escalation.ResponseStatus;
                    existing.ResponseDate = escalation.ResponseDate;
                    existing.ReturnedAmount = escalation.ReturnedAmount;
                }
            }
            else
            {
                db.EscalationResponses.Add(new EscalationResponse
                {
                    Id = GenerateId(),
                    InvoiceDeductionId = dedId,
                    ResponseStatus = escalation.ResponseStatus,
                    ResponseDate = escalation.ResponseDate,
                    ReturnedAmount = escalation.ReturnedAmount
                });
            }
        }

        /*
         * =========================================================
         * DEDUCTION LIBRARY — UPSERT
         * =========================================================
         */

        var validDeductionLibrary = deductionLibrary
            .Where(x => !string.IsNullOrWhiteSpace(x.Name))
            .ToList();

        foreach (var item in validDeductionLibrary)
        {
            var libId = string.IsNullOrWhiteSpace(item.Id) ? GenerateId() : item.Id;
            if (existingDeductionLibIds.Contains(libId))
            {
                var existing = await db.DeductionLibraryItems
                    .FindAsync([libId], ct);
                if (existing is not null)
                {
                    existing.Name = item.Name!.Trim();
                }
            }
            else
            {
                db.DeductionLibraryItems.Add(new DeductionLibraryItem
                {
                    Id = libId,
                    Name = item.Name!.Trim()
                });
            }
        }

        /*
         * =========================================================
         * SAVE
         * =========================================================
         */

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    private static string NormalizeId(
        string id,
        IDictionary<string, string> generatedIds)
    {
        if (!string.IsNullOrWhiteSpace(id))
            return id.Trim();

        var key = Guid.NewGuid().ToString("N");

        var generated =
            "ID-" + key;

        generatedIds[key] =
            generated;

        return generated;
    }

    private static string GenerateId()
        => Guid.NewGuid().ToString("N");
}