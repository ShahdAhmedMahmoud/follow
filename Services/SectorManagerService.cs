using InvoicesErp.Data;
using InvoicesErp.DTOs;
using InvoicesErp.Interfaces;
using InvoicesErp.Models;
using Microsoft.EntityFrameworkCore;

namespace InvoicesErp.Services;

public class SectorManagerService : ISectorManagerService
{
    private readonly AppDbContext _context;

    public SectorManagerService(AppDbContext context)
    {
        _context = context;
    }

    public async Task<List<SectorManagerDto>> GetAllAsync()
    {
        return await _context.SectorManagers
            .Select(x => new SectorManagerDto
            {
                SectorManagerId = x.SectorManagerId,
                FullName = x.FullName,
                Email = x.Email,
                Phone = x.Phone,
                SectorId = x.SectorId,
                SectorName = x.Sector.Name,
                IsActive = x.IsActive
            })
            .OrderBy(x => x.FullName)
            .ToListAsync();
    }

    public async Task<SectorManagerDto?> GetByIdAsync(int id)
    {
        return await _context.SectorManagers
            .Where(x => x.SectorManagerId == id)
            .Select(x => new SectorManagerDto
            {
                SectorManagerId = x.SectorManagerId,
                FullName = x.FullName,
                Email = x.Email,
                Phone = x.Phone,
                SectorId = x.SectorId,
                SectorName = x.Sector.Name,
                IsActive = x.IsActive
            })
            .FirstOrDefaultAsync();
    }

    public async Task<SectorManagerDto> CreateAsync(
        CreateSectorManagerDto dto)
    {
        var sector = await _context.Sectors
            .FirstOrDefaultAsync(x => x.SectorId == dto.SectorId);

        if (sector == null)
        {
            throw new ArgumentException("Sector not found.");
        }

        if (!sector.IsActive)
        {
            throw new ArgumentException(
                "Cannot assign a manager to an inactive sector.");
        }

        var alreadyHasManager = await _context.SectorManagers
            .AnyAsync(x => x.SectorId == dto.SectorId);

        if (alreadyHasManager)
        {
            throw new InvalidOperationException(
                "This sector already has a manager.");
        }

        var manager = new SectorManager
        {
            FullName = dto.FullName,
            Email = dto.Email,
            Phone = dto.Phone,
            SectorId = dto.SectorId,
            IsActive = true
        };

        _context.SectorManagers.Add(manager);

        await _context.SaveChangesAsync();

        return await GetByIdAsync(manager.SectorManagerId)
            ?? throw new InvalidOperationException(
                "Failed to load created sector manager.");
    }

    public async Task<SectorManagerDto?> UpdateAsync(
        int id,
        UpdateSectorManagerDto dto)
    {
        var manager = await _context.SectorManagers
            .FirstOrDefaultAsync(
                x => x.SectorManagerId == id);

        if (manager == null)
            return null;

        var sector = await _context.Sectors
            .FirstOrDefaultAsync(x => x.SectorId == dto.SectorId);

        if (sector == null)
        {
            throw new ArgumentException(
                "Sector not found.");
        }

        if (!sector.IsActive)
        {
            throw new ArgumentException(
                "Cannot assign a manager to an inactive sector.");
        }

        var anotherManager = await _context.SectorManagers
            .AnyAsync(x =>
                x.SectorId == dto.SectorId &&
                x.SectorManagerId != id);

        if (anotherManager)
        {
            throw new InvalidOperationException(
                "This sector already has another manager.");
        }

        manager.FullName = dto.FullName;
        manager.Email = dto.Email;
        manager.Phone = dto.Phone;
        manager.SectorId = dto.SectorId;
        manager.IsActive = dto.IsActive;

        await _context.SaveChangesAsync();

        return await GetByIdAsync(id);
    }

    public async Task<bool> DeactivateAsync(int id)
    {
        var manager = await _context.SectorManagers
            .FirstOrDefaultAsync(
                x => x.SectorManagerId == id);

        if (manager == null)
            return false;

        manager.IsActive = false;

        await _context.SaveChangesAsync();

        return true;
    }
}