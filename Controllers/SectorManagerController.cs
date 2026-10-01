using InvoicesErp.DTOs;
using InvoicesErp.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace InvoicesErp.Controllers;

[ApiController]
[Route("api/sector-managers")]
public class SectorManagerController : ControllerBase
{
    private readonly ISectorManagerService _managerService;

    public SectorManagerController(
        ISectorManagerService managerService)
    {
        _managerService = managerService;
    }

    // GET: api/sector-managers
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var result = await _managerService.GetAllAsync();

        return Ok(result);
    }

    // GET: api/sector-managers/1
    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var result = await _managerService.GetByIdAsync(id);

        if (result == null)
        {
            return NotFound(new
            {
                message = "Sector manager not found."
            });
        }

        return Ok(result);
    }

    // POST: api/sector-managers
    [HttpPost]
    public async Task<IActionResult> Create(
        CreateSectorManagerDto dto)
    {
        try
        {
            var result = await _managerService.CreateAsync(dto);

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new
            {
                message = ex.Message
            });
        }
    }

    // PUT: api/sector-managers/1
    [HttpPut("{id}")]
    public async Task<IActionResult> Update(
        int id,
        UpdateSectorManagerDto dto)
    {
        try
        {
            var result =
                await _managerService.UpdateAsync(id, dto);

            if (result == null)
            {
                return NotFound(new
                {
                    message = "Sector manager not found."
                });
            }

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new
            {
                message = ex.Message
            });
        }
    }

    // PATCH: api/sector-managers/1/deactivate
    [HttpPatch("{id}/deactivate")]
    public async Task<IActionResult> Deactivate(int id)
    {
        var result =
            await _managerService.DeactivateAsync(id);

        if (!result)
        {
            return NotFound(new
            {
                message = "Sector manager not found."
            });
        }

        return Ok(new
        {
            message = "Sector manager deactivated successfully."
        });
    }
}