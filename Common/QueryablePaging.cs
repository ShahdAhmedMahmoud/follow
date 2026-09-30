using Microsoft.EntityFrameworkCore;

namespace InvoicesErp.Common;

public static class QueryablePaging
{
    public static async Task<PagedResult<T>> ToPagedAsync<T>(
        this IQueryable<T> query,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 25;
        if (pageSize > 100) pageSize = 100;

        var total = await query.CountAsync(ct);
        var items = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return PagedResult<T>.Create(items, page, pageSize, total);
    }
}
