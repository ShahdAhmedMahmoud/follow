using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YourProjectName.Migrations // استبدل دي بالـ Namespace الحقيقي بتاع مشروعك
{
    public partial class AddContractDurationColumn : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ContractDuration",
                table: "Contracts",
                type: "int",
                nullable: false,
                defaultValue: 0);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ContractDuration",
                table: "Contracts");
        }
    }
}