using InvoicesErp.Interfaces;

namespace InvoicesErp.Services;

public sealed class GuidIdGenerator : IIdGenerator
{
    public string NewId() => Guid.NewGuid().ToString("N");
}
