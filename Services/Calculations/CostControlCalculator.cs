using InvoicesErp.DTOs;
using InvoicesErp.Interfaces;
using InvoicesErp.Models;

namespace InvoicesErp.Services.Calculations;

/// <summary>
/// Single place for Cost Control formulas (SRP). Extend rules here without changing controllers (OCP).
/// </summary>
public sealed class CostControlCalculator : ICostControlCalculator
{
    private static decimal SafeDiv(decimal num, decimal den) => den == 0 ? 0 : num / den;

    public CostControlSubItemDto MapSubItem(CostControlSubItem s, decimal original, decimal revised, decimal progressAmount, decimal progressPct)
    {
        var study = s.StudyValue < 0 ? 0 : s.StudyValue;
        var actual = s.ActualCost < 0 ? 0 : s.ActualCost;
        var studyPctOriginal = original > 0 ? SafeDiv(study, original) * 100m : 0m;
        var totalBudget = study;
        var budgetToDate = SafeDiv(studyPctOriginal, 100m) * progressAmount;
        var remaining = studyPctOriginal > 0
            ? (revised - progressAmount) * SafeDiv(studyPctOriginal, 100m)
            : 0m;

        return new CostControlSubItemDto(
            s.Id, s.CostControlItemId, s.Description, study, actual, s.DisplayOrder,
            Math.Round(studyPctOriginal, 4), Math.Round(budgetToDate, 4), Math.Round(totalBudget, 2), Math.Round(remaining, 2));
    }

    public CostControlItemDto MapItem(CostControlItem item, decimal original, decimal revised, decimal progressAmount, decimal progressPct)
    {
        var subs = (item.SubItems ?? [])
            .OrderBy(x => x.DisplayOrder).ThenBy(x => x.CreatedAt)
            .Select(s => MapSubItem(s, original, revised, progressAmount, progressPct))
            .ToList();

        return new CostControlItemDto(
            item.Id,
            item.CostControlId,
            item.Name,
            item.Code,
            item.CostType,
            item.DisplayOrder,
            subs,
            Math.Round(subs.Sum(x => x.StudyValue), 2),
            Math.Round(subs.Sum(x => x.ActualCost), 2),
            Math.Round(subs.Sum(x => x.TotalBudget), 2),
            Math.Round(subs.Sum(x => x.BudgetToDate), 4),
            Math.Round(subs.Sum(x => x.Remaining), 2));
    }
}
