using InvoicesErp.DTOs;
using InvoicesErp.Models;

namespace InvoicesErp.Interfaces;

/// <summary>Pure calculation rules for Cost Control (SRP / OCP).</summary>
public interface ICostControlCalculator
{
    CostControlSubItemDto MapSubItem(CostControlSubItem s, decimal original, decimal revised, decimal progressAmount, decimal progressPct);
    CostControlItemDto MapItem(CostControlItem item, decimal original, decimal revised, decimal progressAmount, decimal progressPct);
}
