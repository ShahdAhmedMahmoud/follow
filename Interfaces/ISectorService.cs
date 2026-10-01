using InvoicesErp.DTOs;
   
namespace InvoicesErp.Interfaces;

public interface ISectorService
{
    Task<List<SectorDto>> GetAllAsync();

    Task<SectorDto?> GetByIdAsync(int id);

    Task<SectorDto> CreateAsync(CreateSectorDto dto);

    Task<SectorDto?> UpdateAsync( int id,
        UpdateSectorDto dto);

    Task<bool> DeactivateAsync(int id);
}