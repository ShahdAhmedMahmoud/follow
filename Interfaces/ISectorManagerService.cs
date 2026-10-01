using InvoicesErp.DTOs;

namespace InvoicesErp.Interfaces;

public interface ISectorManagerService
{
    Task<List<SectorManagerDto>> GetAllAsync();

    Task<SectorManagerDto?> GetByIdAsync(int id);

    Task<SectorManagerDto> CreateAsync(
        CreateSectorManagerDto dto);

    Task<SectorManagerDto?> UpdateAsync(
        int id,
        UpdateSectorManagerDto dto);

    Task<bool> DeactivateAsync(int id);
}