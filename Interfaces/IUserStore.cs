using InvoicesErp.Auth;

namespace InvoicesErp.Interfaces;

public interface IUserStore
{
    IReadOnlyList<AppUser> GetAll();
    AppUser? FindById(string id);
    AppUser? FindByUsername(string username);
    AppUser Add(AppUser user);
    bool Update(AppUser user);
    bool Delete(string id);
}
