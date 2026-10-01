using InvoicesErp.DTOs;
using InvoicesErp.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace InvoicesErp.Controllers;

[ApiController]
[Route("api/sectors")]
public class SectorController : ControllerBase
{
    private readonly ISectorService _sectorService;

    public SectorController(ISectorService sectorService)
    {
        _sectorService = sectorService;
    }

    // GET: api/sectors
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var result = await _sectorService.GetAllAsync();

        return Ok(result);
    }

    // GET: api/sectors/1
    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var result = await _sectorService.GetByIdAsync(id);

        if (result == null)
        {
            return NotFound(new
            {
                message = "Sector not found."
            });
        }

        return Ok(result);
    }

    // POST: api/sectors
    [HttpPost]
    public async Task<IActionResult> Create(
        CreateSectorDto dto)
    {
        try
        {
            var result = await _sectorService.CreateAsync(dto);

            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new
            {
                message = ex.Message
            });
        }
    }

    // PUT: api/sectors/1
    [HttpPut("{id}")]
    public async Task<IActionResult> Update(
        int id,
        UpdateSectorDto dto)
    {
        try
        {
            var result = await _sectorService.UpdateAsync(id, dto);

            if (result == null)
            {
                return NotFound(new
                {
                    message = "Sector not found."
                });
            }

            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new
            {
                message = ex.Message
            });
        }
    }

    // PATCH: api/sectors/1/deactivate
    [HttpPatch("{id}/deactivate")]
    public async Task<IActionResult> Deactivate(int id)
    {
        var result = await _sectorService.DeactivateAsync(id);

        if (!result)
        {
            return NotFound(new
            {
                message = "Sector not found."
            });
        }

        return Ok(new
        {
            message = "Sector deactivated successfully."
        });
    }
}