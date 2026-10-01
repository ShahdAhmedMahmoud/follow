using InvoicesErp.Data;
using InvoicesErp.DTOs;
using InvoicesErp.Interfaces;
using InvoicesErp.Models;
using Microsoft.EntityFrameworkCore;

namespace InvoicesErp.Services;

public class SectorService : ISectorService
{
    private readonly AppDbContext _context;

    public SectorService(AppDbContext context)
    {
        _context = context;
    }

    public async Task<List<SectorDto>> GetAllAsync()
    {
        return await _context.Sectors
            .Select(x => new SectorDto
            {
                SectorId = x.SectorId,
                Name = x.Name,
                Code = x.Code,
                IsActive = x.IsActive,

                SectorManagerId = x.SectorManager != null
                    ? x.SectorManager.SectorManagerId
                    : null,

                SectorManagerName = x.SectorManager != null
                    ? x.SectorManager.FullName
                    : null,

                ProjectsCount = x.Projects.Count
            })
            .OrderBy(x => x.Name)
            .ToListAsync();
    }

    public async Task<SectorDto?> GetByIdAsync(int id)
    {
        return await _context.Sectors
            .Where(x => x.SectorId == id)
            .Select(x => new SectorDto
            {
                SectorId = x.SectorId,
                Name = x.Name,
                Code = x.Code,
                IsActive = x.IsActive,

                SectorManagerId = x.SectorManager != null
                    ? x.SectorManager.SectorManagerId
                    : null,

                SectorManagerName = x.SectorManager != null
                    ? x.SectorManager.FullName
                    : null,

                ProjectsCount = x.Projects.Count
            })
            .FirstOrDefaultAsync();
    }

    public async Task<SectorDto> CreateAsync(CreateSectorDto dto)
    {
        var nameExists = await _context.Sectors
            .AnyAsync(x => x.Name == dto.Name);

        if (nameExists)
        {
            throw new InvalidOperationException(
                "A sector with the same name already exists.");
        }

        var sector = new Sector
        {
            Name = dto.Name,
            Code = dto.Code,
            IsActive = true
        };

        _context.Sectors.Add(sector);

        await _context.SaveChangesAsync();

        return await GetByIdAsync(sector.SectorId)
            ?? throw new InvalidOperationException(
                "Failed to load created sector.");
    }

    public async Task<SectorDto?> UpdateAsync(
        int id,
        UpdateSectorDto dto)
    {
        var sector = await _context.Sectors
            .FirstOrDefaultAsync(x => x.SectorId == id);

        if (sector == null)
            return null;

        var nameExists = await _context.Sectors
            .AnyAsync(x =>
                x.SectorId != id &&
                x.Name == dto.Name);

        if (nameExists)
        {
            throw new InvalidOperationException(
                "A sector with the same name already exists.");
        }

        sector.Name = dto.Name;
        sector.Code = dto.Code;
        sector.IsActive = dto.IsActive;

        await _context.SaveChangesAsync();

        return await GetByIdAsync(id);
    }

    public async Task<bool> DeactivateAsync(int id)
    {
        var sector = await _context.Sectors
            .FirstOrDefaultAsync(x => x.SectorId == id);

        if (sector == null)
            return false;

        sector.IsActive = false;

        await _context.SaveChangesAsync();

        return true;
    }
}