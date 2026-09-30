using InvoicesErp.Auth;
using InvoicesErp.DTOs;
using InvoicesErp.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace InvoicesErp.Controllers;

[ApiController, Route("api/owners")]
public class OwnersController(IOwnerService owners) : ControllerBase
{
    [HttpGet]
    [RequirePermission(PermissionModules.Owners, PermissionActions.View)]
    public async Task<IActionResult> Get(
        [FromQuery] int? page,
        [FromQuery] int? pageSize,
        [FromQuery] string? search,
        [FromQuery] string? sortBy,
        [FromQuery] string? sortDirection,
        CancellationToken ct)
        => Ok(await owners.ListAsync(page, pageSize, search, sortBy, sortDirection, ct));

    [HttpGet("{id}")]
    [RequirePermission(PermissionModules.Owners, PermissionActions.View)]
    public async Task<ActionResult<OwnerDto>> Get(string id, CancellationToken ct)
    {
        var dto = await owners.GetByIdAsync(id, ct);
        return dto is null ? NotFound() : Ok(dto);
    }

    [HttpPost]
    [RequirePermission(PermissionModules.Owners, PermissionActions.Create)]
    public async Task<ActionResult<OwnerDto>> Post(OwnerDto dto, CancellationToken ct)
    {
        var created = await owners.CreateAsync(dto, ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpPut("{id}")]
    [RequirePermission(PermissionModules.Owners, PermissionActions.Edit)]
    public async Task<IActionResult> Put(string id, OwnerDto dto, CancellationToken ct)
        => await owners.UpdateAsync(id, dto, ct) ? NoContent() : NotFound();

    [HttpDelete("{id}")]
    [RequirePermission(PermissionModules.Owners, PermissionActions.Delete)]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
        => await owners.DeleteAsync(id, ct) ? NoContent() : NotFound();
}
