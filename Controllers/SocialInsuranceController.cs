using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using InvoicesErp.Data;
using InvoicesErp.Models;
using InvoicesErp.DTOs;
using InvoicesErp.Auth;

namespace InvoicesErp.Controllers;

[ApiController, Route("api/social-insurance")]
public class SocialInsuranceController(AppDbContext db) : ControllerBase
{
    [HttpGet("contracts")]
    [RequirePermission(PermissionModules.SocialInsurance, PermissionActions.View)]
    public async Task<ActionResult<IEnumerable<SocialInsuranceContractDto>>> Contracts(CancellationToken ct) =>
        Ok(await db.SocialInsuranceContracts.AsNoTracking()
            .Select(x => new SocialInsuranceContractDto(
                x.ContractId, x.TranslationStatus, x.BoqStatus, x.FileStatus, x.FileNumber,
                x.FileRate, x.ObjectionStatus, x.ObjectionDate, x.OpeningDate, x.Notes))
            .ToListAsync(ct));

    [HttpPut("contracts/{contractId}")]
    [RequirePermission(PermissionModules.SocialInsurance, PermissionActions.Edit)]
    public async Task<IActionResult> PutContract(string contractId, SocialInsuranceContractDto d, CancellationToken ct)
    {
        var x = await db.SocialInsuranceContracts.FindAsync([contractId], ct);
        if (x is null)
        {
            x = new SocialInsuranceContract { ContractId = contractId };
            db.Add(x);
        }
        x.TranslationStatus = d.TranslationStatus;
        x.BoqStatus = d.BoqStatus;
        x.FileStatus = d.FileStatus;
        x.FileNumber = d.FileNumber;
        x.FileRate = d.FileRate;
        x.ObjectionStatus = d.ObjectionStatus;
        x.ObjectionDate = d.ObjectionDate;
        x.OpeningDate = d.OpeningDate;
        x.Notes = d.Notes;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpGet("payments")]
    [RequirePermission(PermissionModules.SocialInsurance, PermissionActions.View)]
    public async Task<ActionResult<IEnumerable<SocialInsurancePaymentDto>>> Payments(CancellationToken ct) =>
        Ok(await db.SocialInsurancePayments.AsNoTracking()
            .Select(x => new SocialInsurancePaymentDto(
                x.InvoiceId, x.ContractId, x.Amount, x.PaidAmount, x.Status,
                x.PaymentDate, x.Reference, x.Notes))
            .ToListAsync(ct));

    [HttpPut("payments/{invoiceId}")]
    [RequirePermission(PermissionModules.SocialInsurance, PermissionActions.Edit)]
    public async Task<IActionResult> PutPayment(string invoiceId, SocialInsurancePaymentDto d, CancellationToken ct)
    {
        var x = await db.SocialInsurancePayments.FindAsync([invoiceId], ct);
        if (x is null)
        {
            x = new SocialInsurancePayment { InvoiceId = invoiceId };
            db.Add(x);
        }
        x.ContractId = d.ContractId;
        x.Amount = d.Amount;
        x.PaidAmount = Math.Clamp(d.PaidAmount, 0, d.Amount);
        x.Status = x.PaidAmount >= x.Amount && x.Amount > 0
            ? "مسدد"
            : x.PaidAmount > 0 ? "مسدد جزئياً" : "غير مسدد";
        x.PaymentDate = d.PaymentDate;
        x.Reference = d.Reference;
        x.Notes = d.Notes;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
}
