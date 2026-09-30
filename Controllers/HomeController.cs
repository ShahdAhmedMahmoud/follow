using Microsoft.AspNetCore.Mvc;

namespace InvoicesErp.Controllers;

public class HomeController : Controller
{
    public IActionResult Index()
    {
        return View();
    }
}
