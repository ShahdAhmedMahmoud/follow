namespace InvoicesErp.Interfaces;

/// <summary>Abstraction for generating entity identifiers (DIP).</summary>
public interface IIdGenerator
{
    string NewId();
}
