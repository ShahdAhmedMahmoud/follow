using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace InvoicesErp.Migrations
{
    /// <inheritdoc />
    public partial class AddSectorManagerToProject : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SectorManagerId",
                table: "Projects",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SectorManagerId",
                table: "Projects");
        }
    }
}
